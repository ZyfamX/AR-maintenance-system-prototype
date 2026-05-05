import { login, logout, getFaults, getTools, getUsers, updateFault } from './api.js';

// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================

// Base Dashboard Sorting State
let dashFaultsState = { sortCol: 'id', sortAsc: true };
let dashToolsState = { sortCol: 'id', sortAsc: true };

// Supervisor Table & Filter State
let toolsState = { sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
let faultsState = { sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
let reviewState = { sortCol: 'time', sortAsc: false };

// Modal Interaction State
let activeTechAssignBtn = null; 


// ============================================================================
// VIEW NAVIGATION & AUTHENTICATION
// ============================================================================

export function showView(viewId) {
    const target = document.getElementById(viewId);
    if (!target) return console.error(`View with ID '${viewId}' not found!`);

    const isMainScreen = (viewId === 'login-view' || viewId === 'dashboard-view');
    const views = document.querySelectorAll(isMainScreen ? '.view-container' : '.sub-view');

    views.forEach(view => view.style.opacity = 0);

    setTimeout(() => {
        views.forEach(view => view.classList.add('hidden'));
        target.classList.remove('hidden');

        if (viewId === 'dashboard-view') {
            document.querySelectorAll('.sub-view').forEach(v => v.classList.add('hidden'));
            const defaultSub = document.getElementById('dashboard-columns-view');
            if (defaultSub) {
                defaultSub.classList.remove('hidden');
                defaultSub.style.opacity = 1;
            }
        }

        requestAnimationFrame(() => target.style.opacity = 1);
    }, 200);
}

export function renderSidebar(role) {
    const navContainer = document.querySelector('.sidebar');
    const spacer = navContainer.querySelector('.sidebar-spacer');
    
    navContainer.querySelectorAll('.nav-item').forEach(item => item.remove());

    const normalizedRole = role ? role.toLowerCase() : '';
    const isSupervisor = ['supervisor', 'admin', 'administrator'].includes(normalizedRole);

    // Dynamic Header Title
    const headerTitle = document.getElementById('header-role-title');
    if (headerTitle) headerTitle.textContent = isSupervisor ? 'Supervisor Dashboard' : 'Technician Dashboard';

    // Toggle AR Button Visibility
    const fabContainer = document.querySelector('.fab-container');
    if (fabContainer) {
        if (isSupervisor) fabContainer.classList.add('hidden'); 
        else fabContainer.classList.remove('hidden'); 
    }

    const techMenu = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'MY FAULTS', view: 'assigned-faults-view' },
        { text: 'MY TOOLS', view: 'active-tools-view' },
        { text: 'AVAILABLE TOOLS', view: 'available-tools-view' }
    ];

    const supervisorMenu = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'ALL FAULTS', view: 'all-faults-view' },
        { text: 'ALL TOOLS', view: 'all-tools-view' },
        { text: 'FAULTS TO REVIEW', view: 'review-faults-view' },
        { text: 'ASSIGN TECHNICIANS', view: 'assign-tech-view' }
    ];

    const menu = isSupervisor ? supervisorMenu : techMenu;

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

export async function checkSessionOnLoad() {
    try {
        await getFaults(); 
        const userData = localStorage.getItem('ar_user');
        if (userData) {
            const user = JSON.parse(userData);
            renderSidebar(user.role);
            showView('dashboard-view');
            loadDashboardData(user.role, user.id);
        } else throw new Error("No local user data found");
    } catch (error) {
        console.log("No active session. Please log in.");
    }
}

export function setupEventListeners() {
    const btnMenuToggle = document.getElementById('btn-menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (btnMenuToggle && sidebar) {
        btnMenuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        const loginError = document.getElementById('login-error');
        const showPassword = document.getElementById('show-password');
        const loginButton = loginForm.querySelector('button');
        const usernameField = document.getElementById('username');
        const passwordField = document.getElementById('password');

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            loginButton.disabled = true;
            
            if (passwordField.value.length < 8) {
                loginError.textContent = "Password must be at least 8 characters.";
                loginButton.disabled = false;
                return;
            }

            try {
                loginError.textContent = "Authenticating..."; 
                const user = await login(usernameField.value, passwordField.value);
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

        passwordField.addEventListener('input', () => loginButton.disabled = passwordField.value.length < 8);
        showPassword.addEventListener('change', () => passwordField.type = showPassword.checked ? 'text' : 'password');
    }

    const forgotLink = document.getElementById('login-forgot');
    const modal = document.getElementById('forgot-modal');
    const closeModal = document.getElementById('close-modal');
    if (forgotLink && modal && closeModal) {
        forgotLink.addEventListener('click', () => modal.classList.remove('hidden'));
        closeModal.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await logout();
                localStorage.removeItem('ar_user'); 
                showView('login-view'); 
                document.getElementById('dashboard-view').classList.add('hidden');
            } catch (error) {
                if (error.message.includes("WARNING_UNRETURNED_TOOLS") && confirm("You have unreturned tools! Are you sure you want to log out?")) {
                    await logout(true); 
                    localStorage.removeItem('ar_user');
                    showView('login-view');
                    document.getElementById('dashboard-view').classList.add('hidden');
                } else alert("Logout failed: " + error.message);
            }
        });
    }
}


// ============================================================================
// BASE DASHBOARD INITIALISATION
// ============================================================================

