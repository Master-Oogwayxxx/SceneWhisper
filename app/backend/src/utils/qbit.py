"""qBittorrent client helpers."""

from __future__ import annotations

import time
from typing import Optional

import httpx


def _login(client: httpx.Client, qbit_url: str, username: str, password: str) -> httpx.Cookies:
    resp = client.post(
        f"{qbit_url}/api/v2/auth/login",
        data={"username": username, "password": password},
    )
    if resp.status_code != 200 or resp.text == "Fails.":
        raise RuntimeError(f"qBittorrent login failed: {resp.text}")
    return resp.cookies


def _get_settings() -> tuple[str, str, str]:
    from ..crud.setting import get_settings
    settings = get_settings()
    return (
        (settings.qbittorrent_url or "").rstrip("/"),
        settings.qbittorrent_username or "",
        settings.qbittorrent_password or "",
    )


def send_to_qbit(
    torrent_url: str,
    category: str | None = None,
    tags: list[str] | None = None,
    save_path: str | None = None,
) -> None:
    """Send a torrent URL to qBittorrent. Raises RuntimeError on failure."""
    qbit_url, username, password = _get_settings()
    if not qbit_url:
        raise RuntimeError("qBittorrent URL not configured in settings")

    data: dict[str, str] = {"urls": torrent_url}
    if category:
        data["category"] = category
    if tags:
        cleaned_tags = [tag.strip() for tag in tags if tag and tag.strip()]
        if cleaned_tags:
            data["tags"] = ",".join(cleaned_tags)
    if save_path and save_path.strip():
        data["savepath"] = save_path.strip()

    with httpx.Client(timeout=15) as client:
        cookies = _login(client, qbit_url, username, password)
        add_resp = client.post(
            f"{qbit_url}/api/v2/torrents/add",
            data=data,
            cookies=cookies,
        )
        if add_resp.status_code != 200 or add_resp.text == "Fails.":
            raise RuntimeError(f"qBittorrent add torrent failed: {add_resp.text}")


def find_torrent_hash_by_name(torrent_name: str, retries: int = 5, delay: float = 3.0) -> Optional[str]:
    """Search qBittorrent for a torrent by name, returning its hash or None.

    Retries a few times because qbit may not list the torrent immediately after adding.
    """
    qbit_url, username, password = _get_settings()
    if not qbit_url:
        return None

    with httpx.Client(timeout=15) as client:
        try:
            cookies = _login(client, qbit_url, username, password)
        except RuntimeError:
            return None

        for _ in range(retries):
            resp = client.get(f"{qbit_url}/api/v2/torrents/info", cookies=cookies)
            if resp.status_code != 200:
                return None
            for t in resp.json():
                # qbit torrent name may match the stem of the .torrent filename
                if torrent_name.lower() in t.get("name", "").lower() or t.get("name", "").lower() in torrent_name.lower():
                    return t["hash"]
            time.sleep(delay)

    return None


def get_torrent_progress(torrent_hash: str) -> Optional[float]:
    """Return download progress (0.0–1.0) for the given torrent hash, or None if not found."""
    qbit_url, username, password = _get_settings()
    if not qbit_url:
        return None

    with httpx.Client(timeout=15) as client:
        try:
            cookies = _login(client, qbit_url, username, password)
        except RuntimeError:
            return None

        resp = client.get(
            f"{qbit_url}/api/v2/torrents/info",
            params={"hashes": torrent_hash},
            cookies=cookies,
        )
        if resp.status_code != 200:
            return None
        torrents = resp.json()
        if not torrents:
            return None
        return float(torrents[0].get("progress", 0.0))


def delete_torrent(torrent_hash: str) -> None:
    """Delete a torrent and its downloaded files from qBittorrent."""
    qbit_url, username, password = _get_settings()
    if not qbit_url:
        raise RuntimeError("qBittorrent URL not configured in settings")

    with httpx.Client(timeout=15) as client:
        cookies = _login(client, qbit_url, username, password)
        resp = client.post(
            f"{qbit_url}/api/v2/torrents/delete",
            data={"hashes": torrent_hash, "deleteFiles": "true"},
            cookies=cookies,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"qBittorrent delete failed: {resp.text}")
