from fastapi import APIRouter, HTTPException, status
from auth.schemas import SignupRequest, LoginRequest, UpdateProfileRequest, ChangePasswordRequest, AuthResponse, UserResponse
from auth.security import hash_password, verify_password
from auth.db import get_user_by_email, create_user, update_user_name, update_user_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest):
    """
    POST /auth/signup
    Registers a new user with name, email, and hashed password in Supabase PostgreSQL.
    """
    clean_email = payload.email.strip().lower()

    # Check if email already exists
    existing_user = get_user_by_email(clean_email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists."
        )

    # Hash the user's password using bcrypt
    pwd_hash = hash_password(payload.password)

    # Create the user record
    new_user = create_user(
        name=payload.name,
        email=clean_email,
        password_hash=pwd_hash
    )

    return AuthResponse(
        status="success",
        message="User registered successfully.",
        user=UserResponse(
            id=new_user["id"],
            name=new_user["name"],
            email=new_user["email"],
            created_at=new_user.get("created_at")
        )
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    """
    POST /auth/login
    Authenticates user credentials against Supabase PostgreSQL.
    """
    clean_email = payload.email.strip().lower()

    # Find user by email
    user = get_user_by_email(clean_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    # Verify password hash
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credentials are wrong. Please try again."
        )

    return AuthResponse(
        status="success",
        message="Login successful.",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            created_at=user.get("created_at")
        )
    )


@router.put("/update-profile", response_model=AuthResponse)
def update_profile(payload: UpdateProfileRequest):
    """
    PUT /auth/update-profile
    Updates the display name of a user in Supabase PostgreSQL.
    """
    clean_email = payload.email.strip().lower()

    user = get_user_by_email(clean_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    updated_user = update_user_name(clean_email, payload.name)
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile name."
        )

    return AuthResponse(
        status="success",
        message="Profile updated successfully.",
        user=UserResponse(
            id=updated_user["id"],
            name=updated_user["name"],
            email=updated_user["email"],
            created_at=updated_user.get("created_at")
        )
    )


@router.put("/change-password", response_model=AuthResponse)
def change_password(payload: ChangePasswordRequest):
    """
    PUT /auth/change-password
    Verifies user's current password and updates it with a new hashed password in Supabase PostgreSQL.
    """
    clean_email = payload.email.strip().lower()

    user = get_user_by_email(clean_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    # Verify current password
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )

    new_hash = hash_password(payload.new_password)
    success = update_user_password(clean_email, new_hash)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update password."
        )

    return AuthResponse(
        status="success",
        message="Password changed successfully.",
        user=UserResponse(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            created_at=user.get("created_at")
        )
    )

