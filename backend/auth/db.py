import time
from typing import Optional, Dict, Any, List
from sqlalchemy import text
from core.db import engine

_user_cache: Dict[str, tuple] = {}
_USER_CACHE_TTL = 30.0  # seconds


def invalidate_user_cache(email: Optional[str] = None):
    """Clear memory cache for a specific user email or all users."""
    if email:
        _user_cache.pop(email.strip().lower(), None)
    else:
        _user_cache.clear()


def resolve_user_category(role: str, category: Optional[str] = None) -> str:
    if category:
        return category
    if role:
        r = role.upper()
        if r == "ADMIN":
            return "Admin"
        if r == "VENDOR":
            return "Vendor"
        if r.startswith("CLIENT"):
            return "Client Access"
        if r.startswith("INTERNAL"):
            return "Internal"
    return "Internal"


def get_user_by_email(email: str, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
    """Fetch user record by email (case-insensitive) from cache or Supabase PostgreSQL."""
    clean_email = email.strip().lower()
    now = time.time()

    if not force_refresh and clean_email in _user_cache:
        cached_time, cached_user = _user_cache[clean_email]
        if now - cached_time < _USER_CACHE_TTL:
            return dict(cached_user)

    with engine.connect() as conn:
        result = conn.execute(
            text("""
                SELECT id, name, email, password_hash, role, 
                       COALESCE(category, 'Internal') as category, 
                       COALESCE(status, 'Active') as status,
                       COALESCE(section_access, 'Default') as section_access,
                       COALESCE(permissions, 'Default') as permissions,
                       COALESCE(attendance, 'Not Present') as attendance,
                       COALESCE(assigned_project, 'All Projects') as assigned_project,
                       created_at 
                FROM users WHERE LOWER(email) = LOWER(:email)
                LIMIT 1
            """),
            {"email": clean_email}
        ).mappings().first()
        if result:
            user_dict = dict(result)
            user_dict["category"] = resolve_user_category(user_dict.get("role"), user_dict.get("category"))
            _user_cache[clean_email] = (now, dict(user_dict))
            return user_dict
        return None


def create_user(name: str, email: str, password_hash: str, role: str = "INTERNAL_ASSOCIATE", category: Optional[str] = None, status: str = "Active", section_access: str = "Default", permissions: str = "Default", attendance: str = "Not Present", assigned_project: str = "All Projects") -> Dict[str, Any]:
    """Create a new user profile with RBAC properties in Supabase PostgreSQL."""
    resolved_cat = resolve_user_category(role, category)
    invalidate_user_cache(email)
    with engine.begin() as conn:
        result = conn.execute(
            text("""
                INSERT INTO users (name, email, password_hash, role, category, status, section_access, permissions, attendance, assigned_project, created_at)
                VALUES (:name, LOWER(:email), :password_hash, UPPER(:role), :category, :status, :section_access, :permissions, :attendance, :assigned_project, NOW())
                RETURNING id, name, email, role, category, status, section_access, permissions, attendance, assigned_project, created_at
            """),
            {
                "name": name.strip(),
                "email": email.strip(),
                "password_hash": password_hash,
                "role": role,
                "category": resolved_cat,
                "status": status,
                "section_access": section_access,
                "permissions": permissions,
                "attendance": attendance,
                "assigned_project": assigned_project or 'All Projects'
            }
        ).mappings().first()
        res = dict(result)
        res["category"] = resolved_cat
        _user_cache[email.strip().lower()] = (time.time(), dict(res))
        return res


def list_all_users() -> List[Dict[str, Any]]:
    """List all registered user accounts for admin management."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT id, name, email, role, 
                       COALESCE(category, 'Internal') as category, 
                       COALESCE(status, 'Active') as status,
                       COALESCE(section_access, 'Default') as section_access,
                       COALESCE(permissions, 'Default') as permissions,
                       COALESCE(attendance, 'Not Present') as attendance,
                       COALESCE(assigned_project, 'All Projects') as assigned_project,
                       created_at
                FROM users
                ORDER BY created_at DESC
            """)
        ).mappings().fetchall()
        user_list = []
        for r in rows:
            u_dict = dict(r)
            u_dict["category"] = resolve_user_category(u_dict.get("role"), u_dict.get("category"))
            user_list.append(u_dict)
        return user_list


