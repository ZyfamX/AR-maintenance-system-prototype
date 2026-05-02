const BASE_URL = "/api";

// Helper: sends a request and returns parsed JSON, or throws an error with a message
async function request(method, path, body = null) {
    const options = {
        method,
        credentials: "include",
        headers: {},
    };

    if (body) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${path}`, options);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(error.detail || `Request failed with status ${response.status}`);
    }

    // 204 No Content or empty body — return null
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}


// AUTH
// =====================================================================

// POST /api/login — returns UserOut on success, throws on failure
export async function login(username, password) {
    return request("POST", "/login", { username, password });
}

// POST /api/logout — clears session cookie server-side (supports forced logout)
export async function logout(force = false) {
    const query = force ? "?force=true" : "";
    return request("POST", `/logout${query}`);
}


// FAULTS
// =====================================================================

// GET /api/faults — returns list of all faults
export async function getFaults() {
    return request("GET", "/faults");
}

// GET /api/faults/marker/:markerId — returns a single active/assigned fault by AR marker
export async function getFaultByMarker(markerId) {
    return request("GET", `/faults/marker/${encodeURIComponent(markerId)}`);
}

// POST /api/faults — creates a new fault
// payload: { marker_id, title, description, location, reported_by_id }
export async function createFault(payload) {
    return request("POST", "/faults", payload);
}

// PATCH /api/faults/:faultId — assigns or resolves a fault
// payload: { status, assigned_to_id?, resolved_by_id?, notes? }
export async function updateFault(faultId, payload) {
    return request("PATCH", `/faults/${faultId}`, payload);
}

// DELETE /api/faults/:faultId — deletes a fault (Supervisor only)
export async function deleteFault(faultId) {
    return request("DELETE", `/faults/${faultId}`);
}

// TOOLS
// =====================================================================

// GET /api/tools — returns list of all tools
export async function getTools() {
    return request("GET", "/tools");
}

// POST /api/tools/scan — checks a tool in or out based on its current status
// payload: { marker_id, user_id }
export async function scanTool(payload) {
    return request("POST", "/tools/scan", payload);
}

// AUDIT LOG
// =====================================================================

// GET /api/audit/verify — verifies audit log chain integrity
// Returns { status: "ok", message: "..." } or throws with detail
export async function verifyAuditLog() {
    return request("GET", "/audit/verify");
}
