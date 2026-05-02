import json
import os

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from typing import List
from datetime import datetime, timedelta, UTC
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
    
    with open(filepath, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4)


# Middleware for session authentication
@app.middleware("http")
async def auth_middleware(request: Request, call_next):

    # Routes that do NOT require authentication
    public_paths = [
        "/api/login",
        "/health",
        "/static"
    ]

    if request.url.path == "/" or request.url.path.startswith("/static"):
        return await call_next(request)

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


# Returns active faults, filtered securely by Role
@app.get("/api/faults", response_model=List[FaultOut])
def get_active_faults(request: Request):

    faults = read_json("faults.json")
    users = read_json("users.json")
    
    # Identify the user
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)

    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")
        
    # Supervisors see everything
    if current_user["role"] in ["Supervisor", "Administrator"]:
        return faults
        
    # Technicians only see faults they are assigned to, or faults they reported
    technician_faults = [
        f for f in faults 
        if f.get("assigned_to_id") == request.state.user_id 
        or f.get("reported_by_id") == request.state.user_id
    ]

    return technician_faults


# Returns tool status, filtered securely by Role
@app.get("/api/tools", response_model=List[ToolOut])
def get_all_tools(request: Request):

    tools = read_json("tools.json")
    users = read_json("users.json")
    
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)
    
    if current_user and current_user["role"] in ["Supervisor", "Administrator"]:
        return tools
        
    # Technicians only see tools they currently have checked out
    technician_tools = [t for t in tools if t.get("current_user_id") == request.state.user_id]

    return technician_tools


# USER ROUTE ==============================================================================================================================

# Failed login attempt lock config according to requirement F8
lock_threshold = 5
lock_duration_minutes = 10
fault_submission_timestamps = {} # Stores {user_id: datetime}

@app.post("/api/login", response_model=UserOut)
def login_user(credentials: UserLogin, response: Response):

    users = read_json("users.json")
    now = datetime.now(UTC)

    user_found = False

    for user in users:

        if user["username"] == credentials.username:

            user_found = True

            # Check if account locked
            if user["lock_until"]:

                lock_time = datetime.fromisoformat(user["lock_until"])

                if now < lock_time:

                    log_system_event(user["id"], "Blocked_Login", "Attempt to log in to locked account.")
                    raise HTTPException(status_code=403, detail="Account temporarily locked")
                
                else:

                    user["lock_until"] = None
                    user["failed_attempts"] = 0

            # Check password
            if verify_password(credentials.password, user["password_hash"]):

                user["lock_until"] = None
                user["failed_attempts"] = 0

                write_json("users.json", users)

                session_id = generate_session(user["id"])

                response.set_cookie(
                    key="session_id",
                    value=session_id,
                    httponly=True,
                    secure=False, #TODO: should be true for better security but may break some people's testing if they use HTTP
                    samesite="lax",
                    max_age=600
                )

                log_system_event(user["id"], "Successful_Login", f"User {user["username"]} successfully logged in.")

                return user
            
            # Wrong password
            user["failed_attempts"] += 1

            if user["failed_attempts"] >= lock_threshold:

                user["lock_until"] = (now + timedelta(minutes=lock_duration_minutes)).isoformat()
                user["failed_attempts"] = 0

                log_system_event(user["id"], "Account_Locked", f"Too many failed login attempts.")

            else:
                log_system_event(user["id"], "Unsuccessful_Login", f"Wrong password entered for user {user["username"]}.")
            
            write_json("users.json", users)

            break

    # Unknown username or failed login
    if not user_found:
        log_system_event(None, "Unsuccessful_Login", f"Unknown username: {credentials.username}")
        
    raise HTTPException(status_code=401, detail="Invalid username or password")