export async function loadDashboardData(role, userId) {
    try {
        const faults = await getFaults();
        const tools = await getTools();
        const users = await getUsers();
        
        let displayFaults = faults;
        let displayTools = tools;
        
        const toolsHeading = document.querySelector('.column:nth-child(2) h3');
        const normalizedRole = role ? role.toLowerCase() : '';

        if (normalizedRole === 'technician') {
            if (toolsHeading) toolsHeading.textContent = "MY CHECKED-OUT TOOLS";
            displayFaults = faults.filter(f => (f.assigned_to_id === userId) || (f.reported_by_id === userId && f.status === 'In-Review'));
            displayTools = tools.filter(t => t.current_user_id === userId);
        } else {
            if (toolsHeading) toolsHeading.textContent = "TOOL TRACKING LOG";
        }

        updateKPIs(displayFaults, displayTools, tools);
        renderDashboardTables(displayFaults, displayTools, users);

        if (['supervisor', 'admin', 'administrator'].includes(normalizedRole)) {
            setupSupervisorViews(faults, tools, users, normalizedRole, userId);
        } else if (normalizedRole === 'technician') {
            // CRITICAL: We pass the un-filtered 'tools' array here!
            setupTechnicianViews(displayFaults, tools, normalizedRole, userId);
        }
    } catch (error) {
        console.error("Failed to load dashboard data:", error);
    }
}

const updateKPIs = (displayFaults, displayTools, allTools = null) => {
    
    // Fallback to displayTools if allTools isn't passed
    const toolsSource = allTools || displayTools; 

    if (document.getElementById('kpi-active')) document.getElementById('kpi-active').textContent = displayFaults.filter(f => f.status === 'Active').length;
    if (document.getElementById('kpi-review')) document.getElementById('kpi-review').textContent = displayFaults.filter(f => f.status === 'In-Review').length;
    if (document.getElementById('kpi-progress')) document.getElementById('kpi-progress').textContent = displayFaults.filter(f => f.status === 'In-Progress').length;
    if (document.getElementById('kpi-tools-out')) document.getElementById('kpi-tools-out').textContent = displayTools.filter(t => t.status === 'Checked-Out').length;
    
    // Count from the master list (toolsSource), not the technician's personal list
    if (document.getElementById('kpi-tools-avail')) document.getElementById('kpi-tools-avail').textContent = toolsSource.filter(t => t.status === 'Available').length;
};

