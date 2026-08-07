from typing import Optional, Dict, Any
from sqlalchemy import text
from core.db import engine


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Fetch user record by email (case-insensitive) from Supabase PostgreSQL."""
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id, name, email, password_hash, role, created_at FROM users WHERE LOWER(email) = LOWER(:email)"),
            {"email": email.strip()}
        ).mappings().first()
        if result:
            return dict(result)
        return None


def create_user(name: str, email: str, password_hash: str) -> Dict[str, Any]:
    """Insert a new user record into Supabase PostgreSQL and return the created record."""
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                INSERT INTO users (name, email, password_hash, role, created_at)
                VALUES (:name, LOWER(:email), :password_hash, 'USER', NOW())
                RETURNING id, name, email, role, created_at
            """),
            {
                "name": name.strip(),
                "email": email.strip(),
                "password_hash": password_hash
            }
        ).mappings().first()
        return dict(result)


def update_user_name(email: str, name: str) -> Optional[Dict[str, Any]]:
    """Update user's display name in Supabase PostgreSQL."""
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                UPDATE users
                SET name = :name
                WHERE LOWER(email) = LOWER(:email)
                RETURNING id, name, email, role, created_at
            """),
            {
                "name": name.strip(),
                "email": email.strip()
            }
        ).mappings().first()
        if result:
            return dict(result)
        return None


def update_user_password(email: str, password_hash: str) -> bool:
    """Update user's password hash in Supabase PostgreSQL."""
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                UPDATE users
                SET password_hash = :password_hash
                WHERE LOWER(email) = LOWER(:email)
            """),
            {
                "password_hash": password_hash,
                "email": email.strip()
            }
        )
        return result.rowcount > 0

