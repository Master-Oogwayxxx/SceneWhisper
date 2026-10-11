FROM node:20-slim AS frontend-build

WORKDIR /app/frontend

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY app/frontend/package*.json ./
RUN npm ci

COPY app/frontend ./
RUN npm run build

FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    VIDEO_STORAGE_PATH=/videos \
    DB_STORAGE_PATH=/data \
    ALLOWED_ORIGINS=*

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    ffmpeg \
    curl \
    gzip \
    nginx \
    supervisor \
    tzdata \
    && rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY app/backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python3.11 -m pip install --no-cache-dir -r requirements.txt \
    && python3.11 -m pip install --no-cache-dir hf_transfer

COPY app/backend ./
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY docker/unraid/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/unraid/supervisord.conf /etc/supervisor/conf.d/scenewhisper.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/scenewhisper.conf"]
