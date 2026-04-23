import json
import os
import secrets
from datetime import datetime, timedelta, UTC
from threading import Lock

sessions_file = "data/sessions.json"
session_lock = Lock()

def store_session(session_id: str, user_id: str, expiry_time: datetime):
    with session_lock:
        sessions = {}
        if os.path.exists(sessions_file) and os.path.getsize(sessions_file) > 0:
            with open(sessions_file, "r") as f:
                sessions = json.load(f)

        sessions[session_id] = {
            "user_id": user_id,
            "expires_at": expiry_time.isoformat()
        }

        with open(sessions_file, "w") as f:
            json.dump(sessions, f, indent=4)

def generate_session(user_id: str) -> str:
    now = datetime.now(UTC)
    expiry_time = now + timedelta(minutes=10)
    session_id = secrets.token_urlsafe(32)

    store_session(session_id, user_id, expiry_time)

    return session_id

def validate_session(provided_id: str) -> dict:
    """
    Verifies the session based on provided_id.

    Returns:
    {
        "valid": bool,
        "user_id": str | None,
        "error": str | None
    }
    """

    with session_lock:
        if not os.path.exists(sessions_file):
            return {"valid": False, "user_id": None, "error": "No active sessions found"}
        
        with open(sessions_file, "r") as f:
            sessions = json.load(f)

        session_data = sessions.get(provided_id)

        if not session_data:
            return {"valid": False, "user_id": None, "error": "Session not found"}
        
        expiry = datetime.fromisoformat(session_data["expires_at"])
        if datetime.now(UTC) > expiry:
            user_id = session_data["user_id"]
            del sessions[provided_id]
            with open(sessions_file, "w") as f:
                json.dump(sessions, f, indent=4)
            return {"valid": False, "user_id": user_id, "error": "Session expired"}
        
        return {"valid": True, "user_id": session_data["user_id"], "error": None}
    
def update_expiry(session_id: str):
    now = datetime.now(UTC)
    expiry_time = now + timedelta(minutes=10)

    with session_lock:        
        with open(sessions_file, "r") as f:
            sessions = json.load(f)

        if session_id in sessions:
            sessions[session_id]["expires_at"] = expiry_time.isoformat()
        
        with open(sessions_file, "w") as f:
            json.dump(sessions, f, indent=4)

def remove_session(session_id: str):
    with session_lock:        
        with open(sessions_file, "r") as f:
            sessions = json.load(f)

        session = sessions.get(session_id)
        if not session:
            return None

        session["expires_at"] = datetime.now(UTC).isoformat()

        del sessions[session_id]

        with open(sessions_file, "w") as f:
            json.dump(sessions, f, indent=4)

        return session