import { getTools, getFaults, getUsers, scanTool, getFaultByMarker, updateFault, createFault } from './api.js';

// ============================================================================
// CUSTOM A-FRAME COMPONENTS
// ============================================================================

/**
 * Registers a custom A-Frame component that forces the 3D HUD to always face 
 * the camera (billboarding) and auto-scales it based on the user's distance 
 * to the physical marker so it remains readable.
 */
AFRAME.registerComponent('smart-hud', {
    tick: function () {
        const camera = this.el.sceneEl.camera;
        if (!camera) return;

        // Get the true 3D positions of both the HUD and the Camera
        const hudPos = new THREE.Vector3();
        this.el.object3D.getWorldPosition(hudPos);
        
        const cameraPos = new THREE.Vector3();
        camera.getWorldPosition(cameraPos);

        // Force the flat side of the panel to look directly at the phone lens
        this.el.object3D.lookAt(cameraPos);

        // Auto-Scale based on distance
        const distance = hudPos.distanceTo(cameraPos);
        const scaleFactor = Math.max(0.6, distance * 0.15); 
        this.el.object3D.scale.set(scaleFactor, scaleFactor, scaleFactor);
    }
});


// ============================================================================
// DOM REFERENCES
// ============================================================================

const fallbackEl = document.getElementById('fallback');
const overlayEl = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const infoPanelEl = document.getElementById('info-panel');
const panelTitleEl = document.getElementById('panel-title');
const panelBodyEl = document.getElementById('panel-body');
const actionBtnEl = document.getElementById('panel-action-btn');
const homeBtnEl = document.getElementById('btn-home');


// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================

// Dictionaries to quickly look up data based on the scanned marker ID
let toolsByMarker = {};
let faultsByMarker = {};
let usersById = {};

// Tracks the currently scanned object and its type (tool or fault)
let activeItem = null;
let activeType = null;

// Read logged-in user from storage (Matches the key set in ui.js)
// This survives mobile browser reloads when asking for camera permissions.
let currentUser = null;
try {
    const stored = localStorage.getItem('ar_user'); 
    if (stored) currentUser = JSON.parse(stored);
} catch (_) {}


// ============================================================================
// UTILITY HELPERS
// ============================================================================

/**
 * Returns the full name of a user by their ID.
 * Falls back to a generic user string if the ID isn't found in the dictionary.
 */
function userName(userId) {
    if (userId === null || userId === undefined) return '—';
    const user = usersById[userId];
    return user ? `${user.first_name} ${user.last_name}` : `User #${userId}`;
}

/**
 * Safely formats an ISO timestamp into a readable localized time and date string.
 */
function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' — ' + d.toLocaleDateString('en-GB');
}


// ============================================================================
// CAMERA & FALLBACK INITIALIZATION
// ============================================================================

/**
 * Hides the AR scene and displays a fallback message when the camera
 * is unavailable or permission is denied by the user.
 */
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

/**
 * Checks if the device supports camera access and requests permission.
 * If successful, stops the stream immediately to free the hardware and loads the data.
 */
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


// ============================================================================
// DATA LOADING & INITIALIZATION
// ============================================================================

/**
 * Fetches all tools, faults, and users from the backend API and stores them
 * in local dictionaries for instant lookup when a marker is scanned.
 */
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


// ============================================================================
// AR MARKER MANAGEMENT
// ============================================================================

/**
 * Binds the 'markerFound' and 'markerLost' events to every barcode marker
 * injected into the DOM by A-Frame.
 */
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

        marker.addEventListener('markerFound', () => onMarkerFound(markerId));
        marker.addEventListener('markerLost', () => onMarkerLost(markerId));
    });

    console.log(`[AR] Successfully listening on ${markers.length} markers.`);
}

/**
 * Triggered when the camera detects a physical marker.
 * Determines the current mode (Tool or Fault), looks up the data, 
 * renders the 2D UI panels, and injects the 3D HUD into the AR scene.
 */