const renderDashboardTables = (displayFaults, displayTools, users) => {
    
    // DASHBOARD FAULTS
    const faultsBody = document.getElementById('faults-table-body');
    if (faultsBody) {
        let liveFaults = displayFaults.filter(f => f.status.trim().toLowerCase() !== 'resolved');
        
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

        faultsBody.innerHTML = liveFaults.map(fault => {
            let badgeClass = fault.status === 'In-Progress' ? 'badge-assigned' : fault.status === 'In-Review' ? 'badge-review' : 'badge-active';
            let priorityClass = fault.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
            return `
                <tr>
                    <td>F-${fault.id}</td>
                    <td>${fault.title}</td>
                    <td>${fault.location}</td>
                    <td><span class="badge ${priorityClass}">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></td>
                    <td><span class="badge ${badgeClass}">${fault.status.toUpperCase()}</span></td>
                </tr>`;
        }).join('');
    }

    // DASHBOARD TOOLS
    const toolsBody = document.getElementById('tools-table-body');
    if (toolsBody) {
        let toolsArray = [...displayTools];
        
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

        toolsBody.innerHTML = toolsArray.map(tool => {
            let toolBadgeClass = tool.status === 'Available' ? 'badge-available' : 'badge-out';
            let userDisplay = tool.current_user_id ? `${getUserName(users, tool.current_user_id)} (User ${tool.current_user_id})` : 'In Storage';
            return `
                <tr>
                    <td>${tool.id}</td>
                    <td>${tool.tool_type}</td>
                    <td><span class="badge ${toolBadgeClass}">${tool.status.toUpperCase()}</span></td>
                    <td>${userDisplay}</td>
                </tr>`;
        }).join('');
    }

    // Bind base dashboard sorting
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


// ============================================================================
// SUPERVISOR CONTROLLER
// ============================================================================

const setupSupervisorViews = (faults, tools, users, normalizedRole, userId) => {
    // Bind all interactive events
    setupSupervisorEvents(faults, tools, users, normalizedRole, userId);
    
    // Render all specialized views
    renderAllTools(tools, users);
    renderAllFaults(faults, users);
    renderReviewQueue(faults, users);
    renderAssignTechView(faults, users);
};


// ============================================================================
// SUPERVISOR RENDERERS
// ============================================================================

const renderAllTools = (tools, users) => {
    const tbody = document.getElementById('all-tools-table-body');
    if (!tbody) return;

    let processed = tools.filter(t => toolsState.filter === 'all' || t.status.toLowerCase() === toolsState.filter);
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

    tbody.innerHTML = processed.map(t => {
        let toolBadgeClass = t.status === 'Available' ? 'badge-available' : 'badge-out';
        let checkoutTime = t.checkout_timestamp ? new Date(t.checkout_timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';
        return `<tr><td>${t.id}</td><td>${t.tool_type}</td><td><span class="badge ${toolBadgeClass}">${t.status.toUpperCase()}</span></td><td>${t.current_user_id ? getUserName(users, t.current_user_id) : '<span style="color:#64748b;">In Storage</span>'}</td><td>${checkoutTime}</td></tr>`;
    }).join('');
};

const renderAllFaults = (faults, users) => {
    const tbody = document.getElementById('all-faults-table-body');
    if (!tbody) return;

    let processed = faults.filter(f => faultsState.filter === 'all' || f.status.toLowerCase() === faultsState.filter);
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

    tbody.innerHTML = processed.map(f => {
        let badgeClass = f.status === 'Resolved' ? 'badge-available' : f.status === 'In-Review' ? 'badge-review' : f.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';
        let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
        let reportedTime = f.timestamp ? new Date(f.timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';
        return `<tr><td>F-${f.id}</td><td>${f.title}</td><td>${f.location}</td><td><span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td><td><span class="badge ${badgeClass}">${f.status.toUpperCase()}</span></td><td>${getUserName(users, f.reported_by_id)}</td><td>${getUserName(users, f.assigned_to_id)}</td><td>${reportedTime}</td><td><button class="btn-solid btn-view-report" data-id="${f.id}" style="padding: 4px 8px; font-size: 0.75rem; background: #1d4ed8; color: #ffffff;">View Report</button></td></tr>`;
    }).join('');
};


const renderReviewQueue = (faults, users) => {
    const tbody = document.getElementById('review-faults-table-body');
    if (!tbody) return;

    let reviewFaults = faults.filter(f => f.status === 'In-Review');

    // Implemented Sorting Logic for Review Queue
    reviewFaults.sort((a, b) => {
        let valA, valB;
        switch(reviewState.sortCol) {
            case 'id': valA = a.id; valB = b.id; break;
            case 'title': valA = a.title; valB = b.title; break;
            case 'location': valA = a.location; valB = b.location; break;
            case 'reported': valA = getUserName(users, a.reported_by_id); valB = getUserName(users, b.reported_by_id); break;
            case 'time': valA = a.timestamp || ''; valB = b.timestamp || ''; break;
            case 'priority': valA = a.priority || 'Z'; valB = b.priority || 'Z'; break; // NEW: Added sorting for priority
            default: valA = a.id; valB = b.id;
        }
        if (valA < valB) return reviewState.sortAsc ? -1 : 1;
        if (valA > valB) return reviewState.sortAsc ? 1 : -1;
        return 0;
    });

    if (reviewFaults.length === 0) {
        // FIXED: Increased colspan to 9 to match the new column count
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 30px; color: #94a3b8;">No faults pending review. Great job! 🎉</td></tr>';
        return;
    }

    tbody.innerHTML = reviewFaults.map(f => {
        let reportedTime = f.timestamp ? new Date(f.timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '<span style="color:#64748b;">N/A</span>';
        
        // NEW: Grab the recommended priority and format it into a badge
        let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
        
        return `
            <tr>
                <td>F-${f.id}</td>
                <td>${f.title}</td>
                <td>${f.location}</td>
                <td>${getUserName(users, f.reported_by_id)}</td>
                <td>${reportedTime}</td>
                <!-- NEW: Inject the Recommended Priority Badge -->
                <td><span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                <td>
                    <select class="select-priority" style="width: 100%; height: 36px; box-sizing: border-box; padding: 6px; background: #0f172a; color: #f8fafc; border: 1px solid #64748b; border-radius: 4px;">
                        <option value="" disabled selected>-- Select --</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                </td>
                <td>
                    <button class="btn-outline btn-open-tech-modal" data-tech-id="" style="width: 100%; height: 36px; box-sizing: border-box; padding: 6px; background: #0f172a; color: #e2e8f0; border: 1px solid #64748b; border-radius: 4px; text-align: left; display: flex; justify-content: space-between; align-items: center;">
                        <span class="tech-name-display">-- Unassigned --</span>
                        <span>🔍</span>
                    </button>
                </td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn-solid btn-view-modal" data-id="${f.id}" style="padding: 6px 10px; background: #1d4ed8; color: #ffffff; min-width: auto;" title="View Full Report">👁️</button>
                        <button class="btn-solid btn-approve-fault" data-id="${f.id}" style="padding: 6px 10px; background: #15803d; color: #ffffff; min-width: auto;" title="Quick Approve">✓</button>
                        <button class="btn-solid btn-reject-fault" data-id="${f.id}" style="padding: 6px 10px; background: #b91c1c; color: #ffffff; min-width: auto;" title="Quick Reject">✕</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
};


const renderAssignTechView = (faults, users) => {
    const container = document.getElementById('tech-cards-container');
    if (!container) return;

    const technicians = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
    container.innerHTML = '';

    technicians.forEach(tech => {
        const techFaults = faults.filter(f => f.assigned_to_id === tech.id && ['Active', 'In-Progress'].includes(f.status));
        let workloadBadge = techFaults.length > 3 ? 'badge-high' : techFaults.length > 0 ? 'badge-assigned' : 'badge-available';
        
        let faultsHtml = techFaults.length === 0 
            ? `<div style="color: #64748b; text-align: center; padding: 10px 0;">No active faults assigned.</div>`
            : techFaults.map(f => {
                let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
                return `
                    <div class="mini-fault-item">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <strong style="color: #ffffff;">F-${f.id}: ${f.title}</strong>
                                <div style="color: #cbd5e1; font-size: 0.8rem; margin-top: 4px;">${f.location}</div>
                            </div>
                            <span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span>
                        </div>
                        <button class="btn-solid btn-instant-reassign" data-fault-id="${f.id}" data-current-tech-id="${tech.id}" style="margin-top: 8px; padding: 6px; font-size: 0.8rem; background: #1d4ed8; color: #ffffff; border: none; border-radius: 4px; width: 100%; cursor: pointer;">
                            🔄 Reassign to...
                        </button>
                    </div>`;
            }).join('');

        container.innerHTML += `
            <div class="tech-card">
                <div class="tech-card-header">
                    <div>
                        <strong style="color: #ffffff; font-size: 1.1rem;">${tech.first_name} ${tech.last_name}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <span class="badge ${workloadBadge}">${techFaults.length} Jobs</span>
                        <span class="expand-icon" style="color: #94a3b8; font-size: 1.2rem; transition: transform 0.2s;">▼</span>
                    </div>
                </div>
                <div class="tech-card-body">
                    <button class="btn-outline btn-assign-new-job" data-tech-id="${tech.id}" style="width: 100%; margin-bottom: 15px; padding: 8px; border: 1px dashed #64748b; color: #e2e8f0; background: transparent; cursor: pointer; border-radius: 4px;">
                        ➕ Assign Fault
                    </button>
                    ${faultsHtml}
                </div>
            </div>`;
    });
};


// ============================================================================
// TECHNICIAN CONTROLLER & RENDERERS
// ============================================================================

const setupTechnicianViews = (myFaults, allTools, normalizedRole, userId) => {
    
    // 1. Render My Faults
    const renderMyFaults = () => {
        const tbody = document.getElementById('tech-faults-tbody');
        if (!tbody) return;
        
        if (myFaults.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No faults currently assigned. Great job! 🎉</td></tr>';
            return;
        }

        tbody.innerHTML = myFaults.map(f => {
            let badgeClass = f.status === 'Resolved' ? 'badge-available' : f.status === 'In-Review' ? 'badge-review' : f.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';
            let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
            
            let actionBtn = f.assigned_to_id === userId && f.status === 'In-Progress' 
                ? `<button class="btn-solid btn-resolve-fault" data-id="${f.id}" style="padding: 4px 12px; background: #15803d; color: #ffffff; width: auto; font-size: 0.8rem; border-radius: 4px;">Mark Resolved</button>`
                : `<span style="color: #64748b; font-size: 0.85rem;">Pending Review</span>`;

            return `<tr>
                <td>F-${f.id}</td>
                <td>${f.title}</td>
                <td>${f.location}</td>
                <td><span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                <td><span class="badge ${badgeClass}">${f.status.toUpperCase()}</span></td>
                <td>${actionBtn}</td>
            </tr>`;
        }).join('');
    };

    // 2. Render My Checked-Out Tools
    const renderMyTools = () => {
        const tbody = document.getElementById('tech-tools-tbody');
        if (!tbody) return;
        
        const myTools = allTools.filter(t => t.current_user_id === userId);
        
        if (myTools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 20px;">No tools currently checked out.</td></tr>';
            return;
        }

        tbody.innerHTML = myTools.map(t => {
            let checkoutTime = t.checkout_timestamp ? new Date(t.checkout_timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : 'N/A';
            return `<tr>
                <td>${t.id}</td>
                <td>${t.tool_type}</td>
                <td>${checkoutTime}</td>
                <!-- FIXED: Removed the web button, enforcing AR functionality -->
                <td><span style="color: #94a3b8; font-size: 0.85rem; font-style: italic;">Return via AR Scanner 📷</span></td>
            </tr>`;
        }).join('');
    };

    // 3. Render Available Tools
    const renderAvailableTools = () => {
        const tbody = document.getElementById('avail-tools-tbody');
        if (!tbody) {
            console.error("Missing avail-tools-tbody in HTML!");
            return;
        }

        // FIXED: Bulletproof filter checks if it is explicitly 'available' OR has no assigned user
        const availTools = allTools.filter(t => !t.current_user_id || (t.status && t.status.trim().toLowerCase() === 'available'));

        if (availTools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 20px;">No tools currently available.</td></tr>';
            return;
        }

        tbody.innerHTML = availTools.map(t => {
            return `<tr>
                <td>${t.id}</td>
                <td>${t.tool_type}</td>
                <td><span class="badge badge-available">AVAILABLE</span></td>
                <!-- FIXED: Removed the web button, enforcing AR functionality -->
                <td><span style="color: #94a3b8; font-size: 0.85rem; font-style: italic;">Checkout via AR Scanner 📷</span></td>
            </tr>`;
        }).join('');
    };

    // --- EVENT DELEGATION FOR TECHNICIANS ---
    
    // Resolve Fault Action
    const faultTbody = document.getElementById('tech-faults-tbody');
    if (faultTbody) {
        faultTbody.onclick = async (e) => {
            if (e.target.classList.contains('btn-resolve-fault')) {
                const faultId = parseInt(e.target.getAttribute('data-id'));
                e.target.textContent = "⏳";
                e.target.disabled = true;

                try {
                    await updateFault(faultId, { status: 'In-Review', resolved_by_id: userId });
                    loadDashboardData(normalizedRole, userId);
                } catch (error) {
                    alert("Failed to update fault: " + error.message);
                    e.target.textContent = "Mark Resolved";
                    e.target.disabled = false;
                }
            }
        };
    }

    // --- KPI DRILLDOWN NAVIGATION (TECHNICIAN) ---
    // Make the technician's KPI cards clickable shortcuts to their respective views!
    const navigateToView = (viewId, navText) => {
        showView(viewId);
        document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
            if (btn.textContent === navText) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    const kpiActive = document.querySelector('.card-active');
    if (kpiActive) {
        kpiActive.classList.add('clickable-kpi');
        kpiActive.onclick = () => navigateToView('assigned-faults-view', 'MY FAULTS');
    }

    const kpiProgress = document.querySelector('.card-progress');
    if (kpiProgress) {
        kpiProgress.classList.add('clickable-kpi');
        kpiProgress.onclick = () => navigateToView('assigned-faults-view', 'MY FAULTS');
    }

    const kpiToolsOut = document.querySelector('.card-tools-out');
    if (kpiToolsOut) {
        kpiToolsOut.classList.add('clickable-kpi');
        kpiToolsOut.onclick = () => navigateToView('active-tools-view', 'MY TOOLS');
    }

    const kpiToolsAvail = document.querySelector('.card-tools-avail');
    if (kpiToolsAvail) {
        kpiToolsAvail.classList.add('clickable-kpi');
        kpiToolsAvail.onclick = () => navigateToView('available-tools-view', 'AVAILABLE TOOLS');
    }

    // Initialize Views
    renderMyFaults();
    renderMyTools();
    renderAvailableTools();
};



// ============================================================================
// MODALS & POPUPS
// ============================================================================

const openFaultModal = (faultId, faults, users, normalizedRole, userId) => {
    const fault = faults.find(f => f.id === faultId);
    if (!fault) return;

    document.getElementById('report-id').textContent = `F-${fault.id}`;
    
    let priorityClass = fault.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
    let badgeClass = fault.status === 'Resolved' ? 'badge-available' : fault.status === 'In-Review' ? 'badge-review' : fault.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';

    // Dynamic label based on fault status
    let priorityLabel = fault.status === 'In-Review' ? 'Rec. Priority:' : 'Priority:';

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
                        <select id="modal-select-priority" style="width: 100%; height: 40px; box-sizing: border-box; padding: 8px; background: #1e293b; color: #f8fafc; border: 1px solid #64748b; border-radius: 4px; margin-top: 5px;">
                            <option value="" disabled selected>-- Select Priority --</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                        </select>
                    </div>
                    <div>
                        <strong style="color:#ffffff; font-size: 0.9rem;">Assign Tech:</strong>
                        <button id="modal-btn-open-tech" class="btn-outline btn-open-tech-modal" data-tech-id="" style="width: 100%; height: 40px; box-sizing: border-box; padding: 8px; background: #1e293b; color: #e2e8f0; border: 1px solid #64748b; border-radius: 4px; margin-top: 5px; text-align: left; display: flex; justify-content: space-between; align-items: center;">
                            <span class="tech-name-display">-- Unassigned --</span>
                            <span>🔍</span>
                        </button>
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong style="color:#ffffff; font-size: 0.9rem;">Add Note (Required for rejection):</strong>
                    <textarea id="modal-input-notes" rows="3" placeholder="Enter instructions or rejection reasons here..." style="width: 100%; padding: 8px; background: #1e293b; color: #f8fafc; border: 1px solid #64748b; border-radius: 4px; margin-top: 5px; font-family: inherit; resize: vertical; box-sizing: border-box;"></textarea>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="modal-btn-reject" class="btn-solid" data-id="${fault.id}" style="background: #b91c1c; color: #ffffff; width: auto; padding: 8px 20px;">Reject ✕</button>
                    <button id="modal-btn-approve" class="btn-solid" data-id="${fault.id}" style="background: #15803d; color: #ffffff; width: auto; padding: 8px 20px;">Approve ✓</button>
                </div>
            </div>
        `;
    }

    document.getElementById('report-content').innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px; color: #f8fafc;">
            <div><strong style="color:#ffffff;">Title:</strong> <br>${fault.title}</div>
            <div><strong style="color:#ffffff;">Location:</strong> <br>${fault.location}</div>
            <div><strong style="color:#ffffff;">Status:</strong> <br><span class="badge ${badgeClass}" style="margin-top:4px; display:inline-block;">${fault.status.toUpperCase()}</span></div>
            <div><strong style="color:#ffffff;">${priorityLabel}</strong> <br><span class="badge ${priorityClass}" style="margin-top:4px; display:inline-block;">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></div>
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
    
    const reportModal = document.getElementById('fault-report-modal');
    
    const btnApprove = document.getElementById('modal-btn-approve');
    if (btnApprove) {
        btnApprove.onclick = async () => {
            const priorityVal = document.getElementById('modal-select-priority').value;
            const techIdVal = document.getElementById('modal-btn-open-tech').getAttribute('data-tech-id');
            const notesVal = document.getElementById('modal-input-notes').value;

            if (!priorityVal) return alert("Please select a Priority level before approving this fault.");

            btnApprove.textContent = "⏳";
            btnApprove.disabled = true;

            try {
                const payload = {
                    status: techIdVal ? 'In-Progress' : 'Active',
                    priority: priorityVal,
                    assigned_to_id: techIdVal ? parseInt(techIdVal) : null,
                    resolved_by_id: null,
                    notes: notesVal || null
                };
                await updateFault(fault.id, payload);
                reportModal.classList.add('hidden');
                loadDashboardData(normalizedRole, userId);
            } catch (error) {
                alert("Failed to approve: " + error.message);
                btnApprove.textContent = "Approve ✓";
                btnApprove.disabled = false;
            }
        };
    }

    const btnReject = document.getElementById('modal-btn-reject');
    if (btnReject) {
        btnReject.onclick = async () => {
            const notesVal = document.getElementById('modal-input-notes').value;
            if (!notesVal.trim()) return alert("Please provide a reason in the Notes section before rejecting.");

            btnReject.textContent = "⏳";
            btnReject.disabled = true;

            try {
                const payload = {
                    status: 'Resolved',
                    priority: 'Low',
                    assigned_to_id: null,
                    resolved_by_id: null,
                    notes: `[REJECTED]: ${notesVal}`
                };
                await updateFault(fault.id, payload);
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


// ============================================================================
// EVENT DELEGATION
// ============================================================================

const setupSupervisorEvents = (faults, tools, users, normalizedRole, userId) => {
    
    // --- FILTERS & SEARCH ---
    const searchTools = document.getElementById('search-tools');
    if (searchTools) searchTools.oninput = (e) => { toolsState.search = e.target.value; renderAllTools(tools, users); };
    const filterTools = document.getElementById('filter-tools');
    if (filterTools) filterTools.onchange = (e) => { toolsState.filter = e.target.value; renderAllTools(tools, users); };

    const searchFaults = document.getElementById('search-faults');
    if (searchFaults) searchFaults.oninput = (e) => { faultsState.search = e.target.value; renderAllFaults(faults, users); };
    const filterFaults = document.getElementById('filter-faults');
    if (filterFaults) filterFaults.onchange = (e) => { faultsState.filter = e.target.value; renderAllFaults(faults, users); };

    // --- SORTING ---
    document.querySelectorAll('#all-tools-view th[data-sort]').forEach(th => {
        th.onclick = () => { toolsState.sortAsc = (toolsState.sortCol === th.dataset.sort) ? !toolsState.sortAsc : true; toolsState.sortCol = th.dataset.sort; renderAllTools(tools, users); };
    });
    document.querySelectorAll('#all-faults-view th[data-sort]').forEach(th => {
        th.onclick = () => { faultsState.sortAsc = (faultsState.sortCol === th.dataset.sort) ? !faultsState.sortAsc : true; faultsState.sortCol = th.dataset.sort; renderAllFaults(faults, users); };
    });
    document.querySelectorAll('#review-faults-view th[data-sort]').forEach(th => {
        th.onclick = () => { reviewState.sortAsc = (reviewState.sortCol === th.dataset.sort) ? !reviewState.sortAsc : true; reviewState.sortCol = th.dataset.sort; renderReviewQueue(faults, users); };
    });

    // --- WORKLOAD BALANCING ACCORDION & MODALS ---
    const techCardsContainer = document.getElementById('tech-cards-container');
    if (techCardsContainer) {
        techCardsContainer.onclick = (e) => {
            const header = e.target.closest('.tech-card-header');
            if (header) {
                const card = header.closest('.tech-card');
                const icon = header.querySelector('.expand-icon');
                card.classList.toggle('expanded');
                icon.style.transform = card.classList.contains('expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
                return;
            }

            const reassignBtn = e.target.closest('.btn-instant-reassign');
            if (reassignBtn) {
                activeTechAssignBtn = reassignBtn; 
                const currentTechId = parseInt(reassignBtn.getAttribute('data-current-tech-id'));
                const techModal = document.getElementById('tech-select-modal');
                const techTbody = document.getElementById('tech-modal-table-body');
                const technicians = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
                
                techTbody.innerHTML = '';
                technicians.forEach(t => {
                    if (t.id === currentTechId) return;
                    const activeJobs = faults.filter(f => f.assigned_to_id === t.id && ['Active', 'In-Progress'].includes(f.status)).length;
                    let workloadBadge = activeJobs > 3 ? 'badge-high' : activeJobs > 0 ? 'badge-assigned' : 'badge-available';
                    techTbody.innerHTML += `<tr><td style="color: white; font-weight: bold;">${t.first_name} ${t.last_name}</td><td><span class="badge ${workloadBadge}">${activeJobs} Jobs</span></td><td><button class="btn-solid btn-choose-tech" data-tech-id="${t.id}" data-tech-name="${t.first_name} ${t.last_name}" style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto; border: none; border-radius: 4px; cursor: pointer;">Select</button></td></tr>`;
                });
                techModal.classList.remove('hidden');
            }

            const assignNewJobBtn = e.target.closest('.btn-assign-new-job');
            if (assignNewJobBtn) {
                const techId = parseInt(assignNewJobBtn.getAttribute('data-tech-id'));
                const jobModal = document.getElementById('job-select-modal');
                const jobTbody = document.getElementById('job-modal-table-body');
                const unassignedFaults = faults.filter(f => f.status === 'Active' && !f.assigned_to_id);
                
                jobTbody.innerHTML = '';
                if (unassignedFaults.length === 0) {
                    jobTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 30px;">No unassigned Active jobs available! 🎉</td></tr>';
                } else {
                    unassignedFaults.forEach(f => {
                        let priorityClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
                        jobTbody.innerHTML += `<tr><td style="color: white; font-weight: bold;">F-${f.id}: ${f.title}</td><td style="color: #cbd5e1;">${f.location}</td><td><span class="badge ${priorityClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td><td><button class="btn-solid btn-confirm-assign-job" data-fault-id="${f.id}" data-tech-id="${techId}" style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto; border-radius: 4px; border: none; cursor: pointer;">Give Job</button></td></tr>`;
                    });
                }
                jobModal.classList.remove('hidden');
            }
        };
    }

    // --- TECHNICIAN SELECT MODAL ---
    const techTbody = document.getElementById('tech-modal-table-body');
    const techModal = document.getElementById('tech-select-modal');
    if (techTbody) {
        techTbody.onclick = async (e) => {
            if (e.target.classList.contains('btn-choose-tech')) {
                const techId = e.target.getAttribute('data-tech-id');
                const techName = e.target.getAttribute('data-tech-name');

                if (activeTechAssignBtn) {
                    if (activeTechAssignBtn.classList.contains('btn-instant-reassign')) {
                        const faultId = parseInt(activeTechAssignBtn.getAttribute('data-fault-id'));
                        const faultToUpdate = faults.find(f => f.id === faultId);
                        e.target.textContent = "⏳";
                        e.target.disabled = true;

                        try {
                            await updateFault(faultId, { status: 'In-Progress', priority: faultToUpdate.priority || 'Medium', assigned_to_id: parseInt(techId), resolved_by_id: null, notes: faultToUpdate.notes || null });
                            techModal.classList.add('hidden');
                            loadDashboardData(normalizedRole, userId);
                            return; 
                        } catch (error) {
                            alert("Failed to reassign: " + error.message);
                            e.target.textContent = "Select";
                            e.target.disabled = false;
                            return;
                        }
                    }

                    activeTechAssignBtn.setAttribute('data-tech-id', techId);
                    activeTechAssignBtn.querySelector('.tech-name-display').textContent = techName;
                    activeTechAssignBtn.querySelector('.tech-name-display').style.color = '#ffffff';
                    activeTechAssignBtn.style.borderColor = '#3b82f6'; 
                }
                techModal.classList.add('hidden');
            }
        };
    }

    // --- JOB SELECT MODAL ---
    const jobTbody = document.getElementById('job-modal-table-body');
    const jobModal = document.getElementById('job-select-modal');
    if (jobTbody) {
        jobTbody.onclick = async (e) => {
            const confirmJobBtn = e.target.closest('.btn-confirm-assign-job');
            if (confirmJobBtn) {
                const faultId = parseInt(confirmJobBtn.getAttribute('data-fault-id'));
                const techId = parseInt(confirmJobBtn.getAttribute('data-tech-id'));
                const faultToUpdate = faults.find(f => f.id === faultId);
                
                confirmJobBtn.textContent = "⏳";
                confirmJobBtn.disabled = true;
                
                try {
                    await updateFault(faultId, { status: 'In-Progress', priority: faultToUpdate.priority || 'Medium', assigned_to_id: techId, resolved_by_id: null, notes: faultToUpdate.notes || null });
                    jobModal.classList.add('hidden');
                    loadDashboardData(normalizedRole, userId);
                } catch (error) {
                    alert("Failed to assign job: " + error.message);
                    confirmJobBtn.textContent = "Give Job";
                    confirmJobBtn.disabled = false;
                }
            }
        };
    }

    // --- CLOSING MODALS (General Logic) ---
    document.addEventListener('click', (e) => {
        const openBtn = e.target.closest('.btn-open-tech-modal');
        if (openBtn) {
            activeTechAssignBtn = openBtn;
            const technicians = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
            techTbody.innerHTML = '';
            technicians.forEach(t => {
                const activeJobs = faults.filter(f => f.assigned_to_id === t.id && ['Active', 'In-Progress'].includes(f.status)).length;
                let workloadBadge = activeJobs > 3 ? 'badge-high' : activeJobs > 0 ? 'badge-assigned' : 'badge-available';
                techTbody.innerHTML += `<tr><td style="color: white; font-weight: bold;">${t.first_name} ${t.last_name}</td><td><span class="badge ${workloadBadge}">${activeJobs} Jobs</span></td><td><button class="btn-solid btn-choose-tech" data-tech-id="${t.id}" data-tech-name="${t.first_name} ${t.last_name}" style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto;">Select</button></td></tr>`;
            });
            techModal.classList.remove('hidden');
        }
    });

    const clearTechBtn = document.getElementById('btn-clear-tech');
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

    const closeTechBtn = document.getElementById('close-tech-modal');
    if (closeTechBtn && techModal) {
        closeTechBtn.onclick = () => techModal.classList.add('hidden');
        techModal.onclick = (e) => { if (e.target === techModal) techModal.classList.add('hidden'); };
    }

    const closeJobModalBtn = document.getElementById('close-job-modal');
    if (closeJobModalBtn && jobModal) {
        closeJobModalBtn.onclick = () => jobModal.classList.add('hidden');
        jobModal.onclick = (e) => { if (e.target === jobModal) jobModal.classList.add('hidden'); };
    }

    const reportModal = document.getElementById('fault-report-modal');
    const closeReportBtn = document.getElementById('close-report-modal');
    if (closeReportBtn && reportModal) {
        closeReportBtn.onclick = () => reportModal.classList.add('hidden');
        reportModal.onclick = (e) => { if (e.target === reportModal) reportModal.classList.add('hidden'); };
    }

    // --- TABLE INLINE ACTIONS ---
    const reviewTbody = document.getElementById('review-faults-table-body');
    if (reviewTbody) {
        reviewTbody.onclick = async (e) => {
            if (e.target.classList.contains('btn-view-modal')) return openFaultModal(parseInt(e.target.getAttribute('data-id')), faults, users, normalizedRole, userId);

            if (e.target.classList.contains('btn-approve-fault')) {
                const btn = e.target;
                const faultId = parseInt(btn.getAttribute('data-id'));
                const row = btn.closest('tr');
                const priorityVal = row.querySelector('.select-priority').value;
                const techIdVal = row.querySelector('.btn-open-tech-modal').getAttribute('data-tech-id');

                if (!priorityVal) return alert("Please select a Priority level before approving this fault.");
                btn.textContent = "⏳";
                btn.disabled = true;

                try {
                    await updateFault(faultId, { status: techIdVal ? 'In-Progress' : 'Active', priority: priorityVal, assigned_to_id: techIdVal ? parseInt(techIdVal) : null, resolved_by_id: null, notes: null });
                    loadDashboardData(normalizedRole, userId);
                } catch (error) {
                    alert("Failed to approve: " + error.message);
                    btn.textContent = "✓";
                    btn.disabled = false;
                }
            }

            if (e.target.classList.contains('btn-reject-fault')) {
                const btn = e.target;
                const faultId = parseInt(btn.getAttribute('data-id'));
                const reason = prompt("Enter a reason for rejecting this fault (optional):");
                if (reason === null) return; 

                btn.textContent = "⏳";
                btn.disabled = true;

                try {
                    await updateFault(faultId, { status: 'Resolved', priority: 'Low', assigned_to_id: null, resolved_by_id: null, notes: reason ? `[REJECTED]: ${reason}` : `[REJECTED]: No reason provided by supervisor.` });
                    loadDashboardData(normalizedRole, userId);
                } catch (error) {
                    alert("Failed to reject: " + error.message);
                    btn.textContent = "✕";
                    btn.disabled = false;
                }
            }
        };
    }

    const faultsTbody = document.getElementById('all-faults-table-body');
    if (faultsTbody) {
        faultsTbody.onclick = (e) => {
            if (e.target.classList.contains('btn-view-report')) openFaultModal(parseInt(e.target.getAttribute('data-id')), faults, users, normalizedRole, userId);
        };
    }

    // --- KPI DRILLDOWN NAVIGATION ---
    const navigateToView = (viewId, navText) => {
        showView(viewId);
        document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
            if (btn.textContent === navText) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    const applyKpiFilter = (filterElementId, value, stateObject, renderer) => {
        const filter = document.getElementById(filterElementId);
        if (filter) filter.value = value;
        stateObject.filter = value;
        renderer();
    };

    const kpiActive = document.querySelector('.card-active');
    if (kpiActive) {
        kpiActive.classList.add('clickable-kpi'); // FIXED: Added sleek CSS class
        kpiActive.onclick = () => { applyKpiFilter('filter-faults', 'active', faultsState, () => renderAllFaults(faults, users)); navigateToView('all-faults-view', 'ALL FAULTS'); };
    }

    const kpiReview = document.querySelector('.card-review');
    if (kpiReview) {
        kpiReview.classList.add('clickable-kpi'); // FIXED: Added sleek CSS class
        kpiReview.onclick = () => navigateToView('review-faults-view', 'FAULTS TO REVIEW');
    }

    const kpiProgress = document.querySelector('.card-progress');
    if (kpiProgress) {
        kpiProgress.classList.add('clickable-kpi'); // FIXED: Added sleek CSS class
        kpiProgress.onclick = () => { applyKpiFilter('filter-faults', 'in-progress', faultsState, () => renderAllFaults(faults, users)); navigateToView('all-faults-view', 'ALL FAULTS'); };
    }

    const kpiToolsOut = document.querySelector('.card-tools-out');
    if (kpiToolsOut) {
        kpiToolsOut.classList.add('clickable-kpi'); // FIXED: Added sleek CSS class
        kpiToolsOut.onclick = () => { applyKpiFilter('filter-tools', 'checked-out', toolsState, () => renderAllTools(tools, users)); navigateToView('all-tools-view', 'ALL TOOLS'); };
    }

    const kpiToolsAvail = document.querySelector('.card-tools-avail');
    if (kpiToolsAvail) {
        kpiToolsAvail.classList.add('clickable-kpi'); // FIXED: Added sleek CSS class
        kpiToolsAvail.onclick = () => { applyKpiFilter('filter-tools', 'available', toolsState, () => renderAllTools(tools, users)); navigateToView('all-tools-view', 'ALL TOOLS'); };
    }
};


// ============================================================================
// UTILITY HELPERS
// ============================================================================

const getUserName = (users, id) => {
    if (!id) return '<span style="color:#64748b;">Unassigned</span>';
    const u = users.find(user => user.id === id);
    return u ? `${u.first_name} ${u.last_name}` : `User ${id}`;
};