# Logs out the user, with a safety check for unreturned tools (Requirement F24)
@app.post("/api/logout")
def logout(request: Request, response: Response, force: bool = False):

    session_id = request.cookies.get("session_id")

    if not session_id:
        return {"message": "Already logged out"}

    # 1. We need the user_id to check their tools before we destroy the session
    session_data = validate_session(session_id)
    user_id = session_data.get("user_id")

    if user_id and not force:

        # --- REQUIREMENT F24 (Tool Check) ---
        tools = read_json("tools.json")
        
        # Find all tools currently checked out by this user
        unreturned_tools = [t for t in tools if t.get("current_user_id") == user_id]
        
        if unreturned_tools:

            # Tell the frontend to halt and show the warning prompt
            tool_ids = ", ".join([str(t["id"]) for t in unreturned_tools])

            raise HTTPException(
                status_code=409, # 409 Conflict indicates a logic state issue
                detail=f"WARNING_UNRETURNED_TOOLS:{tool_ids}" 
            )

    # 2. Proceed with actual logout (either no tools, or force=True)
    remove_session(session_id)
    response.delete_cookie("session_id")

    if user_id:

        log_system_event(
            user_id=user_id, 
            action="SUCCESSFUL_LOGOUT", 
            details=f"User logged out. Forced: {force}"
        )

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
    
    user_id = request.state.user_id
    now = datetime.now(UTC)

    # --- 1. RATE LIMITING LOGIC (Requirement F5) ---
    last_submission = fault_submission_timestamps.get(user_id)
    
    if last_submission:

        time_since_last = (now - last_submission).total_seconds()

        if time_since_last < 5.0:

            # Log the spam attempt
            log_system_event(
                user_id=user_id, 
                action="RATE_LIMIT_EXCEEDED", 
                details="User attempted to submit multiple faults within 5 seconds."
            )
            raise HTTPException(
                status_code=429, # Standard HTTP code for "Too Many Requests"
                detail=f"Please wait {5 - int(time_since_last)} seconds before submitting another fault."
            )
        
            
    # Update the user's last submission time to RIGHT NOW
    fault_submission_timestamps[user_id] = now
    # -----------------------------------------------

    # 2. Proceed with normal fault creation
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
        "reported_by_id": user_id,
        "timestamp": now.isoformat() + "Z", # Standardized UTC format
        "assigned_to_id": None,      
        "resolved_by_id": None,
        "notes": None
    }
    
    faults.append(new_fault)
    write_json("faults.json", faults)

    # Log the successful action for the audit trail
    log_system_event(
        user_id=user_id, 
        action="FAULT_REPORTED", 
        details=f"New fault logged at {payload.location}: {payload.title}"
    )

    return new_fault


# Allows Supervisor to Assign/Resolve, and Techs to add notes
@app.patch("/api/faults/{fault_id}", response_model=FaultOut)
def update_fault(fault_id: int, payload: FaultUpdate, request: Request):
    
    faults = read_json("faults.json")
    users = read_json("users.json")
    
    # 1. Fetch the current user's role from the database using their session ID
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)
    
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")
        
    role = current_user.get("role")

    for fault in faults:

        if fault["id"] == fault_id:
            
            # 2. RBAC ENFORCEMENT: TECHNICIAN RULES
            if role == "Technician":

                # Techs cannot resolve faults or assign users
                if payload.status == "Resolved" or payload.assigned_to_id is not None:
                    
                    # Log the security violation!
                    log_system_event(
                        user_id=request.state.user_id, 
                        action="UNAUTHORIZED_ACTION", 
                        details=f"Technician attempted to resolve/assign fault {fault_id}."
                    )
                    raise HTTPException(status_code=403, detail="Technicians cannot assign or resolve faults. Supervisor approval required.")
                
                # Techs CAN update the notes for the supervisor to read
                if payload.notes is not None:
                    fault["notes"] = payload.notes
                    fault["status"] = payload.status # e.g., keeping it as "Assigned"

            # 3. RBAC ENFORCEMENT: SUPERVISOR RULES
            elif role in ["Supervisor", "Administrator"]:

                fault["status"] = payload.status
                
                if payload.assigned_to_id is not None:
                    fault["assigned_to_id"] = payload.assigned_to_id
                if payload.resolved_by_id is not None:
                    fault["resolved_by_id"] = payload.resolved_by_id
                if payload.notes is not None:
                    fault["notes"] = payload.notes

            # 4. Save to database
            write_json("faults.json", faults)

            # 5. Log the successful update
            log_system_event(
                user_id=request.state.user_id, 
                action=f"FAULT_UPDATED", 
                details=f"Fault {fault_id} updated by {role}."
            )

            return fault
        
            
    raise HTTPException(status_code=404, detail="Fault ID not found")



