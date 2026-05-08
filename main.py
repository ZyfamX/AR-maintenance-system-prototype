import json
import os

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from typing import List
from datetime import datetime, timedelta, UTC

from schemas import FaultCreate, FaultUpdate, ToolScan, UserLogin, UserOut, FaultOut, ToolOut
from security import verify_password, log_system_event, verify_audit_log, start_security_threads
from sessions import generate_session, validate_session, update_expiry, remove_session
from threading import Lock


app = FastAPI(title="AR Maintenance System API")

# Starts security-related background threads
start_security_threads()

# IP Rate Limiting Config
auth_ip_attempts = {}
auth_window = timedelta(minutes=1)
auth_max_requests = 60
auth_block_duration = timedelta(minutes=5)

ip_lock = Lock()
auth_ip_lock = Lock()

# Reads data from a JSON file in the data/ directory
def read_json(filename: str):

    filepath = os.path.join("data", filename)

    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as file:
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
        "/static",
        "/docs",
        "/openapi.json"
    ]

    if request.url.path == "/" or request.url.path.startswith("/static"):
        return await call_next(request)

    if any(request.url.path.startswith(path) for path in public_paths):
        return await call_next(request)
    
    session_id = request.cookies.get("session_id")

    if not session_id:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    
    try:
        result = validate_session(session_id)
    except Exception as e:
        print(f"[AUTH ERROR] {e}")
        result = {
            "valid": False,
            "user_id": None,
            "csrf_token": None,
            "error": e
        }

    if not result["valid"]:
        return JSONResponse(status_code=401, content={"detail": result["error"]})
    
    client = request.client
    client_ip = client.host if client else "unknown"
    now = datetime.now(UTC)

    if result["valid"]:
        session_ip = result.get("ip")
        if session_id and session_ip != client_ip:
            log_system_event(result["user_id"], "IP_Mismatch", "Session IP differs to request IP.", client_ip)
            
            # We can make this block requests, but would likely break anyone connecting through a mobile network where their IP might change
            # return JSONResponse(status_code=401, content={"detail": "Session IP mismatch"})
    
    request.state.user_id = result["user_id"]

    with auth_ip_lock:
        ip_data = auth_ip_attempts.get(client_ip, {
            "count": 0,
            "first": now,
            "blocked_until": None
        })

        if ip_data["blocked_until"] and now < ip_data["blocked_until"]:
            log_system_event(request.state.user_id, "Rate_Limited", f"Too many requests from IP {client_ip}", client_ip)
            return JSONResponse(status_code=429, content={"detail": "Too Many Requests"})
        
        if now - ip_data["first"] > auth_window:
            ip_data = {"count": 0, "first": now, "blocked_until": None}

        ip_data["count"] += 1

        if ip_data["count"] >= auth_max_requests:
            ip_data["blocked_until"] = now + auth_block_duration

        auth_ip_attempts[client_ip] = ip_data

    if request.method in ["POST", "PUT", "PATCH", "DELETE"]:
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_header = request.headers.get("X-CSRF-Token")

        if not csrf_cookie or not csrf_header:
            return JSONResponse(status_code=403, content={"detail": "CSRF token missing"})
        
        if csrf_cookie != csrf_header:
            return JSONResponse(status_code=403, content={"detail": "CSRF token invalid"})
        
        session_data = validate_session(session_id)

        stored_token = None
        if session_data["valid"]:
            if csrf_cookie != session_data["csrf_token"]:
                return JSONResponse(status_code=403, content={"detail": "CSRF token invalid"})


    # Update expiry so it only expires after 10 minutes of inactivity
    if request.url.path != "/api/check-session":
        update_expiry(session_id)

    return await call_next(request)


# ensure the server is running
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Server is running"}

# simple authourised route to check if current session is valid
@app.get("/api/check-session")
def check_session(request: Request):
    return {"valid": True, "user_id": request.state.user_id}

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



