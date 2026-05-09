# Pydantic validation models (for secure input/output checking)
import re
from pydantic import BaseModel, Field, field_validator
from typing import Optional

# USER SCHEMAS ================================================================================================================
class UserLogin(BaseModel):
    
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):

    id: int
    username: str
    first_name: str
    last_name: str
    role: str

# FAULT SCHEMAS ================================================================================================================

# What the AR app sends when scanning a new fault
class FaultCreate(BaseModel):
    marker_id: str = Field(min_length=1, max_length=50) 
    title: str = Field(min_length=5, max_length=100)
    description: str = Field(min_length=10, max_length=500)
    location: str = Field(min_length=3, max_length=100)
    priority: str = Field(pattern="^(Low|Medium|High)$")

    # Added GPS coordinates
    user_lat: float
    user_lon: float


# What the Supervisor dashboard sends to assign OR resolve a fault
class FaultUpdate(BaseModel):

    status: str = Field(pattern="^(In-Review|Active|In-Progress|Resolved)$")
    priority: Optional[str] = Field(default=None, pattern="^(Low|Medium|High)$")
    assigned_to_id: Optional[int] = None
    resolved_by_id: Optional[int] = None
    notes: Optional[str] = None


    # Added GPS coordinates - Only used for Technician 
    user_lat: Optional[float] = None
    user_lon: Optional[float] = None

# What the backend sends to the dashboard list
class FaultOut(BaseModel):

    id: int
    marker_id: str
    title: str
    description: str
    location: str
    status: str
    timestamp: str
    reported_by_id: int
    priority: Optional[str] = None
    assigned_to_id: Optional[int] = None
    resolved_by_id: Optional[int] = None
    notes: Optional[str] = None


# TOOL SCHEMAS ===============================================================================================================

# What the AR app sends when a tool marker is scanned
class ToolScan(BaseModel):
    marker_id: str = Field(min_length=1, max_length=50) # Fixed min_length

    # Added GPS coordinates
    user_lat: float
    user_lon: float


# What the backend sends to the dashboard list
class ToolOut(BaseModel):
    
    id: int
    marker_id: str
    tool_type: str
    status: str
    storage_location: str
    current_user_id: Optional[int] = None
    checkout_timestamp: Optional[str] = None


# =================================================================================================================
# AUDIT LOG SCHEMAS

class AuditlogCreate(BaseModel):

    timestamp: str
    user_id: Optional[int] = None # Nullable
    action: str  # "Successful_Login", "Tool_Checked_Out", "Fault_Reported"
    details: str # "User J.Smith checked out tool 1" or "Fault 5 reported at location X"
