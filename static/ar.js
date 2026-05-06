/**
 * ar.js — AR Maintenance System
 *
 * FIELD REFERENCE (from schemas.py / JSON files):
 * ─────────────────────────────────────────────────
 * ToolOut:   id, marker_id, tool_type, status ("Available"|"Checked-Out"),
 *            storage_location, current_user_id (int|null), checkout_timestamp (str|null)
 *
 * FaultOut:  id, marker_id, title, description, location,
 *            status ("Active"|"In-Review"|"In-Progress"|"Resolved"),
 *            priority ("Low"|"Medium"|"High"|null), timestamp,
 *            reported_by_id, assigned_to_id (int|null),
 *            resolved_by_id (int|null), notes (str|null)
 *
 * UserOut:   id, username, first_name, last_name, role
 *
 * ToolScan payload: { marker_id } only — backend reads user from session cookie.
 */

import { getTools, getFaults, getUsers, scanTool } from './api.js';

// ─── DOM References ───────────────────────────────────────────────────────────

const fallbackEl   = document.getElementById('fallback');
const overlayEl    = document.getElementById('overlay');
const statusEl     = document.getElementById('status');
const infoPanelEl  = document.getElementById('info-panel');
const panelTitleEl = document.getElementById('panel-title');
const panelBodyEl  = document.getElementById('panel-body');
const actionBtnEl  = document.getElementById('panel-action-btn');
const homeBtnEl    = document.getElementById('btn-home');

// ─── State ────────────────────────────────────────────────────────────────────

let toolsByMarker  = {};   // "1"            → ToolOut
let faultsByMarker = {};   // "fault_marker_A" → FaultOut
let usersById      = {};   // 7              → UserOut

let activeItem = null;
let activeType = null;

// Read logged-in user from sessionStorage (set by your login flow)
let currentUser = null;
try {
    const stored = sessionStorage.getItem('user');
    if (stored) currentUser = JSON.parse(stored);
} catch (_) {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userName(userId) {
    if (userId === null || userId === undefined) return '—';
    const user = usersById[userId];
    return user ? `${user.first_name} ${user.last_name}` : `User #${userId}`;
}

function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        + ' — ' + d.toLocaleDateString('en-GB');
}

// ─── Camera / Fallback ────────────────────────────────────────────────────────

function showFallback(message) {
    if (fallbackEl) {
        fallbackEl.classList.remove('hidden');
        const msgEl = fallbackEl.querySelector('p');
        if (msgEl) msgEl.textContent = message;
    }
    if (overlayEl) overlayEl.classList.add('hidden');
    const arScene = document.getElementById('arScene');
    if (arScene) arScene.style.display = 'none';
}

function checkCameraSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showFallback('Your browser does not support camera access.');
        return;
    }
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            stream.getTracks().forEach(t => t.stop());
            loadData();
        })
        .catch(() => showFallback('Camera permission was denied or the camera is unavailable.'));
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const [tools, faults, users] = await Promise.all([
            getTools(),
            getFaults(),
            getUsers(),
        ]);

        toolsByMarker = {};
        for (const tool of tools) {
            if (tool.marker_id != null) toolsByMarker[String(tool.marker_id)] = tool;
        }

        faultsByMarker = {};
        for (const fault of faults) {
            if (fault.marker_id != null) faultsByMarker[String(fault.marker_id)] = fault;
        }

        usersById = {};
        for (const user of users) usersById[user.id] = user;

        console.log(`[AR] ${tools.length} tools, ${faults.length} faults, ${users.length} users loaded`);
        registerMarkerListeners();

    } catch (err) {
        console.error('[AR] Failed to load data:', err);
        if (statusEl) {
            statusEl.textContent = 'Failed to load data — please refresh.';
            statusEl.style.color = '#ff5555';
        }
    }
}

// ─── Marker Listeners ─────────────────────────────────────────────────────────

function registerMarkerListeners() {
    const scene = document.getElementById('arScene');
    if (!scene) { console.warn('[AR] No #arScene found.'); return; }

    scene.addEventListener('loaded', () => {
        const markers = scene.querySelectorAll('a-marker');
        markers.forEach(marker => {
            const barcodeValue = marker.getAttribute('value');
            if (barcodeValue === null) return;
            const markerId = String(barcodeValue);
            marker.addEventListener('markerFound', () => onMarkerFound(markerId));
            marker.addEventListener('markerLost',  () => onMarkerLost(markerId));
        });
        console.log(`[AR] Listening on ${markers.length} markers.`);
    });
}

