from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

from auth.schemas import (
    SignupRequest, LoginRequest, UpdateProfileRequest, ChangePasswordRequest, 
    AuthResponse, UserResponse, CreateUserRequest, UpdateUserStatusRequest, UpdateUserRoleRequest,
    UpdateAttendanceRequest, MarkAllAttendanceRequest
)
from auth.security import (
    hash_password, verify_password, create_access_token, decode_access_token
)
from auth.dependencies import require_authenticated_user, require_admin
from auth.db import (
    get_user_by_email, create_user, update_user_name, update_user_password,
    list_all_users, update_user_status, update_user_role, delete_user_by_id,
    update_user_attendance, update_all_users_attendance
)
from core.db import insert_audit_log

router = APIRouter(prefix="/auth", tags=["auth"])
get_current_user = require_authenticated_user


# ─── PUBLIC AUTH ENDPOINTS ───────────────────────────────────────────────────

@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, background_tasks: BackgroundTasks):
    clean_email = payload.email.strip().lower()

    existing_user = get_user_by_email(clean_email)
    if existing_user:
        background_tasks.add_task(insert_audit_log, user_email=clean_email, action="User Registration Failed (Email Exists)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists."
        )

    pwd_hash = hash_password(payload.password)
    new_user = create_user(
        name=payload.name,
        email=clean_email,
        password_hash=pwd_hash
    )

    background_tasks.add_task(insert_audit_log, user_email=clean_email, action="User Registered", status="Success")

    token = create_access_token(new_user)

    return AuthResponse(
        status="success",
        message="User registered successfully.",
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=new_user["id"],
            name=new_user["name"],
            email=new_user["email"],
            role=new_user["role"],
            category=new_user.get("category", "Internal"),
            status=new_user.get("status", "Active"),
            created_at=new_user.get("created_at")
        )
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, background_tasks: BackgroundTasks):
    clean_email = payload.email.strip().lower()

    user = get_user_by_email(clean_email)
    if not user:
        background_tasks.add_task(insert_audit_log, user_email=clean_email, action="Failed Login Attempt (User Not Found)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    if user.get("status") == "Disabled":
        background_tasks.add_task(insert_audit_log, user_email=clean_email, action="Failed Login Attempt (Account Disabled)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your profile has been disabled by administrator. Please contact your admin."
        )

    if not verify_password(payload.password, user["password_hash"]):
        background_tasks.add_task(insert_audit_log, user_email=clean_email, action="Failed Login Attempt (Incorrect Password)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    background_tasks.add_task(insert_audit_log, user_email=clean_email, action="User Login", status="Success")

    token = create_access_token(user)

    return AuthResponse(
        status="success",
        message="Login successful.",
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            role=user["role"],
            category=user.get("category", "Internal"),
            status=user.get("status", "Active"),
            section_access=user.get("section_access", "Default"),
            permissions=user.get("permissions", "Default"),
            assigned_project=user.get("assigned_project", "All Projects"),
            created_at=user.get("created_at")
        )
    )


# ─── CURRENT USER PROFILE ─────────────────────────────────────────────────────

@router.get("/me", response_model=UserResponse)
def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    """Fetch live profile of currently authenticated user via session token."""
    return UserResponse(
        id=current_user["id"],
        name=current_user["name"],
        email=current_user["email"],
        role=current_user["role"],
        category=current_user.get("category", "Internal"),
        status=current_user.get("status", "Active"),
        section_access=current_user.get("section_access", "Default"),
        permissions=current_user.get("permissions", "Default"),
        attendance=current_user.get("attendance", "Not Present"),
        assigned_project=current_user.get("assigned_project", "All Projects"),
        created_at=current_user.get("created_at")
    )


# ─── USER MANAGEMENT ENDPOINTS (ADMIN ONLY) ───────────────────────────────────

@router.get("/users", response_model=List[UserResponse])
def get_users(admin: dict = Depends(require_admin)):
    """List all registered users for management (Admin only)."""
    users = list_all_users()
    return [
        UserResponse(
            id=u["id"],
            name=u["name"],
            email=u["email"],
            role=u["role"],
            category=u.get("category", "Internal"),
            status=u.get("status", "Active"),
            section_access=u.get("section_access", "Default"),
            permissions=u.get("permissions", "Default"),
            attendance=u.get("attendance", "Not Present"),
            assigned_project=u.get("assigned_project", "All Projects"),
            created_at=u.get("created_at")
        )
        for u in users
    ]


@router.post("/users", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: CreateUserRequest, admin: dict = Depends(require_admin)):
    """Admin endpoint to create a user login credential."""
    clean_email = payload.email.strip().lower()

    existing_user = get_user_by_email(clean_email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists."
        )

    pwd_hash = hash_password(payload.password)
    new_user = create_user(
        name=payload.name,
        email=clean_email,
        password_hash=pwd_hash,
        role=payload.role or "INTERNAL_ASSOCIATE",
        category=payload.category or "Internal",
        status=payload.status or "Active",
        section_access=payload.section_access or "Default",
        permissions=payload.permissions or "Default",
        assigned_project=payload.assigned_project or "All Projects"
    )

    admin_email = admin.get("email", "admin")
    insert_audit_log(
        user_email=admin_email, 
        action=f"Created User Account ({clean_email}): Role='{payload.role or 'INTERNAL_ASSOCIATE'}', Category='{payload.category or 'Internal'}', Section Access='{payload.section_access or 'Default'}', Action Permissions='{payload.permissions or 'Default'}', Assigned Project='{payload.assigned_project or 'All Projects'}'", 
        status="Success",
        module="RBAC / User Management"
    )

    token = create_access_token(new_user)

    return AuthResponse(
        status="success",
        message=f"Created user credential for {clean_email}.",
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=new_user["id"],
            name=new_user["name"],
            email=new_user["email"],
            role=new_user["role"],
            category=new_user.get("category", "Internal"),
            status=new_user.get("status", "Active"),
            section_access=new_user.get("section_access", "Default"),
            permissions=new_user.get("permissions", "Default"),
            assigned_project=new_user.get("assigned_project", "All Projects"),
            created_at=new_user.get("created_at")
        )
    )


