import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, UTC
from filelock import FileLock

sessions_file = "data/sessions.json"
session_lock_file = "data/sessions.lock"
session_lock = FileLock(session_lock_file)

def load_sessions_unlocked() -> dict:
    if not os.path.exists(sessions_file):
        return {}
    
    try:
        with open(sessions_file, "r", encoding="utf-8") as f:
            content = f.read().strip()

            if not content:
                return {}
            
            data = json.loads(content)

            return data if isinstance(data, dict) else {}
        
    except json.JSONDecodeError:
        return {}
    
def save_sessions_unlocked(sessions: dict):
    temp_file = f"{sessions_file}.tmp"

    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=4)
        f.flush()
        os.fsync(f.fileno())

    os.replace(temp_file, sessions_file)

def store_session(session_id: str, user_id: str, expiry_time: datetime, csrf_token: str, ip: str):
    with session_lock:
        sessions = load_sessions_unlocked()
        
        sessions[session_id] = {
            "user_id": user_id,
            "expires_at": expiry_time.isoformat(),
            "csrf_token": csrf_token,
            "ip": ip
        }

        save_sessions_unlocked(sessions)

    cleanup_expired_sessions()

def generate_session(user_id: str, ip: str) -> tuple[str, str]:
    now = datetime.now(UTC)
    expiry_time = now + timedelta(minutes=10)
    session_id = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)

    store_session(session_id, user_id, expiry_time, csrf_token, ip)

    return session_id, csrf_token

def validate_session(provided_id: str) -> dict:
    """
    Verifies the session based on provided_id.

    Returns:
    {
        "valid": bool,
        "user_id": str | None,
        "csrf_token": str| None,
        "error": str | None
    }
    """

    with session_lock:
        sessions = load_sessions_unlocked()

        session_data = sessions.get(provided_id)

        if not session_data:
            return {"valid": False, "user_id": None, "csrf_token": None, "error": "Session not found"}
        
        try:
            expiry = datetime.fromisoformat(session_data["expires_at"])
        except Exception:
            return {"valid": False, "user_id": None, "csrf_token": None, "error": "Invalid session expiry"}

        if datetime.now(UTC) > expiry:
            user_id = session_data["user_id"]
            del sessions[provided_id]
            save_sessions_unlocked(sessions)
            return {"valid": False, "user_id": user_id, "csrf_token": None, "error": "Session expired"}
        
        return {"valid": True, "user_id": session_data["user_id"], "csrf_token": session_data.get("csrf_token"), "error": None}
    
def update_expiry(session_id: str):
    now = datetime.now(UTC)
    expiry_time = now + timedelta(minutes=10)

    with session_lock:        
        sessions = load_sessions_unlocked()

        if session_id in sessions:
            sessions[session_id]["expires_at"] = expiry_time.isoformat()
        
            save_sessions_unlocked(sessions)

    cleanup_expired_sessions()

def remove_session(session_id: str):
    with session_lock:        
        sessions = load_sessions_unlocked()

        session = sessions.get(session_id)

        session = sessions.get(session_id)

        if not session:
            return None

        del sessions[session_id]

        save_sessions_unlocked(sessions)

    cleanup_expired_sessions()

    return session
    
def cleanup_expired_sessions():
    now = datetime.now(UTC)

    with session_lock:
        sessions = load_sessions_unlocked()
            
        updated_sessions = {}

        for session_id, data in sessions.items():
            try:
                expiry = datetime.fromisoformat(data["expires_at"])
                if expiry > now:
                    updated_sessions[session_id] = data
            except Exception:
                # possibly corrupted session, so exclude it
                continue

        if len(updated_sessions) != len(sessions):
            save_sessions_unlocked(updated_sessions)

def session_cleanup_worker(interval_seconds=600):
    while True:
        time.sleep(interval_seconds)
        cleanup_expired_sessions()

def start_cleanup_thread():
    thread = threading.Thread(target=session_cleanup_worker, daemon=True)
    thread.start()