// ─── Marker Events ────────────────────────────────────────────────────────────

function onMarkerFound(markerId) {
    const mode = (window.scanMode === 'fault') ? 'fault' : 'tool';

    if (statusEl) {
        statusEl.textContent = `${mode === 'tool' ? '🔧 Tool' : '⚠️ Fault'} marker: ${markerId}`;
        statusEl.style.color = '#7ef7a0';
    }

    if (mode === 'tool') {
        const tool = toolsByMarker[markerId];
        if (tool) { activeItem = tool; activeType = 'tool'; renderToolPanel(tool); }
        else       { activeItem = null; activeType = null; renderUnknownPanel(markerId, 'tool'); }
    } else {
        const fault = faultsByMarker[markerId];
        if (fault) { activeItem = fault; activeType = 'fault'; renderFaultPanel(fault); }
        else        { activeItem = null; activeType = null; renderUnknownPanel(markerId, 'fault'); }
    }

    showInfoPanel();
}

function onMarkerLost(markerId) {
    if (statusEl) {
        statusEl.textContent = 'Marker lost — point camera at a marker.';
        statusEl.style.color = '#f0c040';
    }
    hideInfoPanel();
    activeItem = null;
    activeType = null;
}

// ─── Panel: Tool ──────────────────────────────────────────────────────────────

function renderToolPanel(tool) {
    if (panelTitleEl) panelTitleEl.textContent = 'Tool View';

    // status is exactly "Available" or "Checked-Out" (from tools.json / ToolOut)
    const isAvailable     = tool.status === 'Available';
    const isCheckedOutByMe = !isAvailable && currentUser && tool.current_user_id === currentUser.id;

    const statusColor = isAvailable ? '#22c55e' : '#ef4444';
    const checkedOutByName = isAvailable ? '—'
        : isCheckedOutByMe ? 'You'
        : userName(tool.current_user_id);

    if (panelBodyEl) {
        panelBodyEl.innerHTML = `
            <div class="ar-info-row">
                <span class="ar-label">ID:</span>
                <span>${tool.id ?? '—'}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Tool Type:</span>
                <span>${tool.tool_type ?? '—'}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Storage:</span>
                <span>${tool.storage_location ?? '—'}</span>
            </div>
            <hr class="ar-divider">
            <div class="ar-info-row">
                <span class="ar-label">Status:</span>
                <span style="color:${statusColor};font-weight:700;">${tool.status}</span>
            </div>
            ${!isAvailable ? `
            <div class="ar-info-row">
                <span class="ar-label">Used by:</span>
                <span>${checkedOutByName}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Since:</span>
                <span>${formatTime(tool.checkout_timestamp)}</span>
            </div>` : ''}
        `;
    }

    if (actionBtnEl) {
        if (isAvailable) {
            actionBtnEl.textContent   = 'Check-Out';
            actionBtnEl.className     = 'ar-action-btn ar-btn-checkout';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled      = false;
            actionBtnEl.onclick       = () => handleToolScan(tool);
        } else if (isCheckedOutByMe) {
            actionBtnEl.textContent   = 'Check-In';
            actionBtnEl.className     = 'ar-action-btn ar-btn-checkin';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled      = false;
            actionBtnEl.onclick       = () => handleToolScan(tool);
        } else {
            actionBtnEl.style.display = 'none';
            actionBtnEl.onclick       = null;
        }
    }
}

// ─── Panel: Fault ─────────────────────────────────────────────────────────────