@app.get("/api/tools", response_model=List[ToolOut])
def get_all_tools(request: Request):

    # Fetch all tools from the database
    tools = read_json("tools.json")

    return tools


# USER ROUTE ==============================================================================================================================

# Failed login attempt lock config according to requirement F8
lock_threshold = 5
lock_duration_minutes = 10
fault_submission_timestamps = {} # Stores {user_id: datetime}

perm_lock_threshold = 2
perm_lock_window_hours = 24

ip_attempts = {}

@app.post("/api/login", response_model=UserOut)
def login_user(credentials: UserLogin, response: Response, request: Request):

    now = datetime.now(UTC)
    client = request.client
    client_ip = client.host if client else "unknown"

    with ip_lock:
        ip_data = ip_attempts.get(client_ip, {
            "count": 0,
            "first": now,
            "blocked_until": None
        })

        if ip_data["blocked_until"] and now < ip_data["blocked_until"]:
            raise HTTPException(status_code=429, detail="Too Many Requests")
        
        if now - ip_data["first"] > timedelta(minutes=5):
            ip_data = {"count": 0, "first": now, "blocked_until": None}

        ip_data["count"] += 1

        if ip_data["count"] >= 20:
            ip_data["blocked_until"] = now + timedelta(minutes=15)

        ip_attempts[client_ip] = ip_data

    users = read_json("users.json")

    user_found = False

    for user in users:

        if user["username"] == credentials.username:

            user_found = True

            # Check if account locked
            if user["lock_until"]:

                lock_time = datetime.fromisoformat(user["lock_until"])

                if now < lock_time:

                    log_system_event(user["id"], "Blocked_Login", "Attempt to log in to locked account.", client_ip)
                    raise HTTPException(status_code=401, detail="Invalid username or password.")
                
                else:

                    user["lock_until"] = None
                    user["failed_attempts"] = 0

            if user.get("permanently_locked"):
                log_system_event(user["id"], "Blocked_login", "Permanent Lock", client_ip)
                raise HTTPException(status_code=401, detail="Invalid username or password.")

            # Check password
            if verify_password(credentials.password, user["password_hash"]):

                user["lock_until"] = None
                user["failed_attempts"] = 0

                write_json("users.json", users)

                session_id, csrf_token = generate_session(user["id"], client_ip)

                response.set_cookie(
                    key="session_id",
                    value=session_id,
                    httponly=True,
                    secure=False, # TODO: update to True
                    samesite="lax",
                    max_age=600
                )

                response.set_cookie(
                    key="csrf_token",
                    value=csrf_token,
                    httponly=False,
                    secure=False, # TODO: update to True
                    samesite="lax",
                    max_age=600
                )

                log_system_event(user["id"], "Successful_Login", f"User {user['username']} successfully logged in.", client_ip)

                return user
            
            # Wrong password
            user["failed_attempts"] += 1

            if user["failed_attempts"] >= lock_threshold:

                # Temporary lock
                user["lock_until"] = (now + timedelta(minutes=lock_duration_minutes)).isoformat()
                user["failed_attempts"] = 0

                events = user.get("lock_events", [])
                events.append(now.isoformat())

                cutoff = now - timedelta(hours=perm_lock_window_hours)
                events = [
                    e for e in events
                    if datetime.fromisoformat(e) > cutoff
                ]

                user["lock_events"] = events

                if len(events) >= perm_lock_threshold:
                    user["permanently_locked"] = True
                    user["lock_until"] = None

                    log_system_event(user["id"], "Account_Permanently_Locked", "Multiple lockouts within time window.", client_ip)
                else:
                    log_system_event(user["id"], "Account_Locked", "Too many failed login attempts.", client_ip)

            else:
                log_system_event(user["id"], "Unsuccessful_Login", f"Wrong password entered for user {user['username']}.", client_ip)
            
            write_json("users.json", users)

            break

    # Unknown username or failed login
    if not user_found:
        log_system_event(None, "Unsuccessful_Login", f"Unknown username: {credentials.username}", client_ip)
        
    raise HTTPException(status_code=401, detail="Invalid username or password.")

