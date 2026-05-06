import { login, logout, getFaults, getTools, getUsers, updateFault } from './api.js';


// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================

// Sorting state for the two dashboard tables (faults and tools)
let dashboardFaultsSortState = { sortCol: 'id', sortAsc: true };
let dashboardToolsSortState = { sortCol: 'id', sortAsc: true };

// Full sort, filter, and search state for the supervisor's detailed views
let allToolsSortState = { sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
let allFaultsSortState = { sortCol: 'id', sortAsc: true, filter: 'all', search: '' };
let reviewQueueState = { sortCol: 'time', sortAsc: false };

// Tracks which "Assign Technician" button was most recently clicked,
// so the technician selection modal knows which row to update
let activeAssignTechButton = null;


// ============================================================================
// VIEW NAVIGATION & AUTHENTICATION
// ============================================================================

/**
 * Switches the visible view by hiding all others and fading in the target.
 * Works for both top-level views (login / dashboard) and sub-views.
 */
export function showView(viewId) {
    const targetView = document.getElementById(viewId);
    if (!targetView) return console.error(`View with ID '${viewId}' not found!`);

    // Decide whether we're swapping a top-level view or a sub-view
    const isTopLevelView = (viewId === 'login-view' || viewId === 'dashboard-view');
    const allViews = document.querySelectorAll(isTopLevelView ? '.view-container' : '.sub-view');

    // Fade everything out first, then swap visibility after a short delay
    allViews.forEach(view => view.style.opacity = 0);

    setTimeout(() => {
        allViews.forEach(view => view.classList.add('hidden'));
        targetView.classList.remove('hidden');

        // When navigating to the dashboard, also show the default sub-view (the columns view)
        if (viewId === 'dashboard-view') {
            document.querySelectorAll('.sub-view').forEach(subView => subView.classList.add('hidden'));

            const defaultSubView = document.getElementById('dashboard-columns-view');
            if (defaultSubView) {
                defaultSubView.classList.remove('hidden');
                defaultSubView.style.opacity = 1;
            }
        }

        // Fade the target view back in
        requestAnimationFrame(() => targetView.style.opacity = 1);
    }, 200);
}

/**
 * Builds the sidebar navigation dynamically based on the logged-in user's role.
 * Supervisors and admins get a different menu to technicians.
 */
export function renderSidebar(role) {
    const sidebarElement = document.querySelector('.sidebar');
    const spacerElement  = sidebarElement.querySelector('.sidebar-spacer');

    // Remove any previously rendered nav items before rebuilding
    sidebarElement.querySelectorAll('.nav-item').forEach(item => item.remove());

    const normalisedRole = role ? role.toLowerCase() : '';
    const isSupervisor   = ['supervisor', 'admin', 'administrator'].includes(normalisedRole);

    // Update the header title to reflect the user's role
    const headerTitleElement = document.getElementById('header-role-title');
    if (headerTitleElement) {
        headerTitleElement.textContent = isSupervisor
            ? 'Supervisor Dashboard'
            : 'Technician Dashboard';
    }

    // The AR launch button is only relevant for technicians — hide it for supervisors
    const arLaunchButton = document.getElementById('btn-launch-ar');
    if (arLaunchButton) {
        arLaunchButton.style.display = isSupervisor ? 'none' : 'flex';
    }

    // Menu items for a standard technician
    const technicianMenuItems = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'MY FAULTS', view: 'assigned-faults-view' },
        { text: 'MY TOOLS', view: 'active-tools-view' },
        { text: 'AVAILABLE TOOLS', view: 'available-tools-view' }
    ];

    // Menu items for a supervisor or administrator
    const supervisorMenuItems = [
        { text: 'DASHBOARD', view: 'dashboard-columns-view' },
        { text: 'ALL FAULTS', view: 'all-faults-view' },
        { text: 'ALL TOOLS', view: 'all-tools-view' },
        { text: 'FAULTS TO REVIEW', view: 'review-faults-view' },
        { text: 'ASSIGN TECHNICIANS', view: 'assign-tech-view' }
    ];

    const menuItems = isSupervisor ? supervisorMenuItems : technicianMenuItems;

    menuItems.forEach((item, index) => {
        const navButton = document.createElement('button');
        navButton.className = `nav-item ${index === 0 ? 'active' : ''}`;
        navButton.textContent = item.text;

        navButton.onclick = () => {
            // Deactivate all nav buttons, then mark this one as active
            sidebarElement.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
            navButton.classList.add('active');
            showView(item.view);

            // Close the mobile sidebar after navigation
            sidebarElement.classList.remove('open');
        };

        sidebarElement.insertBefore(navButton, spacerElement);
    });
}

/**
 * Checks whether a valid session already exists when the page loads.
 * If local user data is present and the API responds, skip straight to the dashboard.
 */
export async function checkSessionOnLoad() {
    try {
        // A quick API call to confirm the session is still alive
        await getFaults();

        const storedUserData = localStorage.getItem('ar_user');
        if (storedUserData) {
            const currentUser = JSON.parse(storedUserData);
            renderSidebar(currentUser.role);
            showView('dashboard-view');
            loadDashboardData(currentUser.role, currentUser.id);
        } else {
            throw new Error("No local user data found");
        }
    } catch (error) {
        // A failed session check is expected — just show the login screen silently
        console.log("No active session. Please log in.");
    }
}

/**
 * Wires up all the global event listeners that are needed as soon as the page loads.
 * This includes the sidebar toggle, login form, logout logic, and the password toggle.
 */
