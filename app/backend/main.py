import asyncio
import logging
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

# 1. Determine which environment we are in (default to 'dev')

env_status = os.getenv("ENV", "dev")


# 2. Map the environment to a specific filename

env_file = ".env.prod" if env_status == "production" else ".env"


# Get the directory where THIS script is located

BASE_DIR = Path(__file__).resolve().parent


# 3. Load the specific file

load_dotenv(dotenv_path=BASE_DIR / env_file)


from src.log_handler import configure_logging

configure_logging()


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.api.directory import router as directory_router
from src.api.directory_monitors import router as directory_monitors_router
from src.api.file import router as files_router
from src.api.file_filters import router as file_filters_router
from src.api.logs import router as logs_router
from src.api.notifications import router as notifications_router
from src.api.r18 import router as r18_router
from src.api.r18_actress_download_monitors import router as r18_actress_download_monitors_router
from src.api.scene import router as scenes_router
from src.api.scraper import router as scraper_router
from src.api.settings import router as settings_router
from src.api.tasks import router, task_manager
from src.api.tools import router as tools_router
from src.crud.task import get_all_tasks, update_task
from src.schemas.db_helper import close_db, get_db, init_db
from src.schemas.r18_db import ensure_r18_indexes
from src.schemas.task import TaskRecord
from src.workers.actress_download_monitor_scheduler import actress_download_monitor_scheduler
from src.workers.directory_scan_scheduler import directory_scan_scheduler
from src.workers.download_queue_worker import download_queue_worker
from src.workers.monitor_scheduler import monitor_scheduler
from src.workers.r18_auto_refresh_scheduler import r18_auto_refresh_scheduler
from src.workers.scraper_scheduler import scraper_scheduler
from src.workers.sha256_worker import sha256_worker


async def lifespan(app: FastAPI):

    loop = asyncio.get_running_loop()
    from src.notification_service import set_notification_loop

    set_notification_loop(loop)

    # Initialize database tables and load existing tasks (blocking I/O, offload to executor)

    def _init_startup():

        init_db()
        ensure_r18_indexes()

        return get_all_tasks()

    existing_tasks = await loop.run_in_executor(None, _init_startup)

    # Reload queued/processing tasks into memory and re-queue them
    # Avoid redundant DB updates for tasks that are already in the correct state
    # Skip paused tasks: don't requeue if paused_at is set
    def _recover_tasks():

        db = get_db()

        try:
            tasks_to_requeue = []

            for task in existing_tasks:
                if task.status in ["queued", "processing"]:
                    # Check if task is paused by querying the database

                    task_record = db.query(TaskRecord).filter(TaskRecord.id == task.id).first()

                    if task_record and task_record.paused_at is not None:
                        logging.info(f"Skipping paused task {task.id} during startup recovery")

                        continue

                    # Only update DB if status is changing (processing -> queued)

                    if task.status == "processing":
                        task.status = "queued"

                        update_task(task)

                        logging.info(f"Recovered task {task.id}: reset from processing to queued")

                    task_manager.tasks_db[task.id] = task

                    tasks_to_requeue.append(task.id)

            return tasks_to_requeue

        finally:
            close_db(db)

    tasks_to_requeue = await loop.run_in_executor(None, _recover_tasks)

    # Re-queue all tasks for processing
    for task_id in tasks_to_requeue:
        await task_manager._enqueue_with_priority(task_id)

    task_processors = [asyncio.create_task(task_manager.task_processor()) for _ in range(3)]
    sha256_task = asyncio.create_task(sha256_worker())
    dl_queue_task = asyncio.create_task(download_queue_worker())
    watchdog_task = asyncio.create_task(task_manager._watchdog_loop())
    monitor_task = asyncio.create_task(monitor_scheduler(task_manager))
    actress_monitor_task = asyncio.create_task(actress_download_monitor_scheduler())
    directory_scan_task = asyncio.create_task(directory_scan_scheduler())
    r18_auto_refresh_task = asyncio.create_task(r18_auto_refresh_scheduler())
    scraper_task = asyncio.create_task(scraper_scheduler())

    try:
        yield  # The app is now "live" and handling requests

    finally:
        logging.info("Shutting down... cleaning up resources.")

        await task_manager.shutdown()

        for task in task_processors:
            task.cancel()

        sha256_task.cancel()
        dl_queue_task.cancel()
        watchdog_task.cancel()
        monitor_task.cancel()
        actress_monitor_task.cancel()
        directory_scan_task.cancel()
        r18_auto_refresh_task.cancel()
        scraper_task.cancel()

        for t in [*task_processors, sha256_task, dl_queue_task, watchdog_task, monitor_task, actress_monitor_task, directory_scan_task, r18_auto_refresh_task, scraper_task]:
            try:
                await t

            except asyncio.CancelledError:
                pass


app = FastAPI(title="Video Processor API", version="1.0.0", lifespan=lifespan)


allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5175").split(",")


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development; change in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include routes
app.include_router(router)
app.include_router(directory_router)
app.include_router(directory_monitors_router)
app.include_router(files_router)
app.include_router(logs_router)
app.include_router(notifications_router)
app.include_router(scenes_router)
app.include_router(settings_router)
app.include_router(r18_router)
app.include_router(r18_actress_download_monitors_router)
app.include_router(file_filters_router)
app.include_router(scraper_router)
app.include_router(tools_router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8011, reload=False)
