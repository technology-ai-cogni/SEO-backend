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
    role: Optional[str] = Field("INTERNAL_ASSOCIATE", description="User role")
    category: Optional[str] = Field("Internal", description="User category: Internal, Client Access, Vendor, Admin")
    status: Optional[str] = Field("Active", description="User status: Active or Disabled")
    section_access: Optional[str] = Field("Default", description="Section access level: Default, All Sections, Project Setup, etc.")
    permissions: Optional[str] = Field("Default", description="Action permissions: Default, View Only, View + Edit, etc.")
    assigned_project: Optional[str] = Field("All Projects", description="Assigned project for vendor access")


class UpdateUserStatusRequest(BaseModel):
    status: str = Field(..., description="Target status: Active or Disabled")


class UpdateUserRoleRequest(BaseModel):
    role: str = Field(..., description="Target role")
    category: Optional[str] = Field(None, description="Target category: Internal, Client Access, Vendor, Admin")
    section_access: Optional[str] = Field(None, description="Section access level")
    permissions: Optional[str] = Field(None, description="Action permissions string")
    assigned_project: Optional[str] = Field(None, description="Assigned project for vendor access")


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


class UpdateAttendanceRequest(BaseModel):
    attendance: str = Field("Present", description="Attendance status: Present or Not Present")


class MarkAllAttendanceRequest(BaseModel):
    attendance: str = Field("Present", description="Target attendance for all users")


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    category: Optional[str] = "Internal"
    status: Optional[str] = "Active"
    section_access: Optional[str] = "Default"
    permissions: Optional[str] = "Default"
    attendance: Optional[str] = "Not Present"
    assigned_project: Optional[str] = "All Projects"
    created_at: Optional[datetime] = None


class AuthResponse(BaseModel):
    status: str
    message: str
    user: Optional[UserResponse] = None
