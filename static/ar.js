import { getTools, getFaults, getUsers, scanTool } from './api.js';

// --- CUSTOM A-FRAME COMPONENT: Auto-Scale & Billboard ---
AFRAME.registerComponent('smart-hud', {
    tick: function () {
        const camera = this.el.sceneEl.camera;
        if (!camera) return;

        // Get the true 3D positions of both the HUD and the Camera
        const hudPos = new THREE.Vector3();
        this.el.object3D.getWorldPosition(hudPos);
        
        const cameraPos = new THREE.Vector3();
        camera.getWorldPosition(cameraPos);

        // BILLBOARD FIX: Force the flat side of the panel to look directly at the phone lens
        this.el.object3D.lookAt(cameraPos);

        // Auto-Scale based on distance
        const distance = hudPos.distanceTo(cameraPos);
        const scaleFactor = Math.max(0.6, distance * 0.15); 
        this.el.object3D.scale.set(scaleFactor, scaleFactor, scaleFactor);
    }
});

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

// Read logged-in user from storage (Matches the key set in ui.js)
let currentUser = null;
try {
    const stored = localStorage.getItem('ar_user'); 
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
    const markers = document.querySelectorAll('a-marker');
    if (markers.length === 0) {
        console.warn('[AR] No markers found in DOM.');
        return;
    }

    markers.forEach(marker => {
        const barcodeValue = marker.getAttribute('value');
        if (barcodeValue === null) return;
        const markerId = String(barcodeValue);

        // FIXED: The DOM is already loaded, so we attach the listeners directly!
        marker.addEventListener('markerFound', () => onMarkerFound(markerId));
        marker.addEventListener('markerLost',  () => onMarkerLost(markerId));
    });

    console.log(`[AR] Successfully listening on ${markers.length} markers.`);
}

// ─── Marker Events ────────────────────────────────────────────────────────────