# Logs out the user, with a safety check for unreturned tools (Requirement F24)
@app.post("/api/logout")
def logout(request: Request, response: Response, force: bool = False):

    client = request.client
    client_ip = client.host if client else "unknown"
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
    response.delete_cookie("csrf_token")

    if user_id:

        log_system_event(
            user_id=user_id, 
            action="SUCCESSFUL_LOGOUT", 
            details=f"User logged out. Forced: {force}",
            ip=client_ip
        )

    return {"message": "Logged out successfully"}


# Returns a safe list of users for frontend lookups
@app.get("/api/users")
def get_all_users(request: Request):
    users = read_json("users.json")
    
    # Strip sensitive data! Only send id, name, AND role
    safe_users = [
        {
            "id": u["id"], 
            "first_name": u["first_name"], 
            "last_name": u["last_name"],
            "role": u.get("role")  # <-- ADDED THIS LINE
        } 
        for u in users
    ]
    
    return safe_users

# FAULT ROUTES ==============================================================================================================================

# Fetches a specific active/assigned fault when a user scans a wall marker in AR
@app.get("/api/faults/marker/{marker_id}", response_model=FaultOut)
def get_fault_by_marker(marker_id: str):

    faults = read_json("faults.json")

    for fault in faults:

        if fault["marker_id"] == marker_id and fault["status"] in ["Active", "In-Progress", "In-Review"]:
            return fault
        
    raise HTTPException(status_code=404, detail="No active or assigned fault found for this marker")


# Creates new fault record
@app.post("/api/faults", response_model=FaultOut, status_code=201)
def create_new_fault(payload: FaultCreate, request: Request):
    
    client = request.client
    client_ip = client.host if client else "unknown"
    user_id = request.state.user_id
    now = datetime.now(UTC)

    # --- RATE LIMITING LOGIC (Requirement F5) ---
    last_submission = fault_submission_timestamps.get(user_id)
    
    if last_submission:

        time_since_last = (now - last_submission).total_seconds()

        if time_since_last < 5.0:

            # Log the spam attempt
            log_system_event(
                user_id=user_id, 
                action="RATE_LIMIT_EXCEEDED", 
                details="User attempted to submit multiple faults within 5 seconds.",
                ip=client_ip
            )
            raise HTTPException(
                status_code=429, # Standard HTTP code for "Too Many Requests"
                detail=f"Please wait {5 - int(time_since_last)} seconds before submitting another fault.",
            )
        
            
    # Update the user's last submission time to RIGHT NOW
    fault_submission_timestamps[user_id] = now
    # -----------------------------------------------

    # Proceed with normal fault creation
    faults = read_json("faults.json")
    
    # Create new ID (highest ID + 1)
    new_id = max([f["id"] for f in faults], default=0) + 1
    
    new_fault = {
        "id": new_id,
        "marker_id": payload.marker_id,
        "title": payload.title,
        "description": payload.description,
        "location": payload.location,
        "status": "In-Review", 
        "priority": payload.priority,
        "reported_by_id": user_id,
        "timestamp": now.isoformat(), 
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
        details=f"New fault logged at {payload.location}: {payload.title}",
        ip=client_ip
    )

    return new_fault


