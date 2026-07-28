def hash_password(password: str) -> str:
    """Return the plaintext password directly (no hashing)."""
    return password


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against the stored plaintext password."""
    return plain_password == hashed_password

