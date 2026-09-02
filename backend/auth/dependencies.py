from typing import Optional
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

from auth.security import decode_access_token
from auth.db import get_user_by_email

security = HTTPBearer(auto_error=False)


def require_authenticated_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    """
    Centralized authentication dependency.
    Validates cryptographically signed JWT token, checks expiration, and ensures user account is active.
    Returns authenticated user profile dict from trusted server identity.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or tampered authentication token.",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    email = payload.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token claims: missing subject email.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user = get_user_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if user.get("status") == "Disabled":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your profile has been disabled by administrator. Access revoked."
        )

    return user


def require_admin(current_user: dict = Depends(require_authenticated_user)) -> dict:
    """
    Centralized role authorization dependency.
    Enforces that the authenticated user holds the ADMIN role.
    Rejects any unprivileged role with 403 Forbidden.
    """
    role = str(current_user.get("role", "")).upper()
    if role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required to access this resource."
        )
    return current_user


def require_project_access(
    request: Request,
    current_user: dict = Depends(require_authenticated_user)
) -> dict:
    """
    Object-level authorization dependency.
    Prevents horizontal privilege escalation (IDOR/BOLA).
    Verifies that the user is ADMIN or assigned to the specific requested project.
    """
    project = request.path_params.get("project") or request.path_params.get("project_slug")
    if not project:
        return current_user

    role = str(current_user.get("role", "")).upper()
    category = str(current_user.get("category", "")).upper()
    is_vendor = role == "VENDOR" or category == "VENDOR"

    # All non-vendor roles have access to all projects
    if not is_vendor:
        return current_user

    assigned_project = str(current_user.get("assigned_project", "")).strip().lower()

    # Vendors with 'All Projects' or unassigned can view all projects
    if assigned_project in ("all projects", "all", "*") or not assigned_project:
        return current_user

    # Support multiple comma-separated assigned projects (e.g. "owis, stamford american")
    assigned_list = [p.strip().lower() for p in assigned_project.split(",") if p.strip()]

    req_slug = str(project).strip().lower()
    if req_slug not in assigned_list and assigned_project != req_slug:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: your account is not allocated to project '{project}'."
        )
    return current_user