async function onMarkerFound(markerId) {
    const mode = (window.scanMode === 'fault') ? 'fault' : 'tool';
    const markerEl = document.getElementById(`barcode-${markerId}`);

    if (statusEl) {
        statusEl.textContent = `${mode === 'tool' ? '🔧 Tool' : '⚠️ Fault'} marker: ${markerId}`;
        statusEl.style.color = '#7ef7a0';
    }

    // Determine the active item based on the current scanning mode
    if (mode === 'tool') {
        const tool = toolsByMarker[markerId];
        if (tool) { 
            activeItem = tool; 
            activeType = 'tool'; 
            renderToolPanel(tool); 
        } else {       
            activeItem = null; 
            activeType = null; 
            renderUnknownPanel(markerId, 'tool'); 
        }
    } else {
        let fault = faultsByMarker[markerId];

        // If the fault isn't in the pre-loaded list (e.g., assigned to someone else), fetch it directly
        if (!fault) {
            try {
                fault = await getFaultByMarker(markerId);
                if (fault) faultsByMarker[markerId] = fault;
            } catch (err) {
                console.log("[AR] Fault marker not found in backend:", err);
            }
        }

        if (fault) { 
            activeItem = fault; 
            activeType = 'fault'; 
            renderFaultPanel(fault); 
        } else {        
            activeItem = null; 
            activeType = null; 
            renderUnknownPanel(markerId, 'fault'); 
        }
    }

    // ------------------------------------------------------------------------
    // 3D ANNOTATION INJECTION (DYNAMIC REAL-TIME HUD)
    // ------------------------------------------------------------------------
    if (markerEl) {
        const box = markerEl.querySelector('a-box');
        if (box) box.setAttribute('visible', 'false');

        let hudWrapper = markerEl.querySelector('.ar-hud-wrapper');
        
        // 1. Build the Grid Layout ONCE
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

            // Create Grid Rows
            const lbl1 = document.createElement('a-entity'); lbl1.setAttribute('class', 'hud-lbl-1'); hudEl.appendChild(lbl1);
            const val1 = document.createElement('a-entity'); val1.setAttribute('class', 'hud-val-1'); hudEl.appendChild(val1);

            const lbl2 = document.createElement('a-entity'); lbl2.setAttribute('class', 'hud-lbl-2'); hudEl.appendChild(lbl2);
            const val2 = document.createElement('a-entity'); val2.setAttribute('class', 'hud-val-2'); hudEl.appendChild(val2);

            const lbl3 = document.createElement('a-entity'); lbl3.setAttribute('class', 'hud-lbl-3'); hudEl.appendChild(lbl3);
            const val3 = document.createElement('a-entity'); val3.setAttribute('class', 'hud-val-3'); hudEl.appendChild(val3);

            hudWrapper.appendChild(hudEl);
            markerEl.appendChild(hudWrapper);
        }

        // 2. DYNAMIC MATH: Project HUD away from the nearest screen edge
        let dir = 1; 
        const cameraEl = document.querySelector('[camera]');
        if (cameraEl && cameraEl.components.camera) {
            const camera = cameraEl.components.camera.camera;
            const markerPos = new THREE.Vector3();
            markerEl.object3D.getWorldPosition(markerPos);
            markerPos.project(camera); 
            if (markerPos.x > 0) dir = -1; 
        }

        const offsetX = 1.5 * dir;
        const centerX = 1.6 * dir;
        const accentX = dir === 1 ? 0.025 : -3.175; 
        
        const textX = dir === 1 ? 0.15 : -3.05;   
        const valX = dir === 1 ? 1.40 : -1.80; 

        // 3. Apply calculated positions
        hudWrapper.querySelector('.ar-hud').setAttribute('position', `${offsetX} 1 0`);
        hudWrapper.querySelector('.hud-bg').setAttribute('position', `${centerX} 0.7 -0.1`);
        hudWrapper.querySelector('.hud-accent').setAttribute('position', `${accentX} 0.7 0.01`);
        hudWrapper.querySelector('.hud-title').setAttribute('position', `${textX} 1.1 0.1`);
        
        hudWrapper.querySelector('.hud-lbl-1').setAttribute('position', `${textX} 0.75 0.1`);
        hudWrapper.querySelector('.hud-val-1').setAttribute('position', `${valX} 0.75 0.1`);
        
        hudWrapper.querySelector('.hud-lbl-2').setAttribute('position', `${textX} 0.45 0.1`);
        hudWrapper.querySelector('.hud-val-2').setAttribute('position', `${valX} 0.45 0.1`);
        
        hudWrapper.querySelector('.hud-lbl-3').setAttribute('position', `${textX} 0.15 0.1`);
        hudWrapper.querySelector('.hud-val-3').setAttribute('position', `${valX} 0.15 0.1`);

        // 4. Populate Live Data with Dashboard Colors
        if (activeItem) {
            hudWrapper.setAttribute('visible', 'true');

            const lineEl = hudWrapper.querySelector('.hud-line');
            const accentEl = hudWrapper.querySelector('.hud-accent');
            const titleEl = hudWrapper.querySelector('.hud-title');
            
            const lbl1 = hudWrapper.querySelector('.hud-lbl-1'); const val1 = hudWrapper.querySelector('.hud-val-1');
            const lbl2 = hudWrapper.querySelector('.hud-lbl-2'); const val2 = hudWrapper.querySelector('.hud-val-2');
            const lbl3 = hudWrapper.querySelector('.hud-lbl-3'); const val3 = hudWrapper.querySelector('.hud-val-3');

            let mainColor, titleStr;
            let strL1, strV1, colV1;
            let strL2, strV2, colV2;
            let strL3, strV3, colV3;

            if (activeType === 'tool') {
                mainColor = activeItem.status === 'Available' ? '#4ade80' : '#fb923c';
                titleStr = activeItem.tool_type.toUpperCase();
                
                strL1 = "ID:"; 
                strV1 = activeItem.id; 
                colV1 = "#94a3b8";

                strL2 = "LOC:"; 
                strV2 = activeItem.storage_location || 'N/A'; 
                colV2 = "#f8fafc";

                strL3 = "STATUS:";   
                
                if (activeItem.status === 'Available') {
                    strV3 = 'AVAILABLE'; 
                    colV3 = '#4ade80';
                } else if (currentUser && activeItem.current_user_id == currentUser.id) {
                    strV3 = 'IN USE BY YOU'; 
                    colV3 = '#3b82f6';
                } else {
                    strV3 = `IN USE BY ${userName(activeItem.current_user_id).toUpperCase()}`; 
                    colV3 = '#fb923c';
                }

            } else if (activeType === 'fault') {
                const PRIORITY_COLORS = { 'High': '#ef4444', 'Medium': '#f59e0b', 'Low': '#3b82f6' };
                const STATUS_COLORS = { 'Active': '#64748b', 'In-Progress': '#3b82f6', 'In-Review': '#8b5cf6', 'Resolved': '#22c55e' };

                mainColor = PRIORITY_COLORS[activeItem.priority] || '#94a3b8';
                titleStr = activeItem.title.toUpperCase();
                
                strL1 = "PRIORITY:";    
                strV1 = activeItem.priority ? activeItem.priority.toUpperCase() : 'N/A'; 
                colV1 = PRIORITY_COLORS[activeItem.priority] || '#94a3b8';
                
                strL2 = "STATUS:";      
                strV2 = activeItem.status.toUpperCase(); 
                colV2 = STATUS_COLORS[activeItem.status] || '#94a3b8';
                
                strL3 = "REPORTED BY:"; 
                strV3 = userName(activeItem.reported_by_id).toUpperCase(); 
                colV3 = "#f8fafc";
            }

            lineEl.setAttribute('line', `start: 0 0 0; end: ${offsetX} 1 0; color: ${mainColor}; opacity: 0.9`);
            accentEl.setAttribute('color', mainColor);
            titleEl.setAttribute('text', `value: ${titleStr}; color: #ffffff; width: 3.0; align: left; anchor: left; wrapCount: 20; font: roboto;`);
            
            const fmtText = (val, col) => `value: ${val}; color: ${col}; width: 2.8; align: left; anchor: left; wrapCount: 30; font: roboto;`;
            
            lbl1.setAttribute('text', fmtText(strL1, "#cbd5e1")); val1.setAttribute('text', fmtText(strV1, colV1));
            lbl2.setAttribute('text', fmtText(strL2, "#cbd5e1")); val2.setAttribute('text', fmtText(strV2, colV2));
            lbl3.setAttribute('text', fmtText(strL3, "#cbd5e1")); val3.setAttribute('text', fmtText(strV3, colV3));

        } else {
            hudWrapper.setAttribute('visible', 'false');
        }
    }

    showInfoPanel();
}

