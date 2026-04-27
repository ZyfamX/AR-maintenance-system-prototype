import bcrypt
import os
import json
from threading import Lock
import re
from datetime import datetime, UTC
import hashlib

# Password requirement configuration
# 8+ chars, 1 number, 1 special char (Requirement NF12)
pwd_min_length = 8
pwd_min_digits = 1
pwd_min_special_chars = 1

# Checks if the password matches the hash (Requirement F1)
def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode("utf-8")
    hash_bytes = hashed_password.encode("utf-8")

    return bcrypt.checkpw(password_bytes, hash_bytes)

# Encrypts the password before saving to JSON (Requirement F6)
def hash_password(password: str) -> str:
    password_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")

# Test passwords
# j.smith_sup
# print(hash_password("J@Sm!th1")) # $2b$12$IR/e7pUMtLNXw.t7ekRPn.VL7KP6rgZC1SKrtqUbj6Su5KR5hcrey
# a.davis_tech
# print(hash_password("A@Dav!s2")) # $2b$12$6DcEOJZ5iXveztiwy3MscuPNPig6D.B8t4g./09vRVQUGRLvIDvCq

# Checks password against password requirements (Requirement NF12)
def check_password_complexity(password: str) -> bool:

    if len(password) < pwd_min_length:
        return False
    if len(re.findall(r"\d", password)) < pwd_min_digits:
        return False
    if len(re.findall(r"[!@#$%^&*(),.?\":{}|<>]", password)) < pwd_min_special_chars:
        return False
    
    return True

# Computes the hash of a given (audit log) entry and the previous entry's hash
def compute_hash(entry: str, previous_hash: str) -> str:
    return hashlib.sha256((entry + previous_hash).encode()).hexdigest()

def get_last_hash(log_file: str) -> str:
    if not os.path.exists(audit_log_file):
        return "0"
    
    with open(audit_log_file, "rb") as f:
        try:
            f.seek(-2, os.SEEK_END)
            while f.read(1) != b"\n":
                f.seek(-2, os.SEEK_CUR)
        except OSError:
            f.seek(0)

        last_line = f.readline().decode("utf-8").strip()

    if not last_line:
        return "0"
    
    try:
        entry = json.loads(last_line)
        return entry.get("hash", "0")
    except json.JSONDecodeError:
        return "0"

# Helper function to record system events for security and auditing purposes
log_lock = Lock()

audit_log_file = os.path.join("data", "audit.log")

def log_system_event(user_id: int | None, action: str, details: str):
    
    base_entry = {
        "timestamp": datetime.now(UTC).isoformat() + "Z",
        "user_id": user_id,
        "action": action,
        "details": details,
    }
    
    with log_lock:
        prev_hash = get_last_hash(audit_log_file)

        entry_str = json.dumps(base_entry, sort_keys=True)

        current_hash = compute_hash(entry_str, prev_hash)

        full_entry = {
            **base_entry,
            "prev_hash": prev_hash,
            "hash": current_hash
        }

        with open(audit_log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(full_entry) + "\n")

# Verifies the integrity of the audit log
def verify_audit_log(log_file: str) -> dict:
    """
    Verifies the integrity of the audit log.

    Returns:
    {
        "valid": bool,
        "error": str | None,
        "line": str | None
    }
    """

    if not os.path.exists(log_file):
        return {"valid": True, "error": None, "line": None}
    
    previous_hash = "0"

    with open(log_file, "r", encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                return {
                    "valid": False,
                    "error": "Invalid JSON",
                    "line": line_number
                }
            
            stored_hash = entry.get("hash")
            stored_prev_hash = entry.get("prev_hash")

            if stored_hash is None or stored_prev_hash is None:
                return {
                    "valid": False,
                    "error": "Missing hash fields",
                    "line": line_number
                }
            
            if stored_prev_hash != previous_hash:
                return {
                    "valid": False,
                    "error": f"Broken chain (prev_hash) mismatch. Expected {previous_hash}, got {stored_prev_hash}",
                    "line": line_number
                }
            
            base_entry = {
                k: v for k, v in entry.items()
                if k not in ("hash", "prev_hash")
            }

            entry_str = json.dumps(base_entry, sort_keys=True)

            recomputed_hash = compute_hash(entry_str, previous_hash)

            if recomputed_hash != stored_hash:
                return {
                    "valid": False,
                    "error": "Hash mismatch (entry modified)",
                    "line": line_number
                }
            
            previous_hash = stored_hash

    return {"valid": True, "error": None, "line": None}