def update_user_status(user_id: int, new_status: str) -> Optional[Dict[str, Any]]:
    """Enable or disable user profile status ('Active' vs 'Disabled')."""
    invalidate_user_cache()
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                UPDATE users
                SET status = :status
                WHERE id = :id
                RETURNING id, name, email, role, category, status, 
                          COALESCE(section_access, 'Default') as section_access,
                          COALESCE(permissions, 'Default') as permissions,
                          COALESCE(attendance, 'Not Present') as attendance,
                          COALESCE(assigned_project, 'All Projects') as assigned_project, created_at
            """),
            {"id": user_id, "status": new_status}
        ).mappings().first()
        return dict(row) if row else None


def update_user_attendance(user_id: int, attendance: str) -> Optional[Dict[str, Any]]:
    """Update attendance status for a user in Supabase DB."""
    invalidate_user_cache()
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                UPDATE users
                SET attendance = :attendance
                WHERE id = :id
                RETURNING id, name, email, role, category, status, 
                          COALESCE(section_access, 'Default') as section_access,
                          COALESCE(permissions, 'Default') as permissions,
                          COALESCE(attendance, 'Not Present') as attendance,
                          COALESCE(assigned_project, 'All Projects') as assigned_project, created_at
            """),
            {"id": user_id, "attendance": attendance}
        ).mappings().first()
        return dict(row) if row else None


def update_all_users_attendance(attendance: str = 'Present') -> bool:
    """Bulk update attendance for all users in Supabase DB."""
    invalidate_user_cache()
    with engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE users
                SET attendance = :attendance
            """),
            {"attendance": attendance}
        )
        return True


def update_user_role(user_id: int, new_role: str, category: Optional[str] = None, section_access: Optional[str] = None, permissions: Optional[str] = None, assigned_project: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Update user role, category, section_access, permissions, and assigned_project."""
    invalidate_user_cache()
    resolved_cat = resolve_user_category(new_role, category)
    with engine.begin() as conn:
        updates = ["role = UPPER(:role)", "category = :category"]
        params = {"id": user_id, "role": new_role, "category": resolved_cat}

        if section_access is not None:
            updates.append("section_access = :section_access")
            params["section_access"] = section_access
        if permissions is not None:
            updates.append("permissions = :permissions")
            params["permissions"] = permissions
        if assigned_project is not None:
            updates.append("assigned_project = :assigned_project")
            params["assigned_project"] = assigned_project

        set_clause = ", ".join(updates)
        row = conn.execute(
            text(f"""
                UPDATE users
                SET {set_clause}
                WHERE id = :id
                RETURNING id, name, email, role, 
                          COALESCE(category, 'Internal') as category, 
                          COALESCE(status, 'Active') as status,
                          COALESCE(section_access, 'Default') as section_access,
                          COALESCE(permissions, 'Default') as permissions,
                          COALESCE(attendance, 'Not Present') as attendance,
                          COALESCE(assigned_project, 'All Projects') as assigned_project,
                          created_at
            """),
            params
        ).mappings().first()
        if row:
            res = dict(row)
            res["category"] = resolved_cat
            return res
        return None


def delete_user_by_id(user_id: int) -> Optional[str]:
    """Permanently delete a user account by ID and return deleted user email."""
    invalidate_user_cache()
    with engine.begin() as conn:
        row = conn.execute(text("DELETE FROM users WHERE id = :id RETURNING email"), {"id": user_id}).mappings().first()
        return row["email"] if row else None


def update_user_name(email: str, name: str) -> Optional[Dict[str, Any]]:
    """Update user's display name in Supabase PostgreSQL."""
    invalidate_user_cache(email)
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
    invalidate_user_cache(email)
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
