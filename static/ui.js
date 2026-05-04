import { login, logout, getFaults, getTools, getUsers, updateFault } from './api.js';

// View Navigation Helper
export function showView(viewId) {
    const target = document.getElementById(viewId);
    
    if (!target) {
        console.error(`View with ID '${viewId}' not found!`);
        return; 
    }

    // Determine if we are switching a main app screen or a dashboard sub-screen
    const isMainScreen = (viewId === 'login-view' || viewId === 'dashboard-view');
    const selector = isMainScreen ? '.view-container' : '.sub-view';
    const views = document.querySelectorAll(selector);

    // Fade out everything
    views.forEach(view => {
        view.style.opacity = 0;
    });

    // Hide old, Swap new, Fade in
    setTimeout(() => {

        views.forEach(view => view.classList.add('hidden'));
        target.classList.remove('hidden');

        // NEW: If loading the dashboard, ensure the default sub-view is visible
        if (viewId === 'dashboard-view') {

            document.querySelectorAll('.sub-view').forEach(v => v.classList.add('hidden'));
            const defaultSub = document.getElementById('dashboard-columns-view');

            if (defaultSub) {

                defaultSub.classList.remove('hidden');
                defaultSub.style.opacity = 1;

            }
        }

        requestAnimationFrame(() => {
            target.style.opacity = 1;
        });
    }, 200);
}

// --- MAIN EXPORT ---
export async function loadDashboardData(role, userId) {
    try {
        // 1. Fetch raw data
        const faults = await getFaults();
        const tools = await getTools();
        const users = await getUsers();
        
        let displayFaults = faults;
        let displayTools = tools;
        
        const toolsHeading = document.querySelector('.column:nth-child(2) h3');
        const normalizedRole = role ? role.toLowerCase() : '';

        // 2. Filter base views depending on role
        if (normalizedRole === 'technician') {

            if (toolsHeading) toolsHeading.textContent = "MY CHECKED-OUT TOOLS";

            displayFaults = faults.filter(f => {
                
                const isAssignedToMe = f.assigned_to_id === userId;
                const iReportedInReview = (f.reported_by_id === userId && f.status === 'In-Review');
                return isAssignedToMe || iReportedInReview;
            });

            displayTools = tools.filter(t => t.current_user_id === userId);

        } else {
            if (toolsHeading) toolsHeading.textContent = "TOOL TRACKING LOG";
        }

        // 3. Update the DOM
        updateKPIs(displayFaults, displayTools);
        renderDashboardTables(displayFaults, displayTools, users);

        // 4. Initialize specialized Supervisor logic
        if (['supervisor', 'admin', 'administrator'].includes(normalizedRole)) {
            setupSupervisorViews(faults, tools, users, normalizedRole, userId);
        }

    } catch (error) {
        console.error("Failed to load dashboard data:", error);
    }

}

export function renderSidebar(role) {

    const navContainer = document.querySelector('.sidebar');
    const spacer = navContainer.querySelector('.sidebar-spacer');
    
    navContainer.querySelectorAll('.nav-item').forEach(item => item.remove());

    const techMenu = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'MY FAULTS', view: 'assigned-faults-view' },
        { text: 'MY TOOLS', view: 'active-tools-view' }
    ];

    const supervisorMenu = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'ALL FAULTS', view: 'all-faults-view' },
        { text: 'ALL TOOLS', view: 'all-tools-view' },
        { text: 'FAULTS TO REVIEW', view: 'review-faults-view' },
        { text: 'ASSIGN TECHNICIANS', view: 'assign-tech-view' }
    ];

    const normalizedRole = role ? role.toLowerCase() : '';
    const menu = (normalizedRole === 'supervisor' || normalizedRole === 'admin') ? supervisorMenu : techMenu;

    menu.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = `nav-item ${index === 0 ? 'active' : ''}`;
        btn.textContent = item.text;
        
        btn.onclick = () => {
            navContainer.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showView(item.view);
            navContainer.classList.remove('open');
        };
        
        navContainer.insertBefore(btn, spacer);
    });
}