/**
 * Triggered when the physical marker leaves the camera frame.
 * Hides the 2D UI and resets the active state.
 */
function onMarkerLost(markerId) {
    if (statusEl) {
        statusEl.textContent = 'Marker lost — point camera at a marker.';
        statusEl.style.color = '#f0c040';
    }
    hideInfoPanel();
    activeItem = null;
    activeType = null;
}


// ============================================================================
// UI PANEL RENDERERS
// ============================================================================

/**
 * Renders the 2D bottom sheet for a recognized Tool.
 * Provides the Check-Out or Return Tool buttons depending on its status.
 */
function renderToolPanel(tool) {
    if (panelTitleEl) panelTitleEl.textContent = 'Action Required';
    if (panelBodyEl) panelBodyEl.innerHTML = ''; 

    const isAvailable = tool.status === 'Available';
    const isCheckedOutByMe = !isAvailable && currentUser && tool.current_user_id == currentUser.id;

    if (actionBtnEl) {
        if (isAvailable) {
            actionBtnEl.textContent = 'Check-Out';
            actionBtnEl.className = 'ar-action-btn ar-btn-checkout';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled = false;
            actionBtnEl.onclick = () => handleToolScan(tool);
        } else if (isCheckedOutByMe) {
            actionBtnEl.textContent = 'Return Tool';
            actionBtnEl.className = 'ar-action-btn ar-btn-checkin';
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled = false;
            actionBtnEl.onclick = () => handleToolScan(tool);
        } else {
            actionBtnEl.style.display = 'none';
            actionBtnEl.onclick = null;
            if (panelBodyEl) panelBodyEl.innerHTML = `<div style="text-align:center; color: #f8fafc; font-weight: bold; padding: 10px;">Tool checked out by User #${tool.current_user_id}</div>`;
        }
    }
}