@router.put("/users/{user_id}/status", response_model=UserResponse)
def update_status_endpoint(user_id: int, payload: UpdateUserStatusRequest, admin: dict = Depends(require_admin)):
    """Toggle user status ('Active' or 'Disabled') (Admin only)."""
    updated = update_user_status(user_id, payload.status)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    admin_email = admin.get("email", "admin")
    insert_audit_log(
        user_email=admin_email, 
        action=f"Changed Account Status ({updated['email']}) to '{payload.status}'", 
        status="Warning" if payload.status == "Disabled" else "Success",
        module="RBAC / User Management"
    )
    return UserResponse(
        id=updated["id"],
        name=updated["name"],
        email=updated["email"],
        role=updated["role"],
        category=updated.get("category", "Internal"),
        status=updated.get("status", "Active"),
        section_access=updated.get("section_access", "Default"),
        permissions=updated.get("permissions", "Default"),
        assigned_project=updated.get("assigned_project", "All Projects"),
        created_at=updated.get("created_at")
    )


@router.put("/users/{user_id}/role", response_model=UserResponse)
def update_role_endpoint(user_id: int, payload: UpdateUserRoleRequest, admin: dict = Depends(require_admin)):
    """Change user role, category, section_access, permissions, and assigned_project (Admin only)."""
    updated = update_user_role(
        user_id, 
        payload.role, 
        payload.category, 
        payload.section_access, 
        payload.permissions,
        payload.assigned_project
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    admin_email = admin.get("email", "admin")
    insert_audit_log(
        user_email=admin_email, 
        action=f"Updated User RBAC Profile ({updated['email']}): Role='{payload.role}', Category='{payload.category}', Section Access='{payload.section_access}', Action Permissions='{payload.permissions}', Assigned Project='{payload.assigned_project or updated.get('assigned_project', 'All Projects')}'", 
        status="Success",
        module="RBAC / User Management"
    )
    return UserResponse(
        id=updated["id"],
        name=updated["name"],
        email=updated["email"],
        role=updated["role"],
        category=updated.get("category", "Internal"),
        status=updated.get("status", "Active"),
        section_access=updated.get("section_access", "Default"),
        permissions=updated.get("permissions", "Default"),
        attendance=updated.get("attendance", "Not Present"),
        assigned_project=updated.get("assigned_project", "All Projects"),
        created_at=updated.get("created_at")
    )


@router.put("/users/{user_id}/attendance", response_model=UserResponse)
def update_user_attendance_endpoint(user_id: int, payload: UpdateAttendanceRequest, admin: dict = Depends(require_admin)):
    """Update single user attendance status in Supabase DB (Admin only)."""
    updated = update_user_attendance(user_id, payload.attendance)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    admin_email = admin.get("email", "admin")
    insert_audit_log(
        user_email=admin_email, 
        action=f"Updated User Attendance ({updated['email']}: {payload.attendance})", 
        status="Success",
        module="RBAC / User Management"
    )
    return UserResponse(
        id=updated["id"],
        name=updated["name"],
        email=updated["email"],
        role=updated["role"],
        category=updated.get("category", "Internal"),
        status=updated.get("status", "Active"),
        section_access=updated.get("section_access", "Default"),
        permissions=updated.get("permissions", "Default"),
        attendance=updated.get("attendance", "Not Present"),
        created_at=updated.get("created_at")
    )


@router.post("/users/attendance/mark-all")
def mark_all_attendance_endpoint(payload: MarkAllAttendanceRequest, admin: dict = Depends(require_admin)):
    """Bulk update attendance for all users in Supabase DB (Admin only)."""
    update_all_users_attendance(payload.attendance)
    admin_email = admin.get("email", "admin")
    insert_audit_log(
        user_email=admin_email, 
        action=f"Bulk Updated All Users Attendance: {payload.attendance}", 
        status="Success",
        module="RBAC / User Management"
    )
    return {"message": f"Successfully updated attendance for all users to '{payload.attendance}' in Supabase DB."}


@router.delete("/users/{user_id}")
def delete_user_endpoint(user_id: int, background_tasks: BackgroundTasks, admin: dict = Depends(require_admin)):
    """Delete user profile permanently (Admin only)."""
    deleted_email = delete_user_by_id(user_id)
    if not deleted_email:
        raise HTTPException(status_code=404, detail="User not found.")
    
    admin_email = admin.get("email", "admin")
    background_tasks.add_task(
        insert_audit_log,
        user_email=admin_email, 
        action=f"Deleted User Account ({deleted_email})", 
        status="Warning",
        module="RBAC / User Management"
    )
    return {"status": "success", "message": "User profile deleted."}


@router.put("/update-profile", response_model=AuthResponse)
def update_profile(payload: UpdateProfileRequest, current_user: dict = Depends(get_current_user)):
    """Update profile name for currently authenticated user."""
    clean_email = payload.email.strip().lower()

    if clean_email != current_user.get("email", "").lower() and str(current_user.get("role", "")).upper() != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify another user's profile.")

    updated_user = update_user_name(clean_email, payload.name)
    if not updated_user:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update profile name.")

    insert_audit_log(user_email=clean_email, action="Profile Updated", status="Success")

    token = create_access_token(updated_user)

    return AuthResponse(
        status="success",
        message="Profile updated successfully.",
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=updated_user["id"],
            name=updated_user["name"],
            email=updated_user["email"],
            role=updated_user["role"],
            status=updated_user.get("status", "Active"),
            created_at=updated_user.get("created_at")
        )
    )


@router.put("/change-password", response_model=AuthResponse)
def change_password(payload: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    """Change password for currently authenticated user."""
    clean_email = payload.email.strip().lower()

    if clean_email != current_user.get("email", "").lower() and str(current_user.get("role", "")).upper() != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's password.")

    user = get_user_by_email(clean_email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if not verify_password(payload.current_password, user["password_hash"]):
        insert_audit_log(user_email=clean_email, action="Failed Password Change Attempt", status="Warning")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    new_hash = hash_password(payload.new_password)
    success = update_user_password(clean_email, new_hash)
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update password.")

    insert_audit_log(user_email=clean_email, action="Password Changed", status="Success")

    token = create_access_token(user)

    return AuthResponse(
        status="success",
        message="Password changed successfully.",
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            role=user["role"],
            status=user.get("status", "Active"),
            created_at=user.get("created_at")
        )
    )