// Startup Check (Session Persistence)
export async function checkSessionOnLoad() {
    
    try {
        await getFaults(); 
        const userData = localStorage.getItem('ar_user');
        
        if (userData) {

            const user = JSON.parse(userData);
            
            renderSidebar(user.role);
            showView('dashboard-view');
            loadDashboardData(user.role, user.id);

        } else {
            throw new Error("No local user data found");
        }

    } catch (error) {
        console.log("No active session. Please log in.");
    }
}

// Event Listeners Setup
export function setupEventListeners() {

    const btnMenuToggle = document.getElementById('btn-menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (btnMenuToggle && sidebar) {
        btnMenuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const showPassword = document.getElementById('show-password');
    const loginButton = loginForm.querySelector('button');
    const forgotLink = document.getElementById('login-forgot');
    const modal = document.getElementById('forgot-modal');
    const closeModal = document.getElementById('close-modal');
    const btnLogout = document.getElementById('btn-logout');

    if (loginForm) {

        const usernameField = document.getElementById('username');
        const passwordField = document.getElementById('password');

        loginForm.addEventListener('submit', async (e) => {

            e.preventDefault();
            loginButton.disabled = true;
            
            const usernameInput = usernameField.value;
            const passwordInput = passwordField.value;
            
            if (passwordInput.length < 8) {

                loginError.textContent = "Password must be at least 8 characters.";
                loginButton.disabled = false;
                return;
            }

            try {

                loginError.textContent = "Authenticating..."; 
                const user = await login(usernameInput, passwordInput);
                
                localStorage.setItem('ar_user', JSON.stringify(user));
                
                loginError.textContent = "Success! Redirecting...";
                loginError.style.color = "#22c55e";

                setTimeout(() => {

                    renderSidebar(user.role);
                    showView('dashboard-view');
                    loadDashboardData(user.role, user.id);

                    loginError.textContent = "";
                    loginForm.reset();
                    passwordField.type = 'password';
                    loginError.style.color = "#ff5555";
                    loginButton.disabled = false;

                }, 400);
            
            } catch (error) {
                loginError.textContent = error.message || "Invalid credentials.";
                loginButton.disabled = false;
            }
        });

        passwordField.addEventListener('input', () => {
            loginButton.disabled = passwordField.value.length < 8;
        });

        showPassword.addEventListener('change', () => {
            passwordField.type = showPassword.checked ? 'text' : 'password';
        });

    }

    if (forgotLink && modal && closeModal) {

        forgotLink.addEventListener('click', () => modal.classList.remove('hidden'));
        closeModal.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }

    if (btnLogout) {

        btnLogout.addEventListener('click', async () => {
            
            try {
                await logout();

                localStorage.removeItem('ar_user'); 
                showView('login-view'); 
                // We do need to manually hide the dashboard on logout to reset the state
                document.getElementById('dashboard-view').classList.add('hidden');

            } catch (error) {

                if (error.message.includes("WARNING_UNRETURNED_TOOLS")) {
                    
                    if (confirm("You have unreturned tools! Are you sure you want to log out?")) {
                        await logout(true); 

                        localStorage.removeItem('ar_user');
                        showView('login-view');
                        document.getElementById('dashboard-view').classList.add('hidden');
                    }
                } else {
                    alert("Logout failed: " + error.message);
                }
            }
        });
    }
}



// UTILITY HELPERS
const getUserName = (users, id) => {
    
    if (!id) return '<span style="color:#64748b;">Unassigned</span>';
    const u = users.find(user => user.id === id);
    return u ? `${u.first_name} ${u.last_name}` : `User ${id}`;
};

// KPI UPDATER
const updateKPIs = (displayFaults, displayTools) => {

    const activeCount = displayFaults.filter(f => f.status === 'Active').length;
    const reviewCount = displayFaults.filter(f => f.status === 'In-Review').length;
    const progressCount = displayFaults.filter(f => f.status === 'In-Progress').length; 
    const toolsOutCount = displayTools.filter(t => t.status === 'Checked-Out').length;
    const toolsAvailCount = displayTools.filter(t => t.status === 'Available').length;
    
    if (document.getElementById('kpi-active')) document.getElementById('kpi-active').textContent = activeCount;
    if (document.getElementById('kpi-review')) document.getElementById('kpi-review').textContent = reviewCount;
    if (document.getElementById('kpi-progress')) document.getElementById('kpi-progress').textContent = progressCount;
    if (document.getElementById('kpi-tools-out')) document.getElementById('kpi-tools-out').textContent = toolsOutCount;
    if (document.getElementById('kpi-tools-avail')) document.getElementById('kpi-tools-avail').textContent = toolsAvailCount;

};



// BASE DASHBOARD TABLES
let dashFaultsState = { sortCol: 'id', sortAsc: true };
let dashToolsState = { sortCol: 'id', sortAsc: true };

const renderDashboardTables = (displayFaults, displayTools, users) => {
    
    // Render Dashboard Faults
    const faultsBody = document.getElementById('faults-table-body');
    if (faultsBody) {

        let liveFaults = displayFaults.filter(f => f.status.trim().toLowerCase() !== 'resolved');
        
        // Sort Faults
        liveFaults.sort((a, b) => {

            let valA, valB;

            switch(dashFaultsState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'title': valA = a.title; valB = b.title; break;
                case 'location': valA = a.location; valB = b.location; break;
                case 'priority': valA = a.priority || 'Z'; valB = b.priority || 'Z'; break;
                case 'status': valA = a.status; valB = b.status; break;
                default: valA = a.id; valB = b.id;
            }

            if (valA < valB) return dashFaultsState.sortAsc ? -1 : 1;
            if (valA > valB) return dashFaultsState.sortAsc ? 1 : -1;

            return 0;
        });

        faultsBody.innerHTML = ''; 

        liveFaults.forEach(fault => {

            let badgeClass = fault.status === 'In-Progress' ? 'badge-assigned' : fault.status === 'In-Review' ? 'badge-review' : 'badge-active';
            let priorityClass = fault.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';

            faultsBody.innerHTML += `
                <tr>
                    <td>F-${fault.id}</td>
                    <td>${fault.title}</td>
                    <td>${fault.location}</td>
                    <td><span class="badge ${priorityClass}">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></td>
                    <td><span class="badge ${badgeClass}">${fault.status.toUpperCase()}</span></td>
                </tr>`;
        });
    }

    // --- Render Dashboard Tools ---
    const toolsBody = document.getElementById('tools-table-body');

    if (toolsBody) {

        let toolsArray = [...displayTools];
        
        // Sort Tools
        toolsArray.sort((a, b) => {

            let valA, valB;

            switch(dashToolsState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'type': valA = a.tool_type; valB = b.tool_type; break;
                case 'status': valA = a.status; valB = b.status; break;
                case 'user': valA = getUserName(users, a.current_user_id); valB = getUserName(users, b.current_user_id); break;
                default: valA = a.id; valB = b.id;
            }

            if (valA < valB) return dashToolsState.sortAsc ? -1 : 1;
            if (valA > valB) return dashToolsState.sortAsc ? 1 : -1;

            return 0;
        });

        toolsBody.innerHTML = ''; 
        toolsArray.forEach(tool => {

            let toolBadgeClass = tool.status === 'Available' ? 'badge-available' : 'badge-out';
            let userDisplay = tool.current_user_id ? getUserName(users, tool.current_user_id) + ` (User ${tool.current_user_id})` : 'In Storage';

            toolsBody.innerHTML += `
                <tr>
                    <td>${tool.id}</td>
                    <td>${tool.tool_type}</td>
                    <td><span class="badge ${toolBadgeClass}">${tool.status.toUpperCase()}</span></td>
                    <td>${userDisplay}</td>
                </tr>`;
        });

    }

    // Attach Sorting Event Listeners (Using .onclick to prevent stacking re-renders)
    document.querySelectorAll('#dashboard-columns-view .column:nth-child(1) th[data-sort]').forEach(th => {
        
        th.onclick = () => { 
            dashFaultsState.sortAsc = (dashFaultsState.sortCol === th.dataset.sort) ? !dashFaultsState.sortAsc : true; 
            dashFaultsState.sortCol = th.dataset.sort; 
            renderDashboardTables(displayFaults, displayTools, users); 
        };
    });

    document.querySelectorAll('#dashboard-columns-view .column:nth-child(2) th[data-sort]').forEach(th => {
        th.onclick = () => { 
            dashToolsState.sortAsc = (dashToolsState.sortCol === th.dataset.sort) ? !dashToolsState.sortAsc : true; 
            dashToolsState.sortCol = th.dataset.sort; 
            renderDashboardTables(displayFaults, displayTools, users); 
        };
    });
};

// SUPERVISOR LOGIC ENCAPSULATION
const setupSupervisorViews = (faults, tools, users, normalizedRole, userId) => {

    // State Management
    let toolsState = { data: [...tools], sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
    let faultsState = { data: [...faults], sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
    let reviewState = { sortCol: 'time', sortAsc: false };

    // Tool Rendering
    const renderAllTools = () => {

        const tbody = document.getElementById('all-tools-table-body');

        if (!tbody) return;

        let processed = toolsState.data.filter(t => toolsState.filter === 'all' || t.status.toLowerCase() === toolsState.filter);

        if (toolsState.search) {

            const s = toolsState.search.toLowerCase();
            processed = processed.filter(t => String(t.id).includes(s) || t.tool_type.toLowerCase().includes(s) || getUserName(users, t.current_user_id).toLowerCase().includes(s));

        }

        processed.sort((a, b) => {

            let valA, valB;

            switch(toolsState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'type': valA = a.tool_type; valB = b.tool_type; break;
                case 'status': valA = a.status; valB = b.status; break;
                case 'user': valA = getUserName(users, a.current_user_id); valB = getUserName(users, b.current_user_id); break;
                case 'time': valA = a.checkout_timestamp || ''; valB = b.checkout_timestamp || ''; break;
                default: valA = a.id; valB = b.id;
            }

            if (valA < valB) return toolsState.sortAsc ? -1 : 1;
            if (valA > valB) return toolsState.sortAsc ? 1 : -1;

            return 0;
        });

        tbody.innerHTML = '';

        processed.forEach(t => {
            let toolBadgeClass = t.status === 'Available' ? 'badge-available' : 'badge-out';
            let checkoutTime = t.checkout_timestamp ? new Date(t.checkout_timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';
            tbody.innerHTML += `<tr><td>${t.id}</td><td>${t.tool_type}</td><td><span class="badge ${toolBadgeClass}">${t.status.toUpperCase()}</span></td><td>${t.current_user_id ? getUserName(users, t.current_user_id) : '<span style="color:#64748b;">In Storage</span>'}</td><td>${checkoutTime}</td></tr>`;
        });
    };

    // Fault Rendering
    const renderAllFaults = () => {

        const tbody = document.getElementById('all-faults-table-body');

        if (!tbody) return;

        let processed = faultsState.data.filter(f => faultsState.filter === 'all' || f.status.toLowerCase() === faultsState.filter);

        if (faultsState.search) {
            const s = faultsState.search.toLowerCase();
            processed = processed.filter(f => String(f.id).includes(s) || f.title.toLowerCase().includes(s) || f.location.toLowerCase().includes(s));
        }

        processed.sort((a, b) => {

            let valA, valB;

            switch(faultsState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'title': valA = a.title; valB = b.title; break;
                case 'location': valA = a.location; valB = b.location; break;
                case 'priority': valA = a.priority || 'Z'; valB = b.priority || 'Z'; break;
                case 'status': valA = a.status; valB = b.status; break;
                case 'reported': valA = getUserName(users, a.reported_by_id); valB = getUserName(users, b.reported_by_id); break;
                case 'assigned': valA = getUserName(users, a.assigned_to_id); valB = getUserName(users, b.assigned_to_id); break;
                case 'time': valA = a.timestamp || ''; valB = b.timestamp || ''; break;
                default: valA = a.id; valB = b.id;
            }

            if (valA < valB) return faultsState.sortAsc ? -1 : 1;
            if (valA > valB) return faultsState.sortAsc ? 1 : -1;

            return 0;
        });

        tbody.innerHTML = '';

        processed.forEach(f => {
            let badgeClass = f.status === 'Resolved' ? 'badge-available' : f.status === 'In-Review' ? 'badge-review' : f.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';
            let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
            let reportedTime = f.timestamp ? new Date(f.timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';
            tbody.innerHTML += `<tr><td>F-${f.id}</td><td>${f.title}</td><td>${f.location}</td><td><span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td><td><span class="badge ${badgeClass}">${f.status.toUpperCase()}</span></td><td>${getUserName(users, f.reported_by_id)}</td><td>${getUserName(users, f.assigned_to_id)}</td><td>${reportedTime}</td><td><button class="btn-solid btn-view-report" data-id="${f.id}" style="padding: 4px 8px; font-size: 0.75rem; background: #3b82f6;">View Report</button></td></tr>`;
        });
    };

    // Action Queue Rendering
    const renderReviewQueue = () => {

        const tbody = document.getElementById('review-faults-table-body');

        if (!tbody) return;

        let reviewFaults = faults.filter(f => f.status === 'In-Review');

        reviewFaults.sort((a, b) => { /* ... Keep your existing sorting logic ... */ });

        tbody.innerHTML = '';
        
        if (reviewFaults.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 30px; color: #94a3b8;">No faults pending review. Great job! 🎉</td></tr>';
            return;
        }

        reviewFaults.forEach(f => {

            let reportedTime = f.timestamp ? new Date(f.timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';

            tbody.innerHTML += `
                <tr>
                    <td>F-${f.id}</td>
                    <td>${f.title}</td>
                    <td>${f.location}</td>
                    <td>${getUserName(users, f.reported_by_id)}</td>
                    <td>${reportedTime}</td>
                    <td>
                        <select class="select-priority" style="padding: 6px; background: #0f172a; color: white; border: 1px solid #334155; border-radius: 4px; width: 100%;">
                            <option value="" disabled selected>-- Select --</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                        </select>
                    </td>
                    <td>
                        <!-- REPLACED DROPDOWN WITH BUTTON -->
                        <button class="btn-outline btn-open-tech-modal" data-tech-id="" style="padding: 6px; background: #0f172a; color: #94a3b8; border: 1px solid #334155; border-radius: 4px; width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center;">
                            <span class="tech-name-display">-- Unassigned --</span>
                            <span>🔍</span>
                        </button>
                    </td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="btn-solid btn-view-modal" data-id="${f.id}" style="padding: 6px 10px; background: #3b82f6; min-width: auto;" title="View Full Report">👁️</button>
                            <button class="btn-solid btn-approve-fault" data-id="${f.id}" style="padding: 6px 10px; background: #22c55e; min-width: auto;" title="Quick Approve">✓</button>
                            <button class="btn-solid btn-reject-fault" data-id="${f.id}" style="padding: 6px 10px; background: #ef4444; min-width: auto;" title="Quick Reject">✕</button>
                        </div>
                    </td>
                </tr>`;
        });
    };

    // MODAL LOGIC
    const reportModal = document.getElementById('fault-report-modal');
    const closeReportBtn = document.getElementById('close-report-modal');

    const openFaultModal = (faultId) => {

        const fault = faults.find(f => f.id === faultId);

        if (!fault) return;

        document.getElementById('report-id').textContent = `F-${fault.id}`;
        
        let priorityClass = fault.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
        let badgeClass = fault.status === 'Resolved' ? 'badge-available' : fault.status === 'In-Review' ? 'badge-review' : fault.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';

        const technicians = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
        let techOptions = '<option value="">-- Unassigned --</option>';
        technicians.forEach(t => { techOptions += `<option value="${t.id}">${t.first_name} ${t.last_name}</option>`; });

        let interactiveSection = '';
        let staticNotes = `
            <div style="margin-top: 5px;">
                <strong style="color:#ffffff;">Supervisor Notes:</strong>
                <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 8px; line-height: 1.6; border: 1px solid #334155;">
                    ${fault.notes || '<span style="color:#cbd5e1;">No notes recorded yet.</span>'}
                </div>
            </div>
        `;

        if (fault.status === 'In-Review') {
            staticNotes = ''; 
            interactiveSection = `
                <div style="margin-top: 15px; background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155;">
                    <h3 style="margin-top: 0; color: #d8b4fe; margin-bottom: 15px;">Actions:</h3>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <div>
                            <strong style="color:#ffffff; font-size: 0.9rem;">Set Priority:</strong>
                            <select id="modal-select-priority" style="width: 100%; padding: 8px; background: #1e293b; color: white; border: 1px solid #475569; border-radius: 4px; margin-top: 5px;">
                                <option value="" disabled selected>-- Select Priority --</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>
                        </div>
                        <div>
                            <strong style="color:#ffffff; font-size: 0.9rem;">Assign Tech:</strong>
                            <select id="modal-select-tech" style="width: 100%; padding: 8px; background: #1e293b; color: white; border: 1px solid #475569; border-radius: 4px; margin-top: 5px;">
                                ${techOptions}
                            </select>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <strong style="color:#ffffff; font-size: 0.9rem;">Add Note (Required for rejection):</strong>
                        <textarea id="modal-input-notes" rows="3" placeholder="Enter instructions or rejection reasons here..." style="width: 100%; padding: 8px; background: #1e293b; color: white; border: 1px solid #475569; border-radius: 4px; margin-top: 5px; font-family: inherit; resize: vertical; box-sizing: border-box;"></textarea>
                    </div>

                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button id="modal-btn-reject" class="btn-solid" data-id="${fault.id}" style="background: #ef4444; width: auto; padding: 8px 20px;">Reject ✕</button>
                        <button id="modal-btn-approve" class="btn-solid" data-id="${fault.id}" style="background: #22c55e; width: auto; padding: 8px 20px;">Approve ✓</button>
                    </div>
                </div>
            `;
        }

        const content = document.getElementById('report-content');
        content.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px; color: #f8fafc;">
                <div><strong style="color:#ffffff;">Title:</strong> <br>${fault.title}</div>
                <div><strong style="color:#ffffff;">Location:</strong> <br>${fault.location}</div>
                <div><strong style="color:#ffffff;">Status:</strong> <br><span class="badge ${badgeClass}" style="margin-top:4px; display:inline-block;">${fault.status.toUpperCase()}</span></div>
                <div><strong style="color:#ffffff;">Priority:</strong> <br><span class="badge ${priorityClass}" style="margin-top:4px; display:inline-block;">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></div>
                <div><strong style="color:#ffffff;">Reported By:</strong> <br>${getUserName(users, fault.reported_by_id)}</div>
                <div><strong style="color:#ffffff;">Assigned To:</strong> <br>${getUserName(users, fault.assigned_to_id)}</div>
                <div><strong style="color:#ffffff;">Resolved By:</strong> <br>${getUserName(users, fault.resolved_by_id)}</div>
                <div><strong style="color:#ffffff;">Logged Time:</strong> <br>${fault.timestamp ? new Date(fault.timestamp).toLocaleString() : 'N/A'}</div>
            </div>
            <hr style="border: 0; border-top: 1px solid #475569; margin: 15px 0;">
            <div>
                <strong style="color:#ffffff;">Description:</strong>
                <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 8px; line-height: 1.6; border: 1px solid #334155;">
                    ${fault.description || '<span style="color:#cbd5e1;">No description provided.</span>'}
                </div>
            </div>
            ${staticNotes}
            ${interactiveSection}
        `;
        
        const btnApprove = document.getElementById('modal-btn-approve');
        const btnReject = document.getElementById('modal-btn-reject');
        
        if (btnApprove) {

            btnApprove.onclick = async () => {

                const priorityVal = document.getElementById('modal-select-priority').value;
                const techIdVal = document.getElementById('modal-select-tech').value;
                const notesVal = document.getElementById('modal-input-notes').value;

                if (!priorityVal) {
                    alert("Please select a Priority level before approving this fault.");
                    return;
                }

                btnApprove.textContent = "⏳";
                btnApprove.disabled = true;

                try {

                    const newStatus = techIdVal ? 'Assigned' : 'Active';

                    await updateFault(fault.id, {
                        status: newStatus,
                        priority: priorityVal,
                        assigned_to_id: techIdVal ? parseInt(techIdVal) : null,
                        notes: notesVal ? notesVal : undefined
                    });

                    reportModal.classList.add('hidden');
                    loadDashboardData(normalizedRole, userId);

                } catch (error) {
                    alert("Failed to approve: " + error.message);
                    btnApprove.textContent = "Approve ✓";
                    btnApprove.disabled = false;
                }
            };
        }

        if (btnReject) {

            btnReject.onclick = async () => {

                const notesVal = document.getElementById('modal-input-notes').value;

                if (!notesVal.trim()) {
                    alert("Please provide a reason in the Notes section before rejecting.");
                    return;
                }

                btnReject.textContent = "⏳";
                btnReject.disabled = true;

                try {
                    await updateFault(fault.id, {
                        status: 'Resolved',
                        priority: 'Low',
                        notes: `[REJECTED]: ${notesVal}`
                    });

                    reportModal.classList.add('hidden');
                    loadDashboardData(normalizedRole, userId);

                } catch (error) {
                    alert("Failed to reject: " + error.message);
                    btnReject.textContent = "Reject ✕";
                    btnReject.disabled = false;
                }
            };
        }


        reportModal.classList.remove('hidden');

    };

    // Close Modal Listeners
    if (closeReportBtn && reportModal) {
        closeReportBtn.onclick = () => reportModal.classList.add('hidden');
        reportModal.onclick = (e) => { if (e.target === reportModal) reportModal.classList.add('hidden'); };
    }

    // REFACTORED DOM LISTENERS
    const searchTools = document.getElementById('search-tools');
    if (searchTools) searchTools.oninput = (e) => { toolsState.search = e.target.value; renderAllTools(); };
    
    const filterTools = document.getElementById('filter-tools');
    if (filterTools) filterTools.onchange = (e) => { toolsState.filter = e.target.value; renderAllTools(); };

    document.querySelectorAll('#all-tools-view th[data-sort]').forEach(th => {
        th.onclick = () => { toolsState.sortAsc = (toolsState.sortCol === th.dataset.sort) ? !toolsState.sortAsc : true; toolsState.sortCol = th.dataset.sort; renderAllTools(); };
    });

    const searchFaults = document.getElementById('search-faults');
    if (searchFaults) searchFaults.oninput = (e) => { faultsState.search = e.target.value; renderAllFaults(); };

    const filterFaults = document.getElementById('filter-faults');
    if (filterFaults) filterFaults.onchange = (e) => { faultsState.filter = e.target.value; renderAllFaults(); };

    document.querySelectorAll('#all-faults-view th[data-sort]').forEach(th => {
        th.onclick = () => { faultsState.sortAsc = (faultsState.sortCol === th.dataset.sort) ? !faultsState.sortAsc : true; faultsState.sortCol = th.dataset.sort; renderAllFaults(); };
    });

    document.querySelectorAll('#review-faults-view th[data-sort]').forEach(th => {
        th.onclick = () => { reviewState.sortAsc = (reviewState.sortCol === th.dataset.sort) ? !reviewState.sortAsc : true; reviewState.sortCol = th.dataset.sort; renderReviewQueue(); };
    });



// TECHNICIAN SELECT MODAL LOGIC
    const techModal = document.getElementById('tech-select-modal');
    const techTbody = document.getElementById('tech-modal-table-body');
    const closeTechBtn = document.getElementById('close-tech-modal');
    const clearTechBtn = document.getElementById('btn-clear-tech');

    let activeTechAssignBtn = null; // Tracks which table row we are currently editing

    // Handle opening the modal from anywhere (Dashboard table OR the Report Modal)
    document.addEventListener('click', (e) => {

        const openBtn = e.target.closest('.btn-open-tech-modal');

        if (openBtn) {

            activeTechAssignBtn = openBtn;
            
            // Build the table
            const technicians = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
            techTbody.innerHTML = '';

            technicians.forEach(t => {

                // Calculate Workload dynamically!
                const activeJobs = faults.filter(f => f.assigned_to_id === t.id && ['Active', 'In-Progress'].includes(f.status)).length;

                let workloadBadge = activeJobs > 3 ? 'badge-high' : activeJobs > 0 ? 'badge-assigned' : 'badge-available';

                techTbody.innerHTML += `
                    <tr>
                        <td style="color: white; font-weight: bold;">${t.first_name} ${t.last_name}</td>
                        <td><span class="badge ${workloadBadge}">${activeJobs} Jobs</span></td>
                        <td>
                            <button class="btn-solid btn-choose-tech" data-tech-id="${t.id}" data-tech-name="${t.first_name} ${t.last_name}" style="padding: 4px 12px; background: #3b82f6; width: auto;">Select</button>
                        </td>
                    </tr>
                `;
            });

            techModal.classList.remove('hidden');

        }

    });

    // Handle choosing a tech
    if (techTbody) {

        techTbody.onclick = (e) => {

            if (e.target.classList.contains('btn-choose-tech')) {

                const techId = e.target.getAttribute('data-tech-id');
                const techName = e.target.getAttribute('data-tech-name');


                if (activeTechAssignBtn) {

                    activeTechAssignBtn.setAttribute('data-tech-id', techId);
                    activeTechAssignBtn.querySelector('.tech-name-display').textContent = techName;
                    activeTechAssignBtn.querySelector('.tech-name-display').style.color = '#ffffff';
                    activeTechAssignBtn.style.borderColor = '#3b82f6'; // Highlight to show it's selected
                }

                techModal.classList.add('hidden');

            }
        };
    }

    // Handle clearing the tech
    if (clearTechBtn) {

        clearTechBtn.onclick = () => {

            if (activeTechAssignBtn) {

                activeTechAssignBtn.setAttribute('data-tech-id', '');
                activeTechAssignBtn.querySelector('.tech-name-display').textContent = '-- Unassigned --';
                activeTechAssignBtn.querySelector('.tech-name-display').style.color = '#94a3b8';
                activeTechAssignBtn.style.borderColor = '#334155';

            }

            techModal.classList.add('hidden');

        };
    }

    // Close Modals
    if (closeTechBtn && techModal) {
        closeTechBtn.onclick = () => techModal.classList.add('hidden');
        techModal.addEventListener('click', (e) => { if (e.target === techModal) techModal.classList.add('hidden'); });
    }



    // REVIEW FAULTS EVENT DELEGATION
    const reviewTbody = document.getElementById('review-faults-table-body');

    if (reviewTbody) {

        reviewTbody.onclick = async (e) => {

            if (e.target.classList.contains('btn-view-modal')) {

                const faultId = parseInt(e.target.getAttribute('data-id'));
                openFaultModal(faultId);
                return;
            }

            if (e.target.classList.contains('btn-approve-fault')) {

                const btn = e.target;
                const faultId = parseInt(btn.getAttribute('data-id'));
                const row = btn.closest('tr');
                
                const priorityVal = row.querySelector('.select-priority').value;
                const techIdVal = row.querySelector('.btn-open-tech-modal').getAttribute('data-tech-id');

                if (!priorityVal) {
                    alert("Please select a Priority level before approving this fault.");
                    return;
                }

                btn.textContent = "⏳";
                btn.style.opacity = "0.7";
                btn.disabled = true;

                try {

                    const newStatus = techIdVal ? 'Assigned' : 'Active';

                    await updateFault(faultId, {
                        status: newStatus,
                        priority: priorityVal,
                        assigned_to_id: techIdVal ? parseInt(techIdVal) : null
                    });

                    loadDashboardData(normalizedRole, userId);

                } catch (error) {
                    alert("Failed to approve: " + error.message);
                    btn.textContent = "✓";
                    btn.style.opacity = "1";
                    btn.disabled = false;
                }
            }

            if (e.target.classList.contains('btn-reject-fault')) {

                const btn = e.target;
                const faultId = parseInt(btn.getAttribute('data-id'));
                
                const reason = prompt("Enter a reason for rejecting this fault (optional):");

                if (reason === null) return; 

                btn.textContent = "⏳";
                btn.style.opacity = "0.7";
                btn.disabled = true;

                try {

                    await updateFault(faultId, {
                        status: 'Resolved',
                        priority: 'Low',
                        notes: reason ? `[REJECTED]: ${reason}` : `[REJECTED]: No reason provided by supervisor.`
                    });

                    loadDashboardData(normalizedRole, userId);

                } catch (error) {
                    alert("Failed to reject: " + error.message);
                    btn.textContent = "✕";
                    btn.style.opacity = "1";
                    btn.disabled = false;
                }

            }
        };
    }

    // ALL FAULTS VIEW EVENT DELEGATION
    const faultsTbody = document.getElementById('all-faults-table-body');
    
    if (faultsTbody) {

        faultsTbody.onclick = (e) => {

            if (e.target.classList.contains('btn-view-report')) {
                const faultId = parseInt(e.target.getAttribute('data-id'));
                openFaultModal(faultId);
            }

        };

    }

    renderAllTools();
    renderAllFaults();
    renderReviewQueue();
};