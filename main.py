# FastAPI routing, app setup, and mounting the static folder

import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List
from datetime import datetime
from schemas import FaultCreate, FaultUpdate, ToolScan, UserLogin, UserOut

# Import Pydantic schemas to validate data going out
from schemas import FaultOut, ToolOut

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
def login_user(credentials: UserLogin):

    users = read_json("users.json")

    for user in users:

        # We need to hash credentials password and compare it
        if user["username"] == credentials.username:
            return user
        
    raise HTTPException(status_code=401, detail="Invalid username or password")


# FAULT ROUTES ==============================================================================================================================

# Fetches a specific active fault when a user scans a wall marker in AR
@app.get("/api/faults/marker/{marker_id}", response_model=FaultOut)
def get_fault_by_marker(marker_id: str):

    faults = read_json("faults.json")

    for fault in faults:

        if fault["marker_id"] == marker_id and fault["status"] == "Active":
            return fault
        
    raise HTTPException(status_code=404, detail="No active fault found for this marker")


# Creates new fault record when a technician submits a report from the AR app
@app.post("/api/faults", response_model=FaultOut, status_code=201)
def create_new_fault(payload: FaultCreate):

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
        "reported_by_id": payload.reported_by_id,
        "timestamp": datetime.utcnow().isoformat(), # WHAT IS GOING ON WITH THIS TIMESTAMP FORMAT
        "resolved_by_id": None,
        "resolution_notes": None
    }
    
    faults.append(new_fault)
    write_json("faults.json", faults)

    return new_fault


# Allows Supervisor to Update Faults status to "Resolved" from dashboard
@app.patch("/api/faults/{fault_id}", response_model=FaultOut)
def resolve_fault(fault_id: int, payload: FaultUpdate):

    faults = read_json("faults.json")
    
    for fault in faults:

        if fault["id"] == fault_id:

            fault["status"] = payload.status
            fault["resolved_by_id"] = payload.resolved_by_id
            fault["resolution_notes"] = payload.resolution_notes
            write_json("faults.json", faults)

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
                tool["checkout_timestamp"] = datetime.utcnow().isoformat() # WHAT IS GOING ON WITH THIS TIMESTAMP FORMAT
                
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



# Helper function to record system events for security and auditing purposes
def log_system_event(user_id: int, action: str, details: str):
    """Helper function to record security and system events."""
    logs = read_json("audit_logs.json")
    
    # Get New ID (highest existing ID + 1)
    new_id = max([log.get("id", 0) for log in logs], default=0) + 1
    
    new_log = {
        "id": new_id,
        "timestamp": datetime.utcnow().isoformat(),
        "user_id": user_id,
        "action": action,
        "details": details,
    }
    
    logs.append(new_log)
    write_json("audit_logs.json", logs)


app.mount("/static", StaticFiles(directory="static"), name="static")
@app.get("/")
def serve_home():
    return FileResponse("static/index.html")
