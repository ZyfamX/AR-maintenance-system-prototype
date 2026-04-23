import os
import json
from passlib.context import CryptContext
from threading import Lock
import re
from datetime import datetime, timedelta
import hashlib

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Password requirement configuration
# 8+ chars, 1 number, 1 special char (Requirement NF12)
pwd_min_length = 8
pwd_min_digits = 1
pwd_min_special_chars = 1

# Test passwords
# j.smith_sup
#print(pwd_context.hash("J@Sm!th1")) # $2b$12$Qa1KU4OqnJa/jd7SIddl2erOjHsGQicj5Qi6YeFVvDrsRhLpxex/O
# a.davis_tech
#print(pwd_context.hash("A@Dav!s2")) # $2b$12$f/l4pDsvheu5YNHuJprNNehZD4BRwRS1hszd7vBDfBmlnKpr8/3X2

# Checks if the password matches the hash (Requirement F1)
def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password.startswith("$2"):
        raise ValueError("Invalid hash format")
    return pwd_context.verify(plain_password, hashed_password)

# Encrypts the password before saving to JSON (Requirement F6)
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# Checks password against password requirements (Requirement NF12)
def check_password_complexity(password: str) -> bool:

    if len(password) < pwd_min_length:
        return False
    if len(re.findall(r"\d", password)) < pwd_min_digits:
        return False
    if len(re.findall(r"[!@#$%^&*(),.?\":{}|<>]", password)) < pwd_min_special_chars:
        return False
    
    return True

# Helper function to record system events for security and auditing purposes
log_lock = Lock()

audit_log_file = os.path.join("data", "audit.log")

def log_system_event(user_id: int | None, action: str, details: str):
    
    new_log = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "user_id": user_id,
        "action": action,
        "details": details,
    }
    
    with log_lock:
        with open(audit_log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(new_log) + "\n")

# Computes the hash of a given (audit log) entry and the previous entry's hash
def compute_hash(entry: str, previous_hash: str) -> str:
    return hashlib.sha256((entry + previous_hash).encode()).hexdigest()

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