/**
 * Renders the 2D bottom sheet for a recognized Fault.
 * Provides the View Fault button if the fault is actively assigned to the user.
 */
function renderFaultPanel(fault) {
    if (panelTitleEl) panelTitleEl.textContent = 'Fault Logged';
    
    const isAssignedToMe = currentUser && fault.assigned_to_id == currentUser.id;

    if (actionBtnEl) {
        if (isAssignedToMe) {
            actionBtnEl.textContent = 'View Fault';
            actionBtnEl.className = 'ar-action-btn ar-btn-checkout'; 
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled = false;
            actionBtnEl.onclick = () => openARFaultModal(fault);
            
            if (panelBodyEl) panelBodyEl.innerHTML = `<div style="text-align:center; padding: 10px; color: #cbd5e1;">Review details for your assigned task.</div>`;
        } else {
            actionBtnEl.style.display = 'none';
            actionBtnEl.onclick = null;
            if (panelBodyEl) panelBodyEl.innerHTML = `<div style="text-align:center; padding: 10px; color: #f8fafc; font-weight: bold;">Fault is not assigned to you.</div>`;
        }
    }
}

/**
 * Renders the 2D bottom sheet when a marker is scanned that doesn't exist
 * in the current scanning mode's database. Offers the ability to log a new fault.
 */