# Deletes a fault record (Supervisor only) - Requirement F28
@app.delete("/api/faults/{fault_id}")
def delete_fault(fault_id: int, request: Request):
    
    users = read_json("users.json")
    faults = read_json("faults.json")

    # 1. Fetch the current user's role
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)
    
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")
        
    role = current_user.get("role")

    # 2. RBAC ENFORCEMENT: ONLY SUPERVISORS CAN DELETE
    if role not in ["Supervisor", "Administrator"]:
        
        # Log the security violation!
        log_system_event(
            user_id=request.state.user_id, 
            action="UNAUTHORIZED_DELETE_ATTEMPT", 
            details=f"Technician attempted to delete fault {fault_id}."
        )
        raise HTTPException(status_code=403, detail="Only Supervisors can delete faults.")

    # 3. Find and remove the fault
    fault_to_delete = None

    for i, fault in enumerate(faults):
        
        if fault["id"] == fault_id:
            fault_to_delete = faults.pop(i) # Removes the item from the list
            break


    if not fault_to_delete:
        raise HTTPException(status_code=404, detail="Fault ID not found")


    # 4. Save the updated database
    write_json("faults.json", faults)

    # 5. Log the deletion to the audit trail
    log_system_event(
        user_id=request.state.user_id, 
        action="FAULT_DELETED", 
        details=f"Fault {fault_id} ('{fault_to_delete['title']}') deleted by {role}."
    )

    return {"message": f"Fault {fault_id} successfully deleted."}


# TOOL ROUTES ==========================================================================================================

# Pure GET route: AR app uses this just to "look" at the tool and render the 3D overlay
@app.get("/api/tools/marker/{marker_id}", response_model=ToolOut)
def get_tool_by_marker(marker_id: str):

    tools = read_json("tools.json")

    for tool in tools:

        if tool["marker_id"] == marker_id:
            return tool
    raise HTTPException(status_code=404, detail="Tool marker not recognized in database")



# Handles the AR tool checkout/check-in logic automatically based on the current status
@app.post("/api/tools/scan", response_model=ToolOut)
def scan_tool_marker(payload: ToolScan, request: Request):
    tools = read_json("tools.json")
    
    for tool in tools:

        if tool["marker_id"] == payload.marker_id:
            
            # Tool is available: Check it out
            if tool["status"] == "Available":
                tool["status"] = "Checked-Out"
                tool["current_user_id"] = request.state.user_id
                tool["checkout_timestamp"] = datetime.now(UTC).isoformat() + "Z"
                
                log_system_event(
                    user_id=request.state.user_id, 
                    action="TOOL_CHECKOUT", 
                    details=f"Tool {tool['id']} checked out successfully."
                )

            # Tool is checked out by THIS user: Check it back in
            elif tool["status"] == "Checked-Out" and tool["current_user_id"] == request.state.user_id:

                tool["status"] = "Available"
                tool["current_user_id"] = None
                tool["checkout_timestamp"] = None
                
                # ADDED MISSING AUDIT LOG
                log_system_event(
                    user_id=request.state.user_id, 
                    action="TOOL_CHECKIN", 
                    details=f"Tool {tool['id']} checked back in."
                )
                
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
