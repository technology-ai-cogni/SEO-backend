from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from auth.schemas import (
    SignupRequest, LoginRequest, UpdateProfileRequest, ChangePasswordRequest, 
    AuthResponse, UserResponse, CreateUserRequest, UpdateUserStatusRequest, UpdateUserRoleRequest,
    UpdateAttendanceRequest, MarkAllAttendanceRequest
)
from auth.security import hash_password, verify_password
from auth.db import (
    get_user_by_email, create_user, update_user_name, update_user_password,
    list_all_users, update_user_status, update_user_role, delete_user_by_id,
    update_user_attendance, update_all_users_attendance
)
from core.db import insert_audit_log

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest):
    clean_email = payload.email.strip().lower()

    existing_user = get_user_by_email(clean_email)
    if existing_user:
        insert_audit_log(user_email=clean_email, action="User Registration Failed (Email Exists)", status="Warning")
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

    insert_audit_log(user_email=clean_email, action="User Registered", status="Success")

    return AuthResponse(
        status="success",
        message="User registered successfully.",
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
def login(payload: LoginRequest):
    clean_email = payload.email.strip().lower()

    user = get_user_by_email(clean_email)
    if not user:
        insert_audit_log(user_email=clean_email, action="Failed Login Attempt (User Not Found)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    if user.get("status") == "Disabled":
        insert_audit_log(user_email=clean_email, action="Failed Login Attempt (Account Disabled)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your profile has been disabled by administrator. Please contact your admin."
        )

    if not verify_password(payload.password, user["password_hash"]):
        insert_audit_log(user_email=clean_email, action="Failed Login Attempt (Incorrect Password)", status="Warning")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    insert_audit_log(user_email=clean_email, action="User Login", status="Success")

    return AuthResponse(
        status="success",
        message="Login successful.",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            role=user["role"],
            category=user.get("category", "Internal"),
            status=user.get("status", "Active"),
            section_access=user.get("section_access", "Default"),
            permissions=user.get("permissions", "Default"),
            created_at=user.get("created_at")
        )
    )


# ─── USER MANAGEMENT ENDPOINTS (ADMIN ONLY) ───────────────────────────────────

@router.get("/users", response_model=List[UserResponse])
def get_users():
    """List all registered users for management."""
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
            created_at=u.get("created_at")
        )
        for u in users
    ]


@router.post("/users", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: CreateUserRequest):
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
        permissions=payload.permissions or "Default"
    )

    insert_audit_log(user_email="admin", action=f"Admin Created User Credential: {clean_email}", status="Success")

    return AuthResponse(
        status="success",
        message=f"Created user credential for {clean_email}.",
        user=UserResponse(
            id=new_user["id"],
            name=new_user["name"],
            email=new_user["email"],
            role=new_user["role"],
            category=new_user.get("category", "Internal"),
            status=new_user.get("status", "Active"),
            section_access=new_user.get("section_access", "Default"),
            permissions=new_user.get("permissions", "Default"),
            created_at=new_user.get("created_at")
        )
    )


@router.put("/users/{user_id}/status", response_model=UserResponse)
def update_status_endpoint(user_id: int, payload: UpdateUserStatusRequest):
    """Toggle user status ('Active' or 'Disabled')."""
    updated = update_user_status(user_id, payload.status)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    insert_audit_log(
        user_email="admin", 
        action=f"Changed User Status ({updated['email']}) to {payload.status}", 
        status="Warning" if payload.status == "Disabled" else "Success"
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
        created_at=updated.get("created_at")
    )


@router.put("/users/{user_id}/role", response_model=UserResponse)
def update_role_endpoint(user_id: int, payload: UpdateUserRoleRequest):
    """Change user role, category, section_access, and permissions."""
    updated = update_user_role(
        user_id, 
        payload.role, 
        payload.category, 
        payload.section_access, 
        payload.permissions
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    insert_audit_log(user_email="admin", action=f"Updated User Settings ({updated['email']})", status="Success")
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


@router.put("/users/{user_id}/attendance", response_model=UserResponse)
def update_user_attendance_endpoint(user_id: int, payload: UpdateAttendanceRequest):
    """Update single user attendance status in Supabase DB."""
    updated = update_user_attendance(user_id, payload.attendance)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    
    insert_audit_log(user_email="admin", action=f"Updated User Attendance ({updated['email']}: {payload.attendance})", status="Success")
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
def mark_all_attendance_endpoint(payload: MarkAllAttendanceRequest):
    """Bulk update attendance for all users in Supabase DB."""
    update_all_users_attendance(payload.attendance)
    insert_audit_log(user_email="admin", action=f"Bulk Updated All Users Attendance: {payload.attendance}", status="Success")
    return {"message": f"Successfully updated attendance for all users to '{payload.attendance}' in Supabase DB."}


@router.delete("/users/{user_id}")
def delete_user_endpoint(user_id: int):
    """Delete user profile permanently."""
    success = delete_user_by_id(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found.")
    
    insert_audit_log(user_email="admin", action=f"Deleted User Account ID {user_id}", status="Warning")
    return {"status": "success", "message": "User profile deleted."}


@router.put("/update-profile", response_model=AuthResponse)
def update_profile(payload: UpdateProfileRequest):
    clean_email = payload.email.strip().lower()

    user = get_user_by_email(clean_email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    updated_user = update_user_name(clean_email, payload.name)
    if not updated_user:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update profile name.")

    insert_audit_log(user_email=clean_email, action="Profile Updated", status="Success")

    return AuthResponse(
        status="success",
        message="Profile updated successfully.",
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
def change_password(payload: ChangePasswordRequest):
    clean_email = payload.email.strip().lower()

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

    return AuthResponse(
        status="success",
        message="Password changed successfully.",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            role=user["role"],
            status=user.get("status", "Active"),
            created_at=user.get("created_at")
        )
    )