function renderUnknownPanel(markerId, mode = 'tool') {
    if (panelTitleEl) panelTitleEl.textContent = 'No Record Found';

    const hint = mode === 'tool'
        ? 'If this is a fault, switch to Fault mode.'
        : 'If this is a tool, switch to Tool mode.';

    if (actionBtnEl) {
        if (mode === 'fault') {
            panelTitleEl.textContent = 'Fault Not Logged';
            actionBtnEl.textContent = 'Log New Fault';
            actionBtnEl.className = 'ar-action-btn ar-btn-checkout'; 
            actionBtnEl.style.display = 'block';
            actionBtnEl.disabled = false;
            actionBtnEl.onclick = () => openCreateFaultModal(markerId);
            
            if (panelBodyEl) panelBodyEl.innerHTML = `<div style="text-align:center; padding: 10px; color: #cbd5e1;">Attach a new fault report to Marker #${markerId}.</div>`;
        } else {
            actionBtnEl.style.display = 'none'; 
            actionBtnEl.onclick = null;
            if (panelBodyEl) panelBodyEl.innerHTML = `
                <div style="text-align:center; color:#f0c040; padding: 10px;">
                    No tool found. <br><span style="font-size: 0.85rem; color:#94a3b8;">${hint}</span>
                </div>
            `;
        }
    }
}


// ============================================================================
// AR MODALS & INTERACTIONS
// ============================================================================

/**
 * Triggers the API call to check a tool in or out based on its current status.
 * Disables the UI while processing and triggers a 3D re-render on success.
 */
async function handleToolScan(tool) {
    if (!currentUser) {
        alert('You must be logged in to check out or return tools.');
        return;
    }

    if (actionBtnEl) {
        actionBtnEl.disabled = true;
        actionBtnEl.textContent = 'Processing…';
    }

    try {
        const updated = await scanTool({ marker_id: tool.marker_id });

        if (updated) {
            toolsByMarker[String(updated.marker_id)] = updated;
            activeItem = updated;
            onMarkerFound(String(updated.marker_id)); 
        }
    } catch (err) {
        console.error('[AR] Scan failed:', err);
        alert(`Action failed: ${err.message}`);
        if (actionBtnEl) actionBtnEl.disabled = false;
        renderToolPanel(tool);
    }
}

/**
 * Opens the full-screen AR overlay allowing a technician to view all details
 * of their assigned fault, and optionally resolve it right from the camera feed.
 */
