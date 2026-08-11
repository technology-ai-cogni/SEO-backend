from typing import Optional, Dict, Any, List
from sqlalchemy import text
from core.db import engine


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Fetch user record by email (case-insensitive) from Supabase PostgreSQL."""
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id, name, email, password_hash, role, COALESCE(status, 'Active') as status, created_at FROM users WHERE LOWER(email) = LOWER(:email)"),
            {"email": email.strip()}
        ).mappings().first()
        if result:
            return dict(result)
        return None


def create_user(name: str, email: str, password_hash: str, role: str = 'USER', status: str = 'Active') -> Dict[str, Any]:
    """Insert a new user record into Supabase PostgreSQL and return the created record."""
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                INSERT INTO users (name, email, password_hash, role, status, created_at)
                VALUES (:name, LOWER(:email), :password_hash, UPPER(:role), :status, NOW())
                RETURNING id, name, email, role, status, created_at
            """),
            {
                "name": name.strip(),
                "email": email.strip(),
                "password_hash": password_hash,
                "role": role,
                "status": status
            }
        ).mappings().first()
        return dict(result)


def list_all_users() -> List[Dict[str, Any]]:
    """List all registered user accounts for admin management."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT id, name, email, role, COALESCE(status, 'Active') as status, created_at
                FROM users
                ORDER BY created_at DESC
            """)
        ).mappings().fetchall()
        return [dict(r) for r in rows]


def update_user_status(user_id: int, new_status: str) -> Optional[Dict[str, Any]]:
    """Enable or disable user profile status ('Active' vs 'Disabled')."""
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                UPDATE users
                SET status = :status
                WHERE id = :id
                RETURNING id, name, email, role, status, created_at
            """),
            {"id": user_id, "status": new_status}
        ).mappings().first()
        return dict(row) if row else None


def update_user_role(user_id: int, new_role: str) -> Optional[Dict[str, Any]]:
    """Update user role ('ADMIN', 'USER', 'VENDOR', etc.)."""
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                UPDATE users
                SET role = UPPER(:role)
                WHERE id = :id
                RETURNING id, name, email, role, status, created_at
            """),
            {"id": user_id, "role": new_role}
        ).mappings().first()
        return dict(row) if row else None


def delete_user_by_id(user_id: int) -> bool:
    """Permanently delete a user account by ID."""
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        return res.rowcount > 0


def update_user_name(email: str, name: str) -> Optional[Dict[str, Any]]:
    """Update user's display name in Supabase PostgreSQL."""
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                UPDATE users
                SET name = :name
                WHERE LOWER(email) = LOWER(:email)
                RETURNING id, name, email, role, COALESCE(status, 'Active') as status, created_at
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
