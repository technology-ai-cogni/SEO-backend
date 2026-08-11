from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Full name of the user")
    email: str = Field(..., min_length=3, max_length=255, description="Unique email address")
    password: str = Field(..., min_length=6, max_length=100, description="User password")


class CreateUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Full name of the user")
    email: str = Field(..., min_length=3, max_length=255, description="Unique email address")
    password: str = Field(..., min_length=6, max_length=100, description="User password")
    role: Optional[str] = Field("USER", description="User role: USER, ADMIN, VENDOR, etc.")
    status: Optional[str] = Field("Active", description="User status: Active or Disabled")


class UpdateUserStatusRequest(BaseModel):
    status: str = Field(..., description="Target status: Active or Disabled")


class UpdateUserRoleRequest(BaseModel):
    role: str = Field(..., description="Target role: ADMIN, USER, VENDOR, etc.")


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255, description="Registered email address")
    password: str = Field(..., min_length=1, max_length=100, description="User password")


class UpdateProfileRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255, description="Registered email address")
    name: str = Field(..., min_length=1, max_length=100, description="Updated full name")


class ChangePasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255, description="Registered email address")
    current_password: str = Field(..., min_length=1, max_length=100, description="Current password")
    new_password: str = Field(..., min_length=6, max_length=100, description="New password")


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    status: Optional[str] = "Active"
    created_at: Optional[datetime] = None


class AuthResponse(BaseModel):
    status: str
    message: str
    user: Optional[UserResponse] = None