function openARFaultModal(fault) {
    const modal = document.getElementById('ar-fault-modal');
    const title = document.getElementById('ar-modal-title');
    const body = document.getElementById('ar-modal-body');

    if (!modal || !title || !body) return;

    const pColor = fault.priority === 'High' ? '#ef4444' : fault.priority === 'Medium' ? '#f59e0b' : '#3b82f6';
    const sColor = fault.status === 'In-Review' ? '#8b5cf6' : fault.status === 'In-Progress' ? '#3b82f6' : fault.status === 'Resolved' ? '#22c55e' : '#64748b';

    const notesTitle = fault.status === 'Resolved' ? 'Resolution Notes:' : 'Supervisor Notes:';

    title.textContent = `F-${fault.id}: ${fault.title}`;

    let resolutionHtml = '';
    const isMine = currentUser && fault.assigned_to_id == currentUser.id;
    
    if (fault.status !== 'Resolved' && isMine) {
        resolutionHtml = `
            <div style="margin-top: 20px; background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #3b82f6;">
                <strong style="color: #60a5fa;">Resolve Fault</strong>
                <textarea id="ar-resolution-notes" rows="3" placeholder="Enter parts used, actions taken, or resolution details (Required)..." style="width: 100%; margin-top: 10px; padding: 8px; border-radius: 4px; background: #1e293b; color: #f8fafc; border: 1px solid #475569; resize: vertical; box-sizing: border-box; font-family: inherit;"></textarea>
                <button id="ar-btn-resolve" style="width: 100%; margin-top: 10px; padding: 10px; background: #22c55e; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">Mark as Resolved</button>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="ar-modal-grid">
            <div><strong>Location:</strong> ${fault.location}</div>
            <div><strong>Reported By:</strong> ${userName(fault.reported_by_id)}</div>
            <div><strong>Priority:</strong> <span style="color: ${pColor}; font-weight: bold;">${fault.priority || 'N/A'}</span></div>
            <div><strong>Status:</strong> <span style="color: ${sColor}; font-weight: bold;">${fault.status}</span></div>
        </div>
        <hr style="border: 0; border-top: 1px solid #334155; margin: 15px 0;">
        <div>
            <strong>Description:</strong>
            <div style="background: #0f172a; padding: 12px; border-radius: 8px; margin-top: 8px; border: 1px solid #334155;">
                ${fault.description || 'No description provided.'}
            </div>
        </div>
        <div style="margin-top: 15px;">
            <strong>${notesTitle}</strong>
            <div style="background: #0f172a; padding: 12px; border-radius: 8px; margin-top: 8px; border: 1px solid #334155;">
                ${fault.notes || '<span style="color:#64748b">No notes currently.</span>'}
            </div>
        </div>
        ${resolutionHtml}
    `;

    modal.classList.remove('hidden');

    document.getElementById('ar-modal-close').onclick = () => {
        modal.classList.add('hidden');
    };

    const resolveBtn = document.getElementById('ar-btn-resolve');
    if (resolveBtn) {
        resolveBtn.onclick = async () => {
            const newNotes = document.getElementById('ar-resolution-notes').value;
            
            if (!newNotes.trim()) {
                alert('Please enter Resolution Notes before closing this fault.');
                return;
            }

            resolveBtn.textContent = 'Processing...';
            resolveBtn.disabled = true;

            try {
                const combinedNotes = fault.notes 
                    ? `${fault.notes}\n\n[Resolution Notes]: ${newNotes}` 
                    : `[Resolution Notes]: ${newNotes}`;

                await updateFault(fault.id, {
                    status: 'Resolved',
                    notes: combinedNotes
                });

                modal.classList.add('hidden');
                
                alert("Fault resolved successfully!");

                const markerEl = document.getElementById(`barcode-${fault.marker_id}`);
                if (markerEl) {
                    const hudWrapper = markerEl.querySelector('.ar-hud-wrapper');
                    if (hudWrapper) hudWrapper.setAttribute('visible', 'false');
                }

                hideInfoPanel();
                activeItem = null;
                activeType = null;
                
                if (statusEl) {
                    statusEl.textContent = 'Fault resolved. Point camera at a new marker.';
                    statusEl.style.color = '#7ef7a0';
                }

                loadData(); 

            } catch (err) {
                alert("Failed to resolve fault: " + err.message);
                resolveBtn.textContent = 'Mark as Resolved';
                resolveBtn.disabled = false;
            }
        };
    }
}

/**
 * Opens the AR modal enabling a technician to create a new fault tied
 * to an unregistered physical marker that they have just scanned.
 */
function openCreateFaultModal(markerId) {
    const modal = document.getElementById('ar-create-fault-modal');
    if (!modal) return;
    
    document.getElementById('create-marker-id').value = markerId;
    document.getElementById('create-marker-display').value = `Marker #${markerId}`;
    
    document.getElementById('create-title').value = '';
    document.getElementById('create-priority').value = '';
    document.getElementById('create-location').value = '';
    document.getElementById('create-description').value = '';
    
    modal.classList.remove('hidden');
    
    document.getElementById('ar-create-close').onclick = () => {
        modal.classList.add('hidden');
    };
    
    const form = document.getElementById('ar-create-fault-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('btn-submit-new-fault');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        
        try {
            const payload = {
                marker_id: markerId,
                title: document.getElementById('create-title').value,
                priority: document.getElementById('create-priority').value,
                location: document.getElementById('create-location').value,
                description: document.getElementById('create-description').value
            };
            
            await createFault(payload);
            
            modal.classList.add('hidden');
            
            alert(`Success! Fault logged to Marker #${markerId} and sent for review.`);
            hideInfoPanel();
            loadData();
            
        } catch (err) {
            alert("Failed to create fault: " + err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Report';
        }
    };
}


// ============================================================================
// EVENT LISTENERS & BOOTSTRAPPING
// ============================================================================

function showInfoPanel() { if (infoPanelEl) infoPanelEl.classList.add('visible'); }
function hideInfoPanel() { if (infoPanelEl) infoPanelEl.classList.remove('visible'); }

if (homeBtnEl) {
    homeBtnEl.addEventListener('click', () => { window.location.href = '/'; });
}

// AR.js fails to update the 3D canvas aspect ratio immediately on rotation.
// We force the browser to trigger a "resize" event after the OS finishes turning.
window.addEventListener('orientationchange', () => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 500); 
});

// Start the AR application flow
checkCameraSupport();