function renderFaultPanel(fault) {
    if (panelTitleEl) panelTitleEl.textContent = 'Fault View';

    const statusColors = {
        'Active':      '#ef4444',
        'In-Review':   '#a855f7',
        'In-Progress': '#3b82f6',
        'Resolved':    '#22c55e',
    };
    const priorityColors = {
        'High':   '#ef4444',
        'Medium': '#f97316',
        'Low':    '#facc15',
    };

    if (panelBodyEl) {
        panelBodyEl.innerHTML = `
            <div class="ar-info-row">
                <span class="ar-label">Fault ID:</span>
                <span>#${fault.id ?? '—'}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Title:</span>
                <span>${fault.title ?? '—'}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Location:</span>
                <span>${fault.location ?? '—'}</span>
            </div>
            <hr class="ar-divider">
            <div class="ar-info-row">
                <span class="ar-label">Status:</span>
                <span style="color:${statusColors[fault.status] ?? '#94a3b8'};font-weight:700;">${fault.status ?? '—'}</span>
            </div>
            ${fault.priority ? `
            <div class="ar-info-row">
                <span class="ar-label">Priority:</span>
                <span style="color:${priorityColors[fault.priority] ?? '#94a3b8'};font-weight:700;">${fault.priority}</span>
            </div>` : ''}
            <div class="ar-info-row">
                <span class="ar-label">Reported by:</span>
                <span>${userName(fault.reported_by_id)}</span>
            </div>
            <div class="ar-info-row">
                <span class="ar-label">Reported:</span>
                <span>${formatTime(fault.timestamp)}</span>
            </div>
            ${fault.assigned_to_id ? `
            <div class="ar-info-row">
                <span class="ar-label">Assigned to:</span>
                <span>${userName(fault.assigned_to_id)}</span>
            </div>` : ''}
            ${fault.resolved_by_id ? `
            <div class="ar-info-row">
                <span class="ar-label">Resolved by:</span>
                <span>${userName(fault.resolved_by_id)}</span>
            </div>` : ''}
            ${fault.description ? `
            <hr class="ar-divider">
            <div class="ar-info-row ar-description">
                <span class="ar-label">Description:</span>
                <span>${fault.description}</span>
            </div>` : ''}
            ${fault.notes ? `
            <div class="ar-info-row ar-description">
                <span class="ar-label">Updates:</span>
                <span>${fault.notes}</span>
            </div>` : ''}
        `;
    }

    if (actionBtnEl) {
        actionBtnEl.style.display = 'none';
        actionBtnEl.onclick = null;
    }
}

// ─── Panel: Unknown ───────────────────────────────────────────────────────────

function renderUnknownPanel(markerId, mode = 'tool') {
    if (panelTitleEl) panelTitleEl.textContent = 'No Record Found';

    const hint = mode === 'tool'
        ? 'If this is a fault location, switch to Fault mode and scan again.'
        : 'If this is a tool, switch to Tool mode and scan again.';

    if (panelBodyEl) {
        panelBodyEl.innerHTML = `
            <div class="ar-info-row" style="color:#f0c040;">
                No <strong>${mode}</strong> found for marker <strong>${markerId}</strong>.
            </div>
            <div class="ar-info-row" style="color:#94a3b8;font-size:0.85rem;margin-top:4px;">
                ${hint}
            </div>
        `;
    }

    if (actionBtnEl) { actionBtnEl.style.display = 'none'; actionBtnEl.onclick = null; }
}

// ─── Panel Show/Hide ──────────────────────────────────────────────────────────

function showInfoPanel() { if (infoPanelEl) infoPanelEl.classList.add('visible'); }
function hideInfoPanel()  { if (infoPanelEl) infoPanelEl.classList.remove('visible'); }

// ─── Tool Scan API Call ───────────────────────────────────────────────────────

/**
 * POST /api/tools/scan
 * Payload: { marker_id } — matches ToolScan schema in schemas.py.
 * Backend uses session cookie to identify the user — no user_id sent.
 * Returns the updated ToolOut on success.
 */
async function handleToolScan(tool) {
    if (!currentUser) {
        alert('You must be logged in to check out or return tools.');
        return;
    }

    if (actionBtnEl) {
        actionBtnEl.disabled    = true;
        actionBtnEl.textContent = 'Processing…';
    }

    try {
        const updated = await scanTool({ marker_id: tool.marker_id });

        if (updated) {
            toolsByMarker[String(updated.marker_id)] = updated;
            activeItem = updated;
            renderToolPanel(updated);
        }
    } catch (err) {
        console.error('[AR] Scan failed:', err);
        alert(`Action failed: ${err.message}`);
        if (actionBtnEl) actionBtnEl.disabled = false;
        renderToolPanel(tool);
    }
}

// ─── Home Button ──────────────────────────────────────────────────────────────

if (homeBtnEl) {
    homeBtnEl.addEventListener('click', () => { window.location.href = '/'; });
}

// ─── Start ────────────────────────────────────────────────────────────────────

checkCameraSupport();