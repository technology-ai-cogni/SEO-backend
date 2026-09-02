import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
import jwt

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "hariba-super-secure-jwt-key-2026-prod")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


import bcrypt


def hash_password(password: str) -> str:
    """Hash a password using standard bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash, with backward-compatible plaintext fallback."""
    if not hashed_password or not plain_password:
        return False
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$") or hashed_password.startswith("$2y$"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    # Backward compatibility for existing plaintext demo passwords
    return plain_password == hashed_password


def create_access_token(user_data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token containing essential user claims."""
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))

    payload = {
        "sub": str(user_data.get("id", "")),
        "email": str(user_data.get("email", "")).strip().lower(),
        "name": user_data.get("name", ""),
        "role": str(user_data.get("role", "INTERNAL_ASSOCIATE")).upper(),
        "category": user_data.get("category", "Internal"),
        "assigned_project": user_data.get("assigned_project", "None"),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp())
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token."""
    return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])


