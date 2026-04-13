# Pydantic validation models (for secure input/output checking)

from pydantic import BaseModel, Field
from typing import Optional

# ================================================================================================================
# USER SCHEMAS
class UserLogin(BaseModel):
    
    username: str
    password: str


class UserOut(BaseModel):

    id: int
    username: str
    first_name: str
    last_name: str
    role: str

# ================================================================================================================
# FAULT SCHEMAS

# What the AR app sends when scanning a new fault
class FaultCreate(BaseModel):

    marker_id: str = Field(min_length=3, max_length=50)
    title: str = Field(min_length=5, max_length=100)
    description: str = Field(min_length=10, max_length=500)
    location: str = Field(min_length=3, max_length=100)
    reported_by_id: int # Reference to the user ID who reported the fault


# What the Supervisor dashboard sends to resolve a fault
class FaultUpdate(BaseModel):

    status: str = Field(pattern="^(Active|Resolved)$")
    resolved_by_id: int
    resolution_notes: Optional[str] = None


# What the backend sends to the dashboard list
class FaultOut(BaseModel):

    id: int
    marker_id: str
    title: str
    description: str
    location: str
    status: str
    reported_by_id: int
    timestamp: str
    resolved_by_id: Optional[int] = None
    resolution_notes: Optional[str] = None

# ===============================================================================================================
# TOOL SCHEMAS

# What the AR app sends when a tool marker is scanned
class ToolScan(BaseModel):
    
    marker_id: str = Field(min_length=3, max_length=50)
    user_id: int


# What the backend sends to the dashboard list (Updated for Fleet Approach)
class ToolOut(BaseModel):
    
    asset_id: str
    marker_id: str
    category: str
    status: str
    current_user_id: Optional[int] = None
    checkout_timestamp: Optional[str] = None

