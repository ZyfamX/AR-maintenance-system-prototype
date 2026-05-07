import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, UTC
from threading import Lock

sessions_file = "data/sessions.json"
session_lock = Lock()

def store_session(session_id: str, user_id: str, expiry_time: datetime, csrf_token: str, ip: str):
    with session_lock:
        sessions = {}
        if os.path.exists(sessions_file) and os.path.getsize(sessions_file) > 0:
            with open(sessions_file, "r", encoding="utf-8") as f:
                data = json.load(f)

                if isinstance(data, dict):
                    sessions = data
                else:
                    sessions = {}

        sessions[session_id] = {
            "user_id": user_id,
            "expires_at": expiry_time.isoformat(),
            "csrf_token": csrf_token,
            "ip": ip
        }

        with open(sessions_file, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=4)

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
        if not os.path.exists(sessions_file):
            return {"valid": False, "user_id": None, "csrf_token": None, "error": "No active sessions found"}
        
        with open(sessions_file, "r", encoding="utf-8") as f:
            sessions = json.load(f)

        session_data = sessions.get(provided_id)

        if not session_data:
            return {"valid": False, "user_id": None, "csrf_token": None, "error": "Session not found"}
        
        expiry = datetime.fromisoformat(session_data["expires_at"])
        if datetime.now(UTC) > expiry:
            user_id = session_data["user_id"]
            del sessions[provided_id]
            with open(sessions_file, "w", encoding="utf-8") as f:
                json.dump(sessions, f, indent=4)
            return {"valid": False, "user_id": user_id, "csrf_token": None, "error": "Session expired"}
        
        return {"valid": True, "user_id": session_data["user_id"], "csrf_token": session_data.get("csrf_token"), "error": None}
    
def update_expiry(session_id: str):
    now = datetime.now(UTC)
    expiry_time = now + timedelta(minutes=10)

    with session_lock:        
        with open(sessions_file, "r", encoding="utf-8") as f:
            sessions = json.load(f)

        if session_id in sessions:
            sessions[session_id]["expires_at"] = expiry_time.isoformat()
        
        with open(sessions_file, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=4)

    cleanup_expired_sessions()

def remove_session(session_id: str):
    with session_lock:        
        with open(sessions_file, "r", encoding="utf-8") as f:
            sessions = json.load(f)

        session = sessions.get(session_id)
        if not session:
            return None

        session["expires_at"] = datetime.now(UTC).isoformat()

        del sessions[session_id]

        with open(sessions_file, "w", encoding="utf-8") as f:
            json.dump(sessions, f, indent=4)

    cleanup_expired_sessions()

    return session
    
def cleanup_expired_sessions():
    now = datetime.now(UTC)

    with session_lock:
        if not os.path.exists(sessions_file):
            return
        
        with open(sessions_file, "r", encoding="utf-8") as f:
            try:
                sessions = json.load(f)
            except json.JSONDecodeError:
                return
            
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
            with open(sessions_file, "w", encoding="utf-8") as f:
                json.dump(updated_sessions, f, indent=4)

def session_cleanup_worker(interval_seconds=600):
    while True:
        time.sleep(interval_seconds)
        cleanup_expired_sessions()

def start_cleanup_thread():
    thread = threading.Thread(target=session_cleanup_worker, daemon=True)
    thread.start()