# Allows Supervisor to Assign/Resolve, and Techs to add notes
@app.patch("/api/faults/{fault_id}", response_model=FaultOut)
def update_fault(fault_id: int, payload: FaultUpdate, request: Request):
    
    client = request.client
    client_ip = client.host if client else "unknown"
    faults = read_json("faults.json")
    users = read_json("users.json")
    
    # Fetch the current user's role from the database using their session ID
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)
    
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")
        
    role = current_user.get("role")

    for fault in faults:

        if fault["id"] == fault_id:
            
            # RBAC ENFORCEMENT: TECHNICIAN RULES
            if role == "Technician":

                # Techs cannot assign users to other people
                if payload.assigned_to_id is not None:
                    log_system_event(
                        user_id=request.state.user_id, 
                        action="UNAUTHORIZED_ACTION", 
                        details=f"Technician attempted to assign fault {fault_id}.",
                        ip=client_ip
                    )
                    raise HTTPException(status_code=403, detail="Technicians cannot assign faults.")
                
                # Techs CAN update notes and status
                if payload.notes is not None:
                    fault["notes"] = payload.notes
                if payload.status is not None:
                    fault["status"] = payload.status 

                # Automatically record the technician as the resolver!
                if payload.status == "Resolved":
                    fault["resolved_by_id"] = request.state.user_id

            # RBAC ENFORCEMENT: SUPERVISOR RULES
            elif role in ["Supervisor", "Administrator"]:

                fault["status"] = payload.status
                fault["priority"] = payload.priority
                
                if payload.assigned_to_id is not None:
                    fault["assigned_to_id"] = payload.assigned_to_id
                if payload.resolved_by_id is not None:
                    fault["resolved_by_id"] = payload.resolved_by_id
                if payload.notes is not None:
                    fault["notes"] = payload.notes

            # Save to database
            write_json("faults.json", faults)

            # Log the successful update
            log_system_event(
                user_id=request.state.user_id, 
                action=f"FAULT_UPDATED", 
                details=f"Fault {fault_id} updated by {role}.",
                ip=client_ip
            )

            return fault
        
            
    raise HTTPException(status_code=404, detail="Fault ID not found")



# Deletes a fault record (Supervisor only) - Requirement F28
@app.delete("/api/faults/{fault_id}")
def delete_fault(fault_id: int, request: Request):
    
    client = request.client
    client_ip = client.host if client else "unknown"
    users = read_json("users.json")
    faults = read_json("faults.json")

    # Fetch the current user's role
    current_user = next((u for u in users if u["id"] == request.state.user_id), None)
    
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")
        
    role = current_user.get("role")

    # RBAC ENFORCEMENT: ONLY SUPERVISORS CAN DELETE
    if role not in ["Supervisor", "Administrator"]:
        
        # Log the security violation!
        log_system_event(
            user_id=request.state.user_id, 
            action="UNAUTHORIZED_DELETE_ATTEMPT", 
            details=f"Technician attempted to delete fault {fault_id}.",
            ip=client_ip
        )
        raise HTTPException(status_code=403, detail="Only Supervisors can delete faults.")

    # Find and remove the fault
    fault_to_delete = None

    for i, fault in enumerate(faults):
        
        if fault["id"] == fault_id:
            fault_to_delete = faults.pop(i) # Removes the item from the list
            break


    if not fault_to_delete:
        raise HTTPException(status_code=404, detail="Fault ID not found")


    # Save the updated database
    write_json("faults.json", faults)

    # Log the deletion to the audit trail
    log_system_event(
        user_id=request.state.user_id, 
        action="FAULT_DELETED", 
        details=f"Fault {fault_id} ('{fault_to_delete['title']}') deleted by {role}.",
        ip=client_ip
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

    client = request.client
    client_ip = client.host if client else "unknown"
    tools = read_json("tools.json")
    
    for tool in tools:

        if tool["marker_id"] == payload.marker_id:
            
            # Tool is available: Check it out
            if tool["status"] == "Available":
                tool["status"] = "Checked-Out"
                tool["current_user_id"] = request.state.user_id
                tool["checkout_timestamp"] = datetime.now(UTC).isoformat()
                
                log_system_event(
                    user_id=request.state.user_id, 
                    action="TOOL_CHECKOUT", 
                    details=f"Tool {tool['id']} checked out successfully.",
                    ip=client_ip
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
                    details=f"Tool {tool['id']} checked back in.",
                    ip=client_ip
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


@app.get("/ar")
def ar_page():
    return FileResponse("static/ar.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
@app.get("/")
def serve_home():
    return FileResponse("static/index.html")