export function setupEventListeners() {

    // --- SIDEBAR TOGGLE (mobile hamburger menu) ---
    const menuToggleButton = document.getElementById('btn-menu-toggle');
    const sidebarElement = document.querySelector('.sidebar');

    if (menuToggleButton && sidebarElement) {
        menuToggleButton.addEventListener('click', () => sidebarElement.classList.toggle('open'));
    }


    // --- AR CAMERA LAUNCH (CRASH PREVENTION) ---
    const arLaunchButton = document.getElementById('btn-launch-ar');
    
    if (arLaunchButton) {
        arLaunchButton.addEventListener('click', async (e) => {
            e.preventDefault();
            
            // Change button text to show it's loading
            const originalText = arLaunchButton.innerHTML;
            arLaunchButton.innerHTML = 'Loading Camera...';
            arLaunchButton.disabled = true;

            try {
                // Pre-warm the camera: Ask for permission on the lightweight dashboard
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                
                stream.getTracks().forEach(track => track.stop());
                
                // Wait 500ms before redirecting so the OS can safely power down the lens
                setTimeout(() => {
                    window.location.href = '/static/ar.html'; 
                }, 500);
                
            } catch (err) {
                alert("Camera access is required to use the AR Scanner.");
                arLaunchButton.innerHTML = originalText;
                arLaunchButton.disabled = false;
            }
        });
    }


    // --- LOGIN FORM ---
    const loginFormElement = document.getElementById('login-form');
    if (loginFormElement) {
        const loginErrorMessage = document.getElementById('login-error');
        const showPasswordToggle = document.getElementById('show-password');
        const submitButton = loginFormElement.querySelector('button');
        const usernameField = document.getElementById('username');
        const passwordField = document.getElementById('password');

        loginFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();
            submitButton.disabled = true;

            // Basic client-side validation before hitting the API
            if (passwordField.value.length < 8) {
                loginErrorMessage.textContent = "Password must be at least 8 characters.";
                submitButton.disabled = false;
                return;
            }

            try {
                loginErrorMessage.textContent = "Authenticating...";

                const loggedInUser = await login(usernameField.value, passwordField.value);
                localStorage.setItem('ar_user', JSON.stringify(loggedInUser));

                // Briefly show a success message before navigating to the dashboard
                loginErrorMessage.textContent = "Success! Redirecting...";
                loginErrorMessage.style.color = "#22c55e";

                setTimeout(() => {
                    renderSidebar(loggedInUser.role);
                    showView('dashboard-view');
                    loadDashboardData(loggedInUser.role, loggedInUser.id);

                    // Reset the form and restore default styles
                    loginErrorMessage.textContent = "";
                    loginFormElement.reset();
                    passwordField.type     = 'password';
                    loginErrorMessage.style.color = "#ff5555";
                    submitButton.disabled  = false;
                }, 400);

            } catch (error) {
                loginErrorMessage.textContent = error.message || "Invalid credentials.";
                submitButton.disabled = false;
            }
        });

        // Disable the submit button while the password is too short
        passwordField.addEventListener('input', () => {
            submitButton.disabled = passwordField.value.length < 8;
        });

        // Toggle plain-text password visibility
        showPasswordToggle.addEventListener('change', () => {
            passwordField.type = showPasswordToggle.checked ? 'text' : 'password';
        });
    }

    // --- FORGOT PASSWORD MODAL ---
    const forgotPasswordLink   = document.getElementById('login-forgot');
    const forgotPasswordModal  = document.getElementById('forgot-modal');
    const closeForgotModalBtn  = document.getElementById('close-modal');

    if (forgotPasswordLink && forgotPasswordModal && closeForgotModalBtn) {
        forgotPasswordLink.addEventListener('click', () => forgotPasswordModal.classList.remove('hidden'));
        closeForgotModalBtn.addEventListener('click', () => forgotPasswordModal.classList.add('hidden'));
        forgotPasswordModal.addEventListener('click', (e) => {
            if (e.target === forgotPasswordModal) forgotPasswordModal.classList.add('hidden');
        });
    }

    // --- LOGOUT LOGIC & WARNING MODAL ---
    const logoutButton = document.getElementById('btn-logout');
    const logoutWarningModal = document.getElementById('logout-warning-modal');
    const cancelLogoutButton = document.getElementById('btn-cancel-logout');
    const confirmLogoutButton = document.getElementById('btn-confirm-logout');

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                // Attempt a clean logout via the API
                await logout();
                localStorage.removeItem('ar_user');
                window.location.reload();
            } catch (error) {
                // If the API warns about tools that haven't been returned yet,
                // show our custom confirmation modal rather than a browser alert
                if (error.message.includes("WARNING_UNRETURNED_TOOLS")) {
                    if (logoutWarningModal) logoutWarningModal.classList.remove('hidden');
                } else {
                    alert("Logout failed: " + error.message);
                }
            }
        });
    }

    // User chose to stay logged in — just close the warning modal
    if (cancelLogoutButton && logoutWarningModal) {
        cancelLogoutButton.onclick = () => logoutWarningModal.classList.add('hidden');
    }

    // User confirmed they want to log out despite unreturned tools — force it through
    if (confirmLogoutButton) {
        confirmLogoutButton.onclick = async () => {
            try {
                await logout(true); // The 'true' flag bypasses the unreturned-tools check
                localStorage.removeItem('ar_user');
                window.location.reload();
            } catch (err) {
                alert("Force logout failed: " + err.message);
            }
        };
    }
}


// ============================================================================
// DASHBOARD INITIALISATION
// ============================================================================

/**
 * Fetches all data from the API and then populates the dashboard
 * with the appropriate KPI cards, tables, and sub-views for the current user.
 */
export async function loadDashboardData(role, userId) {
    try {
        const faults = await getFaults();
        const tools  = await getTools();
        const users  = await getUsers();

        // By default, show everything — then narrow it down for technicians below
        let visibleFaults = faults;
        let visibleTools  = tools;

        const normalisedRole    = role ? role.toLowerCase() : '';
        const toolsColumnHeader = document.querySelector('.column:nth-child(2) h3');

        if (normalisedRole === 'technician') {
            // Technicians only see faults assigned to them, or ones they reported that are pending review
            if (toolsColumnHeader) toolsColumnHeader.textContent = "MY CHECKED-OUT TOOLS";
            visibleFaults = faults.filter(f =>
                (f.assigned_to_id === userId) ||
                (f.reported_by_id === userId && f.status === 'In-Review')
            );
            visibleTools = tools.filter(t => t.current_user_id === userId);
        } else {
            if (toolsColumnHeader) toolsColumnHeader.textContent = "TOOL TRACKING LOG";
        }

        // Populate KPI cards and the main dashboard tables
        updateKpiCards(visibleFaults, visibleTools, tools);
        renderDashboardTables(visibleFaults, visibleTools, users);

        // Set up the appropriate role-specific sub-views
        if (['supervisor', 'admin', 'administrator'].includes(normalisedRole)) {
            setupSupervisorViews(faults, tools, users, normalisedRole, userId);
        } else if (normalisedRole === 'technician') {
            setupTechnicianViews(visibleFaults, tools, users, normalisedRole, userId);
        }

    } catch (error) {
        console.error("Failed to load dashboard data:", error);
    }
}

/**
 * Updates the KPI summary cards at the top of the dashboard
 * with live counts based on the current data.
 * `allToolsData` is optional — if provided, it's used for the available tools count
 * so that a technician's personal tool list doesn't skew the global figure.
 */
const updateKpiCards = (visibleFaults, visibleTools, allToolsData = null) => {
    const toolsDataSource = allToolsData || visibleTools;

    const setKpi = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setKpi('kpi-active', visibleFaults.filter(f => f.status === 'Active').length);
    setKpi('kpi-review', visibleFaults.filter(f => f.status === 'In-Review').length);
    setKpi('kpi-progress', visibleFaults.filter(f => f.status === 'In-Progress').length);
    setKpi('kpi-tools-out', visibleTools.filter(t => t.status === 'Checked-Out').length);

    // Available tools count uses the full tool list, not just the visible subset
    setKpi('kpi-tools-avail', toolsDataSource.filter(t => t.status === 'Available').length);
};

/**
 * Renders the two tables on the main dashboard — active faults and current tools.
 * Both tables support sorting via dashboardFaultsSortState and dashboardToolsSortState.
 */