function onMarkerFound(markerId) {
    const mode = (window.scanMode === 'fault') ? 'fault' : 'tool';
    const markerEl = document.getElementById(`barcode-${markerId}`);

    if (statusEl) {
        statusEl.textContent = `${mode === 'tool' ? '🔧 Tool' : '⚠️ Fault'} marker: ${markerId}`;
        statusEl.style.color = '#7ef7a0';
    }

    // Default 3D text if no match is found
    let titleText = "Unknown Marker";
    let textColor = "#f0c040";

    if (mode === 'tool') {
        const tool = toolsByMarker[markerId];
        if (tool) { 
            activeItem = tool; activeType = 'tool'; 
            titleText = tool.tool_type; // Display the Tool Name in 3D
            textColor = tool.status === 'Available' ? '#22c55e' : '#f97316'; // Green if available
            renderToolPanel(tool); 
        } else {       
            activeItem = null; activeType = null; renderUnknownPanel(markerId, 'tool'); 
        }
    } else {
        const fault = faultsByMarker[markerId];
        if (fault) { 
            activeItem = fault; activeType = 'fault'; 
            titleText = fault.title; // Display the Fault Title in 3D
            textColor = fault.priority === 'High' ? '#ef4444' : '#f97316'; // Red if high priority
            renderFaultPanel(fault); 
        } else {        
            activeItem = null; activeType = null; renderUnknownPanel(markerId, 'fault'); 
        }
    }

    // 3D ANNOTATION INJECTION (DYNAMIC REAL-TIME HUD)
    if (markerEl) {
        const box = markerEl.querySelector('a-box');
        if (box) box.setAttribute('visible', 'false');

        let hudWrapper = markerEl.querySelector('.ar-hud-wrapper');
        
        // Build the elements ONCE if they don't exist
        if (!hudWrapper) {
            hudWrapper = document.createElement('a-entity');
            hudWrapper.setAttribute('class', 'ar-hud-wrapper');

            const line = document.createElement('a-entity');
            line.setAttribute('class', 'hud-line');
            hudWrapper.appendChild(line);

            const hudEl = document.createElement('a-entity');
            hudEl.setAttribute('class', 'ar-hud');
            hudEl.setAttribute('smart-hud', ''); 

            const bg = document.createElement('a-plane');
            bg.setAttribute('class', 'hud-bg');
            bg.setAttribute('color', '#0f172a');
            bg.setAttribute('width', '3.2');
            bg.setAttribute('height', '1.4');
            bg.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.85; depthWrite: false;'); 
            hudEl.appendChild(bg);

            const accent = document.createElement('a-plane');
            accent.setAttribute('class', 'hud-accent');
            accent.setAttribute('width', '0.05');
            accent.setAttribute('height', '1.4');
            accent.setAttribute('material', 'shader: flat; transparent: true; opacity: 1.0; depthWrite: false;');
            hudEl.appendChild(accent);

            const title = document.createElement('a-entity');
            title.setAttribute('class', 'hud-title');
            hudEl.appendChild(title);

            const idText = document.createElement('a-entity');
            idText.setAttribute('class', 'hud-id');
            hudEl.appendChild(idText);

            const locText = document.createElement('a-entity');
            locText.setAttribute('class', 'hud-loc');
            hudEl.appendChild(locText);

            const statusLabel = document.createElement('a-entity');
            statusLabel.setAttribute('class', 'hud-status-label');
            statusLabel.setAttribute('text', 'value: STATUS:; color: #cbd5e1; width: 2.0; align: left; anchor: left; wrapCount: 25; font: roboto;');
            hudEl.appendChild(statusLabel);

            const statusValue = document.createElement('a-entity');
            statusValue.setAttribute('class', 'hud-status-val');
            hudEl.appendChild(statusValue);

            hudWrapper.appendChild(hudEl);
            markerEl.appendChild(hudWrapper);
        }

        // DYNAMIC MATH: Calculate left/right direction EVERY TIME it is scanned
        let dir = 1; // Default projects Right
        const cameraEl = document.querySelector('[camera]');
        if (cameraEl && cameraEl.components.camera) {
            const camera = cameraEl.components.camera.camera;
            const markerPos = new THREE.Vector3();
            markerEl.object3D.getWorldPosition(markerPos);
            markerPos.project(camera); 
            if (markerPos.x > 0) dir = -1; // If marker is on Right, project Left
        }

        const offsetX = 1.5 * dir;
        const centerX = 1.6 * dir;
        const accentX = dir === 1 ? 0.025 : -3.175; 
        const textX   = dir === 1 ? 0.15 : -3.05;   
        const valX    = dir === 1 ? 1.0 : -2.2;     

        // Apply positions based on the calculated direction
        hudWrapper.querySelector('.ar-hud').setAttribute('position', `${offsetX} 1 0`);
        hudWrapper.querySelector('.hud-bg').setAttribute('position', `${centerX} 0.7 -0.1`);
        hudWrapper.querySelector('.hud-accent').setAttribute('position', `${accentX} 0.7 0.01`);
        hudWrapper.querySelector('.hud-title').setAttribute('position', `${textX} 1.1 0.1`);
        hudWrapper.querySelector('.hud-id').setAttribute('position', `${textX} 0.75 0.1`);
        hudWrapper.querySelector('.hud-loc').setAttribute('position', `${textX} 0.45 0.1`);
        hudWrapper.querySelector('.hud-status-label').setAttribute('position', `${textX} 0.15 0.1`);
        hudWrapper.querySelector('.hud-status-val').setAttribute('position', `${valX} 0.15 0.1`);

        // Populate Live Data
        if (activeItem) {
            const lineEl = hudWrapper.querySelector('.hud-line');
            const accentEl = hudWrapper.querySelector('.hud-accent');
            const titleEl = hudWrapper.querySelector('.hud-title');
            const idTextEl = hudWrapper.querySelector('.hud-id');
            const locTextEl = hudWrapper.querySelector('.hud-loc');
            const statusValueEl = hudWrapper.querySelector('.hud-status-val');

            let color, titleStr, idStr, locStr, statusStr;
            const COLOR_GREEN  = '#4ade80';
            const COLOR_ORANGE = '#fb923c';
            const COLOR_RED    = '#f87171';


            if (activeType === 'tool') {
                color = activeItem.status === 'Available' ? COLOR_GREEN : COLOR_ORANGE;
                titleStr = activeItem.tool_type.toUpperCase();
                idStr = `ID: ${activeItem.id}`;
                locStr = `LOC: ${activeItem.storage_location || 'N/A'}`;
                // FIX: Strip the "STATUS: " prefix to prevent duplication
                statusStr = activeItem.status.toUpperCase(); 
            } else if (activeType === 'fault') {
                color = activeItem.priority === 'High' ? COLOR_RED : COLOR_ORANGE;
                titleStr = activeItem.title.toUpperCase();
                idStr = `ID: F-${activeItem.id}`;
                let loc = activeItem.location || 'N/A';
                if (loc.length > 35) loc = loc.substring(0, 32) + '...';
                locStr = `LOC: ${loc}`;
                // FIX: Strip the "STATUS: " prefix to prevent duplication
                statusStr = activeItem.status.toUpperCase(); 
            }

            lineEl.setAttribute('line', `start: 0 0 0; end: ${offsetX} 1 0; color: ${color}; opacity: 0.9`);
            accentEl.setAttribute('color', color);
            titleEl.setAttribute('text', `value: ${titleStr}; color: #ffffff; width: 3.0; align: left; anchor: left; wrapCount: 20; font: roboto;`);
            idTextEl.setAttribute('text', `value: ${idStr}; color: #94a3b8; width: 2.8; align: left; anchor: left; wrapCount: 30; font: roboto;`);
            locTextEl.setAttribute('text', `value: ${locStr}; color: #f8fafc; width: 2.8; align: left; anchor: left; wrapCount: 30; font: roboto;`);
            statusValueEl.setAttribute('text', `value: ${statusStr}; color: ${color}; width: 2.6; align: left; anchor: left; wrapCount: 25; font: roboto;`);
        }
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
    if (panelTitleEl) panelTitleEl.textContent = 'Action Required';
    if (panelBodyEl) panelBodyEl.innerHTML = ''; 

    const isAvailable = tool.status === 'Available';
    // Using == instead of === to prevent integer/string mismatches
    const isCheckedOutByMe = !isAvailable && currentUser && tool.current_user_id == currentUser.id;

    if (actionBtnEl) {
        if (isAvailable) {
            actionBtnEl.textContent   = 'Check-Out';
            actionBtnEl.className     = 'ar-action-btn ar-btn-checkout';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled      = false;
            actionBtnEl.onclick       = () => handleToolScan(tool);
        } else if (isCheckedOutByMe) {
            actionBtnEl.textContent   = 'Return Tool'; // Better UX text
            actionBtnEl.className     = 'ar-action-btn ar-btn-checkin';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled      = false;
            actionBtnEl.onclick       = () => handleToolScan(tool);
        } else {
            actionBtnEl.style.display = 'none';
            actionBtnEl.onclick       = null;
            if (panelBodyEl) panelBodyEl.innerHTML = `<div style="text-align:center; color: #f8fafc; font-weight: bold; padding: 10px;">Tool checked out by User #${tool.current_user_id}</div>`;
        }
    }
}


// ─── Panel: Fault ─────────────────────────────────────────────────────────────

function renderFaultPanel(fault) {
    if (panelTitleEl) panelTitleEl.textContent = 'Fault Logged';
    
    // Empty the body text
    if (panelBodyEl) panelBodyEl.innerHTML = '<div style="text-align:center; padding: 10px; color: #94a3b8;">Review fault details in AR view.</div>';

    if (actionBtnEl) {
        actionBtnEl.style.display = 'none';
        actionBtnEl.onclick = null;
    }
}

// ─── Panel: Unknown ───────────────────────────────────────────────────────────

function renderUnknownPanel(markerId, mode = 'tool') {
    if (panelTitleEl) panelTitleEl.textContent = 'No Record Found';

    const hint = mode === 'tool'
        ? 'If this is a fault, switch to Fault mode.'
        : 'If this is a tool, switch to Tool mode.';

    if (panelBodyEl) {
        panelBodyEl.innerHTML = `
            <div style="text-align:center; color:#f0c040; padding: 10px;">
                No ${mode} found. <br><span style="font-size: 0.85rem; color:#94a3b8;">${hint}</span>
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
            
            // Force the 3D AR HUD to redraw itself with the new Database values!
            onMarkerFound(String(updated.marker_id)); 
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


// FIX FOR AR.JS LANDSCAPE STRETCHING 
window.addEventListener('orientationchange', () => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 500); // Safari fallback
});

// ─── Start ────────────────────────────────────────────────────────────────────

checkCameraSupport();