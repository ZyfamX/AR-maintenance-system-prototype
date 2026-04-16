# security.py
import re
from datetime import datetime, timedelta

# Checks if the password matches the hash
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return False
# Encrypts the password before saving to JSON
def hash_password(password: str) -> str:
    return "hashed"

# password is 8+ chars, 1 number, 1 special char (Requirement NF12)
def check_password_complexity(password: str) -> bool:

    if len(password) < 8:
        return False
    if not re.search(r"\d", password):
        return False
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False
    return True

# You can also add your JWT token generation logic here!