const renderDashboardTables = (visibleFaults, visibleTools, users) => {

    // --- DASHBOARD FAULTS TABLE ---
    const faultsTableBody = document.getElementById('faults-table-body');
    if (faultsTableBody) {

        // Only show faults that haven't been resolved yet
        let activeFaults = visibleFaults.filter(f => f.status.trim().toLowerCase() !== 'resolved');

        activeFaults.sort((a, b) => {
            let valA, valB;
            switch (dashboardFaultsSortState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'title': valA = a.title; valB = b.title; break;
                case 'location': valA = a.location; valB = b.location; break;
                case 'priority': valA = a.priority || 'zzz'; valB = b.priority || 'zzz'; break;
                case 'status': valA = a.status; valB = b.status; break;
                default: valA = a.id; valB = b.id;
            }
            if (valA < valB) return dashboardFaultsSortState.sortAsc ? -1 : 1;
            if (valA > valB) return dashboardFaultsSortState.sortAsc ?  1 : -1;
            return 0;
        });

        faultsTableBody.innerHTML = activeFaults.map(fault => {
            const statusBadgeClass   = fault.status === 'In-Progress' ? 'badge-assigned': fault.status === 'In-Review'   ? 'badge-review': 'badge-active';
            const priorityBadgeClass = fault.priority?.toUpperCase() === 'HIGH'   ? 'badge-high': fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium': 'badge-low';

            return `
                <tr>
                    <!-- REMOVED ID COLUMN HERE -->
                    <td>${fault.title}</td>
                    <td>${fault.location}</td>
                    <td><span class="badge ${priorityBadgeClass}">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></td>
                    <td><span class="badge ${statusBadgeClass}">${fault.status.toUpperCase()}</span></td>
                </tr>`;
        }).join('');
    }

    // --- DASHBOARD TOOLS TABLE (Dynamic based on Role) ---
    const toolsTableBody = document.getElementById('tools-table-body');
    const toolsTableHead = toolsTableBody ? toolsTableBody.previousElementSibling : null; // Grabs the <thead>

    if (toolsTableBody && toolsTableHead) {
        // Determine role to dynamically shape the table
        const userData = JSON.parse(localStorage.getItem('ar_user'));
        const isSupervisor = ['supervisor', 'admin', 'administrator'].includes(userData?.role?.toLowerCase());

        let toolsArray = [...visibleTools];

        // Dynamically set the Table Headers based on role
        if (isSupervisor) {
            toolsTableHead.innerHTML = `
                <tr>
                    <th>TOOL ID</th>
                    <th>TYPE</th>
                    <th>LOCATION</th>
                    <th>STATUS</th>
                    <th>CURRENT USER</th>
                </tr>`;
        } else {
            // TECHNICIAN HEADERS: Only 3 columns
            toolsTableHead.innerHTML = `
                <tr>
                    <th>TYPE</th>
                    <th>CHECKOUT TIME</th>
                    <th>LOCATION</th>
                </tr>`;
        }

        toolsArray.sort((a, b) => {
            let valA, valB;
            switch (dashboardToolsSortState.sortCol) {
                case 'id': valA = a.id; valB = b.id; break;
                case 'type': valA = a.tool_type; valB = b.tool_type; break;
                case 'status': valA = a.status; valB = b.status; break;
                case 'user': valA = getUserFullName(users, a.current_user_id); valB = getUserFullName(users, b.current_user_id); break;
                default: valA = a.id; valB = b.id;
            }
            if (valA < valB) return dashboardToolsSortState.sortAsc ? -1 : 1;
            if (valA > valB) return dashboardToolsSortState.sortAsc ?  1 : -1;
            return 0;
        });

        // Render the Rows based on role
        toolsTableBody.innerHTML = toolsArray.map(tool => {
            if (isSupervisor) {
                // SUPERVISOR ROW (Full Data)
                const toolBadgeClass  = tool.status === 'Available' ? 'badge-available' : 'badge-out';
                const currentUserText = tool.current_user_id ? getUserFullName(users, tool.current_user_id) : 'In Storage';
                return `
                    <tr>
                        <td>${tool.id}</td>
                        <td>${tool.tool_type}</td>
                        <td>${tool.storage_location || '<span style="color:#64748b;">Not Assigned</span>'}</td>
                        <td><span class="badge ${toolBadgeClass}">${tool.status.toUpperCase()}</span></td>
                        <td>${currentUserText}</td>
                    </tr>`;
            } else {
                // TECHNICIAN ROW (Compact Data: Type, Time, Location)
                const checkoutTimeText = tool.checkout_timestamp ? new Date(tool.checkout_timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
                return `
                    <tr>
                        <td style="font-weight: bold;">${tool.tool_type}</td>
                        <td>${checkoutTimeText}</td>
                        <td style="font-size: 0.85rem; color: #cbd5e1;">${tool.storage_location || '<span style="color:#64748b;">Not Assigned</span>'}</td>
                    </tr>`;
            }
        }).join('');
    }
};




// ============================================================================
// SUPERVISOR CONTROLLER
// ============================================================================

/**
 * Kicks off everything needed for a supervisor session:
 * binds event listeners and renders all four supervisor views.
 */
const setupSupervisorViews = (faults, tools, users, normalisedRole, userId) => {
    setupSupervisorEvents(faults, tools, users, normalisedRole, userId);
    renderAllTools(tools, users);
    renderAllFaults(faults, users);
    renderReviewQueue(faults, users);
    renderAssignTechView(faults, users);
};


// ============================================================================
// SUPERVISOR RENDERERS
// ============================================================================

/**
 * Renders the full tools table in the supervisor's "All Tools" view.
 * Supports filtering by status, free-text search, and column sorting.
 */
const renderAllTools = (tools, users) => {
    const tableBody = document.getElementById('all-tools-table-body');
    if (!tableBody) return;

    // Apply status filter
    let filteredTools = tools.filter(t =>
        allToolsSortState.filter === 'all' || t.status.toLowerCase() === allToolsSortState.filter
    );

    // Apply search across ID, type, and current user name
    if (allToolsSortState.search) {
        const searchTerm = allToolsSortState.search.toLowerCase();
        filteredTools = filteredTools.filter(t =>
            String(t.id).includes(searchTerm) ||
            t.tool_type.toLowerCase().includes(searchTerm) ||
            getUserFullName(users, t.current_user_id).toLowerCase().includes(searchTerm)
        );
    }

    filteredTools.sort((a, b) => {
        let valA, valB;
        switch (allToolsSortState.sortCol) {
            case 'id': valA = a.id; valB = b.id; break;
            case 'type': valA = a.tool_type; valB = b.tool_type; break;
            case 'location': valA = a.storage_location || 'zzz'; valB = b.storage_location || 'zzz'; break;
            case 'status': valA = a.status; valB = b.status; break;
            case 'user': valA = getUserFullName(users, a.current_user_id); valB = getUserFullName(users, b.current_user_id); break;
            case 'time': valA = a.checkout_timestamp || ''; valB = b.checkout_timestamp || ''; break;
            default: valA = a.id; valB = b.id;
        }
        if (valA < valB) return allToolsSortState.sortAsc ? -1 : 1;
        if (valA > valB) return allToolsSortState.sortAsc ?  1 : -1;
        return 0;
    });

    tableBody.innerHTML = filteredTools.map(t => {
        const toolBadgeClass = t.status === 'Available' ? 'badge-available' : 'badge-out';
        const checkoutTimeText = t.checkout_timestamp
            ? new Date(t.checkout_timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '<span style="color:#64748b;">N/A</span>';
        return `
            <tr>
                <td>${t.id}</td>
                <td>${t.tool_type}</td>
                <td>${t.storage_location || '<span style="color:#64748b;">Not Assigned</span>'}</td>
                <td><span class="badge ${toolBadgeClass}">${t.status.toUpperCase()}</span></td>
                <td>${t.current_user_id ? getUserFullName(users, t.current_user_id) : '<span style="color:#64748b;">In Storage</span>'}</td>
                <td>${checkoutTimeText}</td>
            </tr>`;
    }).join('');
};

/**
 * Renders the full faults table in the supervisor's "All Faults" view.
 * Supports filtering by status, free-text search, and column sorting.
 */
const renderAllFaults = (faults, users) => {
    const tableBody = document.getElementById('all-faults-table-body');
    if (!tableBody) return;

    // Apply status filter
    let filteredFaults = faults.filter(f =>
        allFaultsSortState.filter === 'all' || f.status.toLowerCase() === allFaultsSortState.filter
    );

    // Apply search across fault ID, title, and location
    if (allFaultsSortState.search) {
        const searchTerm = allFaultsSortState.search.toLowerCase();
        filteredFaults = filteredFaults.filter(f =>
            String(f.id).includes(searchTerm) ||
            f.title.toLowerCase().includes(searchTerm) ||
            f.location.toLowerCase().includes(searchTerm)
        );
    }

    filteredFaults.sort((a, b) => {
        let valA, valB;
        switch (allFaultsSortState.sortCol) {
            case 'id': valA = a.id; valB = b.id; break;
            case 'title': valA = a.title; valB = b.title; break;
            case 'location': valA = a.location; valB = b.location; break;
            case 'priority': valA = a.priority || 'zzz'; valB = b.priority || 'zzz'; break;
            case 'status': valA = a.status; valB = b.status; break;
            case 'reported': valA = getUserFullName(users, a.reported_by_id); valB = getUserFullName(users, b.reported_by_id); break;
            case 'assigned': valA = getUserFullName(users, a.assigned_to_id); valB = getUserFullName(users, b.assigned_to_id); break;
            case 'time': valA = a.timestamp || ''; valB = b.timestamp || ''; break;
            default: valA = a.id; valB = b.id;
        }

        if (valA < valB) return allFaultsSortState.sortAsc ? -1 : 1;
        if (valA > valB) return allFaultsSortState.sortAsc ?  1 : -1;
        return 0;
    });

    tableBody.innerHTML = filteredFaults.map(f => {
        const statusBadgeClass   = f.status === 'Resolved' ? 'badge-available': f.status === 'In-Review' ? 'badge-review': f.status === 'In-Progress' ? 'badge-assigned': 'badge-active';
        const priorityBadgeClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high': f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium': 'badge-low';
        const reportedTimeText = f.timestamp ? new Date(f.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }): '<span style="color:#64748b;">N/A</span>';

        return `
            <tr>
                <td>F-${f.id}</td>
                <td>${f.title}</td>
                <td>${f.location}</td>
                <td><span class="badge ${priorityBadgeClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                <td><span class="badge ${statusBadgeClass}">${f.status.toUpperCase()}</span></td>
                <td>${getUserFullName(users, f.reported_by_id)}</td>
                <td>${getUserFullName(users, f.assigned_to_id)}</td>
                <td>${reportedTimeText}</td>
                <td>
                    <button
                        class="btn-solid btn-view-report"
                        data-id="${f.id}"
                        style="padding: 4px 8px; font-size: 0.75rem; background: #1d4ed8; color: #ffffff;"
                    >View Report</button>
                </td>
            </tr>`;
    }).join('');
};

/**
 * Renders the review queue — faults submitted by technicians that are
 * awaiting supervisor approval or rejection.
 */
const renderReviewQueue = (faults, users) => {
    const tableBody = document.getElementById('review-faults-table-body');
    if (!tableBody) return;

    let pendingReviewFaults = faults.filter(f => f.status === 'In-Review');

    pendingReviewFaults.sort((a, b) => {
        let valA, valB;
        switch (reviewQueueState.sortCol) {
            case 'id': valA = a.id; valB = b.id; break;
            case 'title': valA = a.title; valB = b.title; break;
            case 'location': valA = a.location; valB = b.location; break;
            case 'reported': valA = getUserFullName(users, a.reported_by_id); valB = getUserFullName(users, b.reported_by_id); break;
            case 'time': valA = a.timestamp || ''; valB = b.timestamp || ''; break;
            case 'priority': valA = a.priority || 'zzz'; valB = b.priority || 'zzz'; break;
            default: valA = a.id; valB = b.id;
        }

        if (valA < valB) return reviewQueueState.sortAsc ? -1 : 1;
        if (valA > valB) return reviewQueueState.sortAsc ?  1 : -1;
        return 0;
    });

    if (pendingReviewFaults.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 30px; color: #94a3b8;">No faults pending review. Great job! 🎉</td></tr>';
        return;
    }

    tableBody.innerHTML = pendingReviewFaults.map(f => {
        const reportedTimeText = f.timestamp ? new Date(f.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }): '<span style="color:#64748b;">N/A</span>';
        const priorityBadgeClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high': f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium': 'badge-low';

        return `
            <tr>
                <td>F-${f.id}</td>
                <td>${f.title}</td>
                <td>${f.location}</td>
                <td>${getUserFullName(users, f.reported_by_id)}</td>
                <td>${reportedTimeText}</td>
                <td><span class="badge ${priorityBadgeClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                <td>
                    <select class="select-priority" style="width: 100%; height: 36px; box-sizing: border-box; padding: 6px; background: #0f172a; color: #f8fafc; border: 1px solid #64748b; border-radius: 4px;">
                        <option value="" disabled selected>-- Select --</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                </td>
                <td>
                    <button
                        class="btn-outline btn-open-tech-modal"
                        data-tech-id=""
                        style="width: 100%; height: 36px; box-sizing: border-box; padding: 6px; background: #0f172a; color: #e2e8f0; border: 1px solid #64748b; border-radius: 4px; text-align: left; display: flex; justify-content: space-between; align-items: center;"
                    >
                        <span class="tech-name-display">-- Unassigned --</span>
                        <span>🔍</span>
                    </button>
                </td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn-solid btn-view-modal"    data-id="${f.id}" style="padding: 6px 10px; background: #1d4ed8; color: #ffffff; min-width: auto;" title="View Full Report">👁️</button>
                        <button class="btn-solid btn-approve-fault" data-id="${f.id}" style="padding: 6px 10px; background: #15803d; color: #ffffff; min-width: auto;" title="Quick Approve">✓</button>
                        <button class="btn-solid btn-reject-fault"  data-id="${f.id}" style="padding: 6px 10px; background: #b91c1c; color: #ffffff; min-width: auto;" title="Quick Reject">✕</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
};

/**
 * Renders the "Assign Technicians" view, which shows a card for each technician
 * with their current workload and a list of their active faults.
 */
const expandedTechIds = new Set();

const renderAssignTechView = (faults, users) => {
    const cardsContainer = document.getElementById('tech-cards-container');
    if (!cardsContainer) return;

    const technicianList = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
    cardsContainer.innerHTML = '';

    technicianList.forEach(tech => {
        // Find faults that are actively assigned to this technician
        const techActiveFaults = faults.filter(f =>
            f.assigned_to_id === tech.id && ['Active', 'In-Progress'].includes(f.status)
        );

        const workloadBadgeClass = techActiveFaults.length > 3 ? 'badge-high' : techActiveFaults.length > 0 ? 'badge-assigned' : 'badge-available';

        // Build the HTML for each fault item in the card, or a placeholder if none
        let faultItemsHtml = techActiveFaults.length === 0 ? `<div style="color: #64748b; text-align: center; padding: 10px 0;">No active faults assigned.</div>`: techActiveFaults.map(f => {
                const priorityBadgeClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high': f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
                return `
                    <div class="mini-fault-item">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <strong style="color: #ffffff;">F-${f.id}: ${f.title}</strong>
                                <div style="color: #cbd5e1; font-size: 0.8rem; margin-top: 4px;">${f.location}</div>
                            </div>
                            <span class="badge ${priorityBadgeClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span>
                        </div>
                        <button
                            class="btn-solid btn-instant-reassign"
                            data-fault-id="${f.id}"
                            data-current-tech-id="${tech.id}"
                            style="margin-top: 8px; padding: 6px; font-size: 0.8rem; background: #1d4ed8; color: #ffffff; border: none; border-radius: 4px; width: 100%; cursor: pointer;"
                        >🔄 Reassign to...</button>
                    </div>`;
            }).join('');

        const isExpanded = expandedTechIds.has(tech.id);

        cardsContainer.innerHTML += `
            <div class="tech-card ${isExpanded ? 'expanded' : ''}" data-tech-id="${tech.id}">
                <div class="tech-card-header">
                    <div>
                        <strong style="color: #ffffff; font-size: 1.1rem;">${tech.first_name} ${tech.last_name}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <span class="badge ${workloadBadgeClass}">${techActiveFaults.length} Jobs</span>
                        <span class="expand-icon" style="color: #94a3b8; font-size: 1.2rem; transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s;">▼</span>
                    </div>
                </div>
                <div class="tech-card-body">
                    <button
                        class="btn-outline btn-assign-new-job"
                        data-tech-id="${tech.id}"
                        style="width: 100%; margin-bottom: 15px; padding: 8px; border: 1px dashed #64748b; color: #e2e8f0; background: transparent; cursor: pointer; border-radius: 4px;"
                    >➕ Assign Fault</button>
                    ${faultItemsHtml}
                </div>
            </div>`;
    });
};


// ============================================================================
// TECHNICIAN CONTROLLER & RENDERERS
// ============================================================================

/**
 * Sets up all views and interactions for a logged-in technician.
 * Renders "My Faults", "My Tools", and "Available Tools" tables,
 * and wires up the relevant KPI card click handlers.
 */
const setupTechnicianViews = (myFaults, allTools, users, normalisedRole, userId) => {

    // --- RENDER MY FAULTS ---
    const renderMyFaults = () => {
        const tableBody = document.getElementById('tech-faults-tbody');
        if (!tableBody) return;

        if (myFaults.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No faults currently assigned. Great job! 🎉</td></tr>';
            return;
        }

        tableBody.innerHTML = myFaults.map(f => {
            const statusBadgeClass   = f.status === 'Resolved' ? 'badge-available' : f.status === 'In-Review' ? 'badge-review' : f.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';
            const priorityBadgeClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
            return `
                <tr>
                    <!-- REMOVED ID COLUMN HERE -->
                    <td>${f.title}</td>
                    <td>${f.location}</td>
                    <td><span class="badge ${priorityBadgeClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                    <td><span class="badge ${statusBadgeClass}">${f.status.toUpperCase()}</span></td>
                    <td>
                        <button
                            class="btn-solid btn-view-report"
                            data-id="${f.id}"
                            style="padding: 4px 8px; font-size: 0.75rem; background: #1d4ed8; color: #ffffff; border: none; border-radius: 4px; cursor: pointer;"
                        >View Report</button>
                    </td>
                </tr>`;
        }).join('');
    };

    // --- RENDER MY CHECKED-OUT TOOLS ---
    const renderMyTools = () => {
        const tableBody = document.getElementById('tech-tools-tbody');
        if (!tableBody) return;

        const myCheckedOutTools = allTools.filter(t => t.current_user_id === userId);

        if (myCheckedOutTools.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 20px;">No tools currently checked out.</td></tr>';
            return;
        }

        tableBody.innerHTML = myCheckedOutTools.map(t => {
            const checkoutTimeText = t.checkout_timestamp? new Date(t.checkout_timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
            return `
                <tr>
                    <td>${t.id}</td>
                    <td>${t.tool_type}</td>
                    <td>${t.storage_location || '<span style="color:#64748b;">Not Assigned</span>'}</td>
                    <td>${checkoutTimeText}</td>
                </tr>`;
        }).join('');
    };

    // --- RENDER AVAILABLE TOOLS ---
    const renderAvailableTools = () => {
        const tableBody = document.getElementById('avail-tools-tbody');
        if (!tableBody) return;

        // A tool is available if it has no current user, or its status is explicitly 'available'
        const availableToolsList = allTools.filter(t =>
            !t.current_user_id || (t.status && t.status.trim().toLowerCase() === 'available')
        );

        if (availableToolsList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 20px;">No tools currently available.</td></tr>';
            return;
        }

        tableBody.innerHTML = availableToolsList.map(t => `
            <tr>
                <td>${t.id}</td>
                <td>${t.tool_type}</td>
                <td>${t.storage_location || '<span style="color:#64748b;">Not Assigned</span>'}</td>
                <td><span class="badge badge-available">AVAILABLE</span></td>
            </tr>`
        ).join('');
    };

    // --- FAULT TABLE CLICK DELEGATION ---
    const faultTableBody = document.getElementById('tech-faults-tbody');
    if (faultTableBody) {
        faultTableBody.onclick = (e) => {
            const viewReportButton = e.target.closest('.btn-view-report');
            if (viewReportButton) {
                const faultId = parseInt(viewReportButton.getAttribute('data-id'));
                openFaultModal(faultId, myFaults, users, normalisedRole, userId);
            }
        };
    }

    // --- KPI CARD NAVIGATION (TECHNICIAN) ---
    // Helper to highlight the correct sidebar item when a KPI card is clicked
    const navigateToView = (viewId, navButtonText) => {
        showView(viewId);
        document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
            if (btn.textContent === navButtonText) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    // The "Active Faults" KPI card isn't relevant to technicians — hide it
    const kpiActiveCard = document.querySelector('.card-active');
    if (kpiActiveCard) kpiActiveCard.style.display = 'none';

    const kpiReviewCard = document.querySelector('.card-review');
    if (kpiReviewCard) {
        kpiReviewCard.classList.add('clickable-kpi');
        kpiReviewCard.onclick = () => navigateToView('assigned-faults-view', 'MY FAULTS');
    }

    const kpiProgressCard = document.querySelector('.card-progress');
    if (kpiProgressCard) {
        kpiProgressCard.classList.add('clickable-kpi');
        kpiProgressCard.onclick = () => navigateToView('assigned-faults-view', 'MY FAULTS');
    }

    const kpiToolsOutCard = document.querySelector('.card-tools-out');
    if (kpiToolsOutCard) {
        kpiToolsOutCard.classList.add('clickable-kpi');
        kpiToolsOutCard.onclick = () => navigateToView('active-tools-view', 'MY TOOLS');
    }

    const kpiToolsAvailCard = document.querySelector('.card-tools-avail');
    if (kpiToolsAvailCard) {
        kpiToolsAvailCard.classList.add('clickable-kpi');
        kpiToolsAvailCard.onclick = () => navigateToView('available-tools-view', 'AVAILABLE TOOLS');
    }

    // --- FAULT REPORT MODAL — CLOSE LOGIC (TECHNICIAN) ---
    const faultReportModal   = document.getElementById('fault-report-modal');
    const closeReportButton  = document.getElementById('close-report-modal');

    if (closeReportButton && faultReportModal) {
        closeReportButton.onclick = () => faultReportModal.classList.add('hidden');
        faultReportModal.onclick  = (e) => {
            if (e.target === faultReportModal) faultReportModal.classList.add('hidden');
        };
    }

    // Kick off the initial render for all three technician tables
    renderMyFaults();
    renderMyTools();
    renderAvailableTools();
};


// ============================================================================
// MODALS & POPUPS
// ============================================================================

/**
 * Opens the fault detail modal and populates it with data for the given fault.
 * If the fault is "In-Review" and the viewer is a supervisor, interactive
 * approve/reject controls are shown; otherwise the details are read-only.
 */
const openFaultModal = (faultId, faults, users, normalisedRole, userId) => {
    const fault = faults.find(f => f.id === faultId);
    if (!fault) return;

    document.getElementById('report-id').textContent = `F-${fault.id}`;

    const priorityBadgeClass = fault.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : fault.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
    const statusBadgeClass   = fault.status === 'Resolved' ? 'badge-available' : fault.status === 'In-Review' ? 'badge-review' : fault.status === 'In-Progress' ? 'badge-assigned' : 'badge-active';

    // When a fault is awaiting review, the priority shown is the technician's recommendation
    const priorityLabel = fault.status === 'In-Review' ? 'Rec. Priority:' : 'Priority:';

    let interactiveActionsHtml = '';

    // Static notes section shown for read-only views
    let supervisorNotesHtml = `
        <div style="margin-top: 5px;">
            <strong style="color:#ffffff;">Supervisor Notes:</strong>
            <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 8px; line-height: 1.6; border: 1px solid #334155;">
                ${fault.notes || '<span style="color:#cbd5e1;">No notes recorded yet.</span>'}
            </div>
        </div>
    `;

    const isSupervisor = ['supervisor', 'admin', 'administrator'].includes(normalisedRole);
    const notesTitle = fault.status === 'Resolved' ? 'Resolution Notes:' : 'Supervisor Notes:';

    // Replace the static notes section with interactive controls for supervisors reviewing a fault
    if (fault.status === 'In-Review' && isSupervisor) {
        let supervisorNotesHtml = `
        <div style="margin-top: 5px;">
            <strong style="color:#ffffff;">${notesTitle}</strong>
            <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 8px; line-height: 1.6; border: 1px solid #334155;">
                ${fault.notes || '<span style="color:#cbd5e1;">No notes recorded yet.</span>'}
            </div>
        </div>
    `;
        interactiveActionsHtml = `
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
                        <button
                            id="modal-btn-open-tech"
                            class="btn-outline btn-open-tech-modal"
                            data-tech-id=""
                            style="width: 100%; height: 40px; box-sizing: border-box; padding: 8px; background: #1e293b; color: #e2e8f0; border: 1px solid #64748b; border-radius: 4px; margin-top: 5px; text-align: left; display: flex; justify-content: space-between; align-items: center;"
                        >
                            <span class="tech-name-display">-- Unassigned --</span>
                            <span>🔍</span>
                        </button>
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong style="color:#ffffff; font-size: 0.9rem;">Add Note (Required for rejection):</strong>
                    <textarea
                        id="modal-input-notes"
                        rows="3"
                        placeholder="Enter instructions or rejection reasons here..."
                        style="width: 100%; padding: 8px; background: #1e293b; color: #f8fafc; border: 1px solid #64748b; border-radius: 4px; margin-top: 5px; font-family: inherit; resize: vertical; box-sizing: border-box;"
                    ></textarea>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="modal-btn-reject"  class="btn-solid" data-id="${fault.id}" style="background: #b91c1c; color: #ffffff; width: auto; padding: 8px 20px;">Reject ✕</button>
                    <button id="modal-btn-approve" class="btn-solid" data-id="${fault.id}" style="background: #15803d; color: #ffffff; width: auto; padding: 8px 20px;">Approve ✓</button>
                </div>
            </div>
        `;
    }

    // Populate the modal's main content area
    document.getElementById('report-content').innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px; color: #f8fafc;">
            <div><strong style="color:#ffffff;">Title:</strong>       <br>${fault.title}</div>
            <div><strong style="color:#ffffff;">Location:</strong>    <br>${fault.location}</div>
            <div><strong style="color:#ffffff;">Status:</strong>      <br><span class="badge ${statusBadgeClass}"   style="margin-top:4px; display:inline-block;">${fault.status.toUpperCase()}</span></div>
            <div><strong style="color:#ffffff;">${priorityLabel}</strong> <br><span class="badge ${priorityBadgeClass}" style="margin-top:4px; display:inline-block;">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></div>
            <div><strong style="color:#ffffff;">Reported By:</strong> <br>${getUserFullName(users, fault.reported_by_id)}</div>
            <div><strong style="color:#ffffff;">Assigned To:</strong> <br>${getUserFullName(users, fault.assigned_to_id)}</div>
            <div><strong style="color:#ffffff;">Resolved By:</strong> <br>${getUserFullName(users, fault.resolved_by_id)}</div>
            <div><strong style="color:#ffffff;">Logged Time:</strong> <br>${fault.timestamp ? new Date(fault.timestamp).toLocaleString() : 'N/A'}</div>
        </div>
        <hr style="border: 0; border-top: 1px solid #475569; margin: 15px 0;">
        <div>
            <strong style="color:#ffffff;">Description:</strong>
            <div style="background: #0f172a; padding: 15px; border-radius: 8px; margin-top: 8px; line-height: 1.6; border: 1px solid #334155;">
                ${fault.description || '<span style="color:#cbd5e1;">No description provided.</span>'}
            </div>
        </div>
        ${supervisorNotesHtml}
        ${interactiveActionsHtml}
    `;

    const faultReportModal = document.getElementById('fault-report-modal');

    // Wire up the Approve button if it was rendered
    const approveButton = document.getElementById('modal-btn-approve');
    if (approveButton) {
        approveButton.onclick = async () => {
            const selectedPriority = document.getElementById('modal-select-priority').value;
            const selectedTechId = document.getElementById('modal-btn-open-tech').getAttribute('data-tech-id');
            const enteredNotes = document.getElementById('modal-input-notes').value;

            if (!selectedPriority) return alert("Please select a Priority level before approving this fault.");

            approveButton.textContent = "⏳";
            approveButton.disabled    = true;

            try {
                const updatePayload = {
                    status: selectedTechId ? 'In-Progress' : 'Active',
                    priority: selectedPriority,
                    assigned_to_id: selectedTechId ? parseInt(selectedTechId) : null,
                    resolved_by_id: null,
                    notes: enteredNotes || null
                };
                await updateFault(fault.id, updatePayload);
                faultReportModal.classList.add('hidden');
                loadDashboardData(normalisedRole, userId);
            } catch (error) {
                alert("Failed to approve: " + error.message);
                approveButton.textContent = "Approve ✓";
                approveButton.disabled    = false;
            }
        };
    }

    // Wire up the Reject button if it was rendered
    const rejectButton = document.getElementById('modal-btn-reject');
    if (rejectButton) {
        
        rejectButton.onclick = async () => {
            const enteredNotes = document.getElementById('modal-input-notes').value;

            if (!enteredNotes.trim()) return alert("Please provide a reason in the Notes section before rejecting.");

            rejectButton.textContent = "⏳";
            rejectButton.disabled = true;

            try {
                const updatePayload = {
                    status: 'Resolved',
                    priority: 'Low',
                    assigned_to_id: null,
                    resolved_by_id: null,
                    notes: `[REJECTED]: ${enteredNotes}`
                };
                await updateFault(fault.id, updatePayload);
                faultReportModal.classList.add('hidden');
                loadDashboardData(normalisedRole, userId);

            } catch (error) {
                alert("Failed to reject: " + error.message);
                rejectButton.textContent = "Reject ✕";
                rejectButton.disabled = false;
            }
        };
    }

    faultReportModal.classList.remove('hidden');
};


// ============================================================================
// EVENT DELEGATION (SUPERVISOR)
// ============================================================================

/**
 * Wires up all interactive elements within the supervisor's views:
 * search inputs, filter dropdowns, sortable table headers, the workload
 * balancing accordion, technician/job selection modals, and KPI card links.
 */
const setupSupervisorEvents = (faults, tools, users, normalisedRole, userId) => {

    // --- FILTERS & SEARCH ---

    const searchToolsInput = document.getElementById('search-tools');
    if (searchToolsInput) {
        searchToolsInput.oninput = (e) => {
            allToolsSortState.search = e.target.value;
            renderAllTools(tools, users);
        };
    }

    const filterToolsDropdown = document.getElementById('filter-tools');
    if (filterToolsDropdown) {
        filterToolsDropdown.onchange = (e) => {
            allToolsSortState.filter = e.target.value;
            renderAllTools(tools, users);
        };
    }

    const searchFaultsInput = document.getElementById('search-faults');
    if (searchFaultsInput) {
        searchFaultsInput.oninput = (e) => {
            allFaultsSortState.search = e.target.value;
            renderAllFaults(faults, users);
        };
    }

    const filterFaultsDropdown = document.getElementById('filter-faults');
    if (filterFaultsDropdown) {
        filterFaultsDropdown.onchange = (e) => {
            allFaultsSortState.filter = e.target.value;
            renderAllFaults(faults, users);
        };
    }

    // --- SORTABLE TABLE HEADERS ---

    document.querySelectorAll('#all-tools-view th[data-sort]').forEach(headerCell => {
        headerCell.onclick = () => {
            allToolsSortState.sortAsc = (allToolsSortState.sortCol === headerCell.dataset.sort) ? !allToolsSortState.sortAsc : true; allToolsSortState.sortCol = headerCell.dataset.sort;
            renderAllTools(tools, users);
        };
    });

    document.querySelectorAll('#all-faults-view th[data-sort]').forEach(headerCell => {
        headerCell.onclick = () => {
            allFaultsSortState.sortAsc = (allFaultsSortState.sortCol === headerCell.dataset.sort) ? !allFaultsSortState.sortAsc : true;
            allFaultsSortState.sortCol = headerCell.dataset.sort;
            renderAllFaults(faults, users);
        };
    });

    document.querySelectorAll('#review-faults-view th[data-sort]').forEach(headerCell => {
        headerCell.onclick = () => {
            reviewQueueState.sortAsc = (reviewQueueState.sortCol === headerCell.dataset.sort) ? !reviewQueueState.sortAsc : true;
            reviewQueueState.sortCol = headerCell.dataset.sort;
            renderReviewQueue(faults, users);
        };
    });

    // --- WORKLOAD BALANCING — ACCORDION & MODALS ---

    const technicianCardsContainer = document.getElementById('tech-cards-container');
    if (technicianCardsContainer) {
        technicianCardsContainer.onclick = (e) => {

            // Expand/collapse a technician card when its header is clicked
            const cardHeader = e.target.closest('.tech-card-header');
            if (cardHeader) {
                const techCard = cardHeader.closest('.tech-card');
                const techId = parseInt(techCard.getAttribute('data-tech-id'));
                const expandIcon = cardHeader.querySelector('.expand-icon');
                techCard.classList.toggle('expanded');

                if (techCard.classList.contains('expanded')) {
                    expandedTechIds.add(techId);
                } else {
                    expandedTechIds.delete(techId);
                }

                expandIcon.style.transform = techCard.classList.contains('expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
                return;
            }

            // Open the technician selection modal to reassign an existing fault
            const reassignButton = e.target.closest('.btn-instant-reassign');
            if (reassignButton) {
                activeAssignTechButton = reassignButton;

                const currentTechId = parseInt(reassignButton.getAttribute('data-current-tech-id'));
                const techSelectModal = document.getElementById('tech-select-modal');
                const techModalTbody = document.getElementById('tech-modal-table-body');
                const technicianList = users.filter(u => u.role && u.role.toLowerCase() === 'technician');

                techModalTbody.innerHTML = '';
                technicianList.forEach(t => {
                    // Don't list the technician who currently holds this fault
                    if (t.id === currentTechId) return;

                    const activeJobCount = faults.filter(f => f.assigned_to_id === t.id && ['Active', 'In-Progress'].includes(f.status)).length;
                    const workloadBadgeClass = activeJobCount > 3 ? 'badge-high' : activeJobCount > 0 ? 'badge-assigned' : 'badge-available';
                    techModalTbody.innerHTML += `
                        <tr>
                            <td style="color: white; font-weight: bold;">${t.first_name} ${t.last_name}</td>
                            <td><span class="badge ${workloadBadgeClass}">${activeJobCount} Jobs</span></td>
                            <td>
                                <button
                                    class="btn-solid btn-choose-tech"
                                    data-tech-id="${t.id}"
                                    data-tech-name="${t.first_name} ${t.last_name}"
                                    style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto; border: none; border-radius: 4px; cursor: pointer;"
                                >Select</button>
                            </td>
                        </tr>`;
                });
                techSelectModal.classList.remove('hidden');
            }

            // Open the job selection modal to assign a new unassigned fault to a technician
            const assignNewJobButton = e.target.closest('.btn-assign-new-job');
            if (assignNewJobButton) {

                const techId = parseInt(assignNewJobButton.getAttribute('data-tech-id'));
                const jobSelectModal = document.getElementById('job-select-modal');
                const jobModalTbody = document.getElementById('job-modal-table-body');
                const unassignedFaults = faults.filter(f => f.status === 'Active' && !f.assigned_to_id);

                jobModalTbody.innerHTML = '';
                if (unassignedFaults.length === 0) {
                    jobModalTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 30px;">No unassigned Active jobs available! 🎉</td></tr>';
                } else {
                    unassignedFaults.forEach(f => {
                        const priorityBadgeClass = f.priority?.toUpperCase() === 'HIGH' ? 'badge-high' : f.priority?.toUpperCase() === 'MEDIUM' ? 'badge-medium' : 'badge-low';
                        jobModalTbody.innerHTML += `
                            <tr>
                                <td style="color: white; font-weight: bold;">F-${f.id}: ${f.title}</td>
                                <td style="color: #cbd5e1;">${f.location}</td>
                                <td><span class="badge ${priorityBadgeClass}">${f.priority ? f.priority.toUpperCase() : 'N/A'}</span></td>
                                <td>
                                    <button
                                        class="btn-solid btn-confirm-assign-job"
                                        data-fault-id="${f.id}"
                                        data-tech-id="${techId}"
                                        style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto; border-radius: 4px; border: none; cursor: pointer;"
                                    >Give Job</button>
                                </td>
                            </tr>`;
                    });
                }
                jobSelectModal.classList.remove('hidden');
            }
        };
    }

    // --- TECHNICIAN SELECT MODAL ---

    const techModalTableBody = document.getElementById('tech-modal-table-body');
    const techSelectionModal = document.getElementById('tech-select-modal');

    if (techModalTableBody) {

        techModalTableBody.onclick = async (e) => {
            if (!e.target.classList.contains('btn-choose-tech')) return;

            const chosenTechId = e.target.getAttribute('data-tech-id');
            const chosenTechName = e.target.getAttribute('data-tech-name');

            if (activeAssignTechButton) {

                // If this was triggered via the "Reassign" button on the workload view,
                // immediately save the change to the API
                if (activeAssignTechButton.classList.contains('btn-instant-reassign')) {
                    const faultId = parseInt(activeAssignTechButton.getAttribute('data-fault-id'));
                    const faultToUpdate = faults.find(f => f.id === faultId);
                    e.target.textContent = "⏳";
                    e.target.disabled = true;

                    try {
                        await updateFault(faultId, {
                            status: 'In-Progress',
                            priority: faultToUpdate.priority || 'Medium',
                            assigned_to_id: parseInt(chosenTechId),
                            resolved_by_id: null,
                            notes: faultToUpdate.notes || null
                        });
                        techSelectionModal.classList.add('hidden');
                        loadDashboardData(normalisedRole, userId);
                        return;
                    } catch (error) {
                        alert("Failed to reassign: " + error.message);
                        e.target.textContent = "Select";
                        e.target.disabled = false;
                        return;
                    }
                }

                // Otherwise, just update the button in the review queue row (saved on approval)
                activeAssignTechButton.setAttribute('data-tech-id', chosenTechId);
                activeAssignTechButton.querySelector('.tech-name-display').textContent = chosenTechName;
                activeAssignTechButton.querySelector('.tech-name-display').style.color = '#ffffff';
                activeAssignTechButton.style.borderColor = '#3b82f6';
            }

            techSelectionModal.classList.add('hidden');
        };
    }

    // --- JOB SELECT MODAL ---

    const jobModalTableBody = document.getElementById('job-modal-table-body');
    const jobSelectionModal = document.getElementById('job-select-modal');

    if (jobModalTableBody) {

        jobModalTableBody.onclick = async (e) => {
            const confirmAssignButton = e.target.closest('.btn-confirm-assign-job');
            if (!confirmAssignButton) return;

            const faultId = parseInt(confirmAssignButton.getAttribute('data-fault-id'));
            const techId = parseInt(confirmAssignButton.getAttribute('data-tech-id'));
            const faultToUpdate = faults.find(f => f.id === faultId);

            confirmAssignButton.textContent = "⏳";
            confirmAssignButton.disabled = true;

            try {
                await updateFault(faultId, {
                    status: 'In-Progress',
                    priority: faultToUpdate.priority || 'Medium',
                    assigned_to_id: techId,
                    resolved_by_id: null,
                    notes: faultToUpdate.notes || null
                });
                jobSelectionModal.classList.add('hidden');
                loadDashboardData(normalisedRole, userId);
            } catch (error) {
                alert("Failed to assign job: " + error.message);
                confirmAssignButton.textContent = "Give Job";
                confirmAssignButton.disabled = false;
            }
        };
    }

    // --- REVIEW QUEUE — OPEN TECH MODAL VIA DELEGATION ---
    // This listens for clicks on the "Assign Technician" buttons inside review queue rows
    document.addEventListener('click', (e) => {
        const openTechModalButton = e.target.closest('.btn-open-tech-modal');
        if (openTechModalButton) {
            activeAssignTechButton = openTechModalButton;

            const technicianList = users.filter(u => u.role && u.role.toLowerCase() === 'technician');
            const techModalTbody = document.getElementById('tech-modal-table-body');
            const techSelectModal = document.getElementById('tech-select-modal');

            techModalTbody.innerHTML = '';
            technicianList.forEach(t => {
                const activeJobCount = faults.filter(f => f.assigned_to_id === t.id && ['Active', 'In-Progress'].includes(f.status)).length;
                const workloadBadgeClass = activeJobCount > 3 ? 'badge-high' : activeJobCount > 0 ? 'badge-assigned' : 'badge-available';
                techModalTbody.innerHTML += `
                    <tr>
                        <td style="color: white; font-weight: bold;">${t.first_name} ${t.last_name}</td>
                        <td><span class="badge ${workloadBadgeClass}">${activeJobCount} Jobs</span></td>
                        <td>
                            <button
                                class="btn-solid btn-choose-tech"
                                data-tech-id="${t.id}"
                                data-tech-name="${t.first_name} ${t.last_name}"
                                style="padding: 4px 12px; background: #1d4ed8; color: #ffffff; width: auto;"
                            >Select</button>
                        </td>
                    </tr>`;
            });
            techSelectModal.classList.remove('hidden');
        }
    });

    // --- CLEAR TECHNICIAN ASSIGNMENT ---
    const clearTechAssignButton = document.getElementById('btn-clear-tech');
    if (clearTechAssignButton) {
        clearTechAssignButton.onclick = () => {
            if (activeAssignTechButton) {
                activeAssignTechButton.setAttribute('data-tech-id', '');
                activeAssignTechButton.querySelector('.tech-name-display').textContent = '-- Unassigned --';
                activeAssignTechButton.querySelector('.tech-name-display').style.color = '#94a3b8';
                activeAssignTechButton.style.borderColor = '#334155';
            }
            document.getElementById('tech-select-modal').classList.add('hidden');
        };
    }

    // --- CLOSE MODALS ---

    const closeTechModalButton = document.getElementById('close-tech-modal');
    const techSelectModal = document.getElementById('tech-select-modal');
    if (closeTechModalButton && techSelectModal) {
        closeTechModalButton.onclick  = () => techSelectModal.classList.add('hidden');
        techSelectModal.onclick = (e) => { if (e.target === techSelectModal) techSelectModal.classList.add('hidden'); };
    }

    const closeJobModalButton = document.getElementById('close-job-modal');
    const jobSelectModal = document.getElementById('job-select-modal');
    if (closeJobModalButton && jobSelectModal) {
        closeJobModalButton.onclick = () => jobSelectModal.classList.add('hidden');
        jobSelectModal.onclick = (e) => { if (e.target === jobSelectModal) jobSelectModal.classList.add('hidden'); };
    }

    const closeFaultReportButton = document.getElementById('close-report-modal');
    const faultReportModal = document.getElementById('fault-report-modal');
    if (closeFaultReportButton && faultReportModal) {
        closeFaultReportButton.onclick = () => faultReportModal.classList.add('hidden');
        faultReportModal.onclick = (e) => { if (e.target === faultReportModal) faultReportModal.classList.add('hidden'); };
    }

    // --- REVIEW QUEUE — INLINE TABLE ACTIONS ---
    const reviewQueueTableBody = document.getElementById('review-faults-table-body');
    if (reviewQueueTableBody) {

        reviewQueueTableBody.onclick = async (e) => {

            // Open the full fault detail modal
            if (e.target.classList.contains('btn-view-modal')) {
                return openFaultModal(parseInt(e.target.getAttribute('data-id')), faults, users, normalisedRole, userId);
            }

            // Quick-approve a fault directly from the review queue row
            if (e.target.classList.contains('btn-approve-fault')) {
                const approveButton = e.target;
                const faultId = parseInt(approveButton.getAttribute('data-id'));
                const tableRow = approveButton.closest('tr');
                const selectedPriority = tableRow.querySelector('.select-priority').value;
                const selectedTechId = tableRow.querySelector('.btn-open-tech-modal').getAttribute('data-tech-id');

                if (!selectedPriority) return alert("Please select a Priority level before approving this fault.");

                approveButton.textContent = "⏳";
                approveButton.disabled    = true;

                try {
                    await updateFault(faultId, {
                        status: selectedTechId ? 'In-Progress' : 'Active',
                        priority: selectedPriority,
                        assigned_to_id: selectedTechId ? parseInt(selectedTechId) : null,
                        resolved_by_id: null,
                        notes: null
                    });
                    loadDashboardData(normalisedRole, userId);
                } catch (error) {
                    alert("Failed to approve: " + error.message);
                    approveButton.textContent = "✓";
                    approveButton.disabled = false;
                }
            }

            // Quick-reject a fault directly from the review queue row
            if (e.target.classList.contains('btn-reject-fault')) {
                const rejectButton = e.target;
                const faultId = parseInt(rejectButton.getAttribute('data-id'));
                const rejectionReason  = prompt("Enter a reason for rejecting this fault (optional):");
                if (rejectionReason === null) return; // User cancelled the prompt

                rejectButton.textContent = "⏳";
                rejectButton.disabled = true;

                try {
                    await updateFault(faultId, {
                        status: 'Resolved',
                        priority: 'Low',
                        assigned_to_id:  null,
                        resolved_by_id:  null,
                        notes: rejectionReason ? `[REJECTED]: ${rejectionReason}` : `[REJECTED]: No reason provided by supervisor.`
                    });
                    loadDashboardData(normalisedRole, userId);
                } catch (error) {
                    alert("Failed to reject: " + error.message);
                    rejectButton.textContent = "✕";
                    rejectButton.disabled = false;
                }
            }
        };
    }

    // --- ALL FAULTS TABLE — OPEN REPORT MODAL ---
    const allFaultsTableBody = document.getElementById('all-faults-table-body');
    if (allFaultsTableBody) {
        allFaultsTableBody.onclick = (e) => {
            if (e.target.classList.contains('btn-view-report')) {
                openFaultModal(parseInt(e.target.getAttribute('data-id')), faults, users, normalisedRole, userId);
            }
        };
    }

    // --- TECHNICIAN FAULTS TABLE (visible in supervisor context) ---
    const techFaultsTableBody = document.getElementById('tech-faults-tbody');
    if (techFaultsTableBody) {
        techFaultsTableBody.onclick = (e) => {
            if (e.target.classList.contains('btn-view-report')) {
                const faultId = parseInt(e.target.getAttribute('data-id'));
                openFaultModal(faultId, faults, users, normalisedRole, userId);
            }
        };
    }

    // --- KPI CARD NAVIGATION (SUPERVISOR) ---

    // Helper to navigate and highlight the matching sidebar item
    const navigateToView = (viewId, navButtonText) => {
        showView(viewId);
        document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
            if (btn.textContent === navButtonText) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    // Helper to apply a filter preset and re-render the target table
    const applyKpiFilter = (filterElementId, filterValue, sortStateObject, renderFunction) => {
        const filterDropdown = document.getElementById(filterElementId);
        if (filterDropdown) filterDropdown.value = filterValue;
        sortStateObject.filter = filterValue;
        renderFunction();
    };

    const kpiActiveCard = document.querySelector('.card-active');
    if (kpiActiveCard) {
        kpiActiveCard.classList.add('clickable-kpi');
        kpiActiveCard.onclick = () => {
            applyKpiFilter('filter-faults', 'active', allFaultsSortState, () => renderAllFaults(faults, users));
            navigateToView('all-faults-view', 'ALL FAULTS');
        };
    }

    const kpiReviewCard = document.querySelector('.card-review');
    if (kpiReviewCard) {
        kpiReviewCard.classList.add('clickable-kpi');
        kpiReviewCard.onclick = () => navigateToView('review-faults-view', 'FAULTS TO REVIEW');
    }

    const kpiProgressCard = document.querySelector('.card-progress');
    if (kpiProgressCard) {
        kpiProgressCard.classList.add('clickable-kpi');
        kpiProgressCard.onclick = () => {
            applyKpiFilter('filter-faults', 'in-progress', allFaultsSortState, () => renderAllFaults(faults, users));
            navigateToView('all-faults-view', 'ALL FAULTS');
        };
    }

    const kpiToolsOutCard = document.querySelector('.card-tools-out');
    if (kpiToolsOutCard) {
        kpiToolsOutCard.classList.add('clickable-kpi');
        kpiToolsOutCard.onclick = () => {
            applyKpiFilter('filter-tools', 'checked-out', allToolsSortState, () => renderAllTools(tools, users));
            navigateToView('all-tools-view', 'ALL TOOLS');
        };
    }

    const kpiToolsAvailCard = document.querySelector('.card-tools-avail');
    if (kpiToolsAvailCard) {
        kpiToolsAvailCard.classList.add('clickable-kpi');
        kpiToolsAvailCard.onclick = () => {
            applyKpiFilter('filter-tools', 'available', allToolsSortState, () => renderAllTools(tools, users));
            navigateToView('all-tools-view', 'ALL TOOLS');
        };
    }
};


// ============================================================================
// UTILITY HELPERS
// ============================================================================

/**
 * Returns the full name of a user by their ID.
 * Falls back to a styled "Unassigned" label if no ID is provided,
 * or a plain "User {id}" string if the ID isn't found in the list.
 */
const getUserFullName = (users, id) => {
    if (!id) return '<span style="color:#64748b;">Unassigned</span>';
    const matchedUser = users.find(user => user.id === id);
    return matchedUser ? `${matchedUser.first_name} ${matchedUser.last_name}` : `User ${id}`;
};