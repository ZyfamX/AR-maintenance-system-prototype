# FastAPI routing, app setup, and mounting the static folder

import json
import os
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from typing import List
from datetime import datetime, UTC
# Import Pydantic schemas to validate data going out
from schemas import FaultCreate, FaultUpdate, ToolScan, UserLogin, UserOut, FaultOut, ToolOut
from security import verify_password, log_system_event, verify_audit_log
from sessions import generate_session, validate_session, update_expiry, remove_session

app = FastAPI(title="AR Maintenance System API")

# Reads data from a JSON file in the data/ directory
def read_json(filename: str):

    filepath = os.path.join("data", filename)

    if not os.path.exists(filepath):
        return []
    with open(filepath, "r") as file:
        return json.load(file)

def write_json(filename: str, data: list):

    filepath = os.path.join("data", filename)
    
    with open(filepath, "w") as file:
        json.dump(data, file, indent=4)


# Middleware for session authentication
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Routes that do NOT require authentication
    public_paths = [
        "/api/login",
        "/health",
        "/",
        "/static"
    ]

    if any(request.url.path.startswith(path) for path in public_paths):
        return await call_next(request)
    
    session_id = request.cookies.get("session_id")

    if not session_id:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    
    result = validate_session(session_id)

    if not result["valid"]:
        return JSONResponse(status_code=401, content={"detail": result["error"]})
    
    request.state.user_id = result["user_id"]
    # Update expiry so it only expires after 10 minutes of inactivity
    update_expiry(session_id)

    return await call_next(request)


# ensure the server is running
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Server is running"}


# Returns a list of all faults from the JSON database
@app.get("/api/faults", response_model=List[FaultOut])
def get_active_faults():
    faults = read_json("faults.json")
    return faults


# Returns a list of all tools from the JSON database
@app.get("/api/tools", response_model=List[ToolOut])
def get_all_tools():
    tools = read_json("tools.json")
    return tools


# USER ROUTE ==============================================================================================================================

@app.post("/api/login", response_model=UserOut)
def login_user(credentials: UserLogin, response: Response):

    users = read_json("users.json")

    for user in users:
        if user["username"] == credentials.username:
            if verify_password(credentials.password, user["password_hash"]):
                session_id = generate_session(user["id"])

                response.set_cookie(
                    key="session_id",
                    value=session_id,
                    httponly=True,
                    secure=False,
                    samesite="lax",
                    max_age=600
                )

                return user
            
            break # Correct username but wrong password
        
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/api/logout")
def logout(request: Request, response: Response):
    session_id = request.cookies.get("session_id")

    if session_id:
        remove_session(session_id)

    response.delete_cookie("session_id")

    return {"message": "Logged out successfully"}

# FAULT ROUTES ==============================================================================================================================

# Fetches a specific active/assigned fault when a user scans a wall marker in AR
@app.get("/api/faults/marker/{marker_id}", response_model=FaultOut)
def get_fault_by_marker(marker_id: str):

    faults = read_json("faults.json")

    for fault in faults:

        # AR needs to show the fault if it's active OR if someone is assigned to fix it
        if fault["marker_id"] == marker_id and fault["status"] in ["Active", "Assigned"]:
            return fault
        
    raise HTTPException(status_code=404, detail="No active or assigned fault found for this marker")


# Creates new fault record
@app.post("/api/faults", response_model=FaultOut, status_code=201)
def create_new_fault(payload: FaultCreate, request: Request):

    faults = read_json("faults.json")
    
    # Create new ID (highest ID + 1)
    new_id = max([f["id"] for f in faults], default=0) + 1
    
    new_fault = {
        "id": new_id,
        "marker_id": payload.marker_id,
        "title": payload.title,
        "description": payload.description,
        "location": payload.location,
        "status": "Active",
        "reported_by_id": request.state.user_id,
        "timestamp": datetime.now(UTC).isoformat() + "Z", # Standardized UTC format
        "assigned_to_id": None,      
        "resolved_by_id": None,
        "notes": None
    }
    
    faults.append(new_fault)
    write_json("faults.json", faults)

    # Log the action for the audit trail
    log_system_event(
        user_id=payload.reported_by_id, 
        action="FAULT_REPORTED", 
        details=f"New fault logged at {payload.location}: {payload.title}"
    )

    return new_fault


# Allows Supervisor to Update Faults (Assign or Resolve) from dashboard
@app.patch("/api/faults/{fault_id}", response_model=FaultOut)
def update_fault(fault_id: int, payload: FaultUpdate):

    faults = read_json("faults.json")
    
    for fault in faults:
        if fault["id"] == fault_id:
            
            # Update the fault with new assignment or resolution data
            fault["status"] = payload.status
            fault["assigned_to_id"] = payload.assigned_to_id
            fault["resolved_by_id"] = payload.resolved_by_id
            fault["resolution_notes"] = payload.resolution_notes
            
            write_json("faults.json", faults)

            # Log the update for the audit trail
            log_system_event(
                user_id=payload.resolved_by_id or payload.assigned_to_id, 
                action=f"FAULT_UPDATED_{payload.status.upper()}", 
                details=f"Fault {fault_id} status changed to {payload.status}."
            )

            return fault
            
    raise HTTPException(status_code=404, detail="Fault ID not found")


# TOOL ROUTES ==============================================================================================================================
# Handles the AR tool checkout/check-in logic automatically based on the current status
@app.post("/api/tools/scan", response_model=ToolOut)
def scan_tool_marker(payload: ToolScan):

    tools = read_json("tools.json")
    
    for tool in tools:

        if tool["marker_id"] == payload.marker_id:
            
            # Tool is available: Check it out
            if tool["status"] == "Available":

                tool["status"] = "Checked-Out"
                tool["current_user_id"] = payload.user_id
                tool["checkout_timestamp"] = datetime.now(UTC).isoformat() + "Z"# WHAT IS GOING ON WITH THIS TIMESTAMP FORMAT
                
                # Log the tool checkout event
                log_system_event(
                    user_id=payload.user_id, 
                    action="TOOL_CHECKOUT", 
                    details=f"Tool {tool['id']} checked out successfully."
                )

            # Tool is checked out by THIS user: Check it back in
            elif tool["status"] == "Checked-Out" and tool["current_user_id"] == payload.user_id:

                tool["status"] = "Available"
                tool["current_user_id"] = None
                tool["checkout_timestamp"] = None
                
            # Tool is checked out by SOMEONE ELSE: No Access
            else:
                raise HTTPException(status_code=403, detail="Tool is currently checked out by another user!")
                

            write_json("tools.json", tools)
            return tool
            
    raise HTTPException(status_code=404, detail="Tool marker not recognized in database")

# Security route to verify integrity of the audit log
@app.get("/api/audit/verify")
def verify_logs():
    result = verify_audit_log("data/audit.log")

    if not result["valid"]:
        raise HTTPException(
            status_code=500,
            detail=f"Audit log compromised at line {result['line']}: {result['error']}"
        )
    
    return {"status": "ok", "message": "Audit log integrity verified"}

app.mount("/static", StaticFiles(directory="static"), name="static")
@app.get("/")
def serve_home():
    return FileResponse("static/index.html")
