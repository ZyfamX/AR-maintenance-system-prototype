import { login, logout, getFaults, getTools } from './api.js';

// View Navigation Helper
export function showView(viewId) {

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById(viewId).classList.remove('hidden');

}



// Data Loading Logic
export async function loadDashboardData() {
    try {
        const faults = await getFaults();
        const tools = await getTools();

        // 1. Calculate KPI values 
        const activeCount = faults.filter(f => f.status === 'Active').length;
        const reviewCount = faults.filter(f => f.status === 'In-Review').length;
        const progressCount = faults.filter(f => f.status === 'In-Progress').length; 
        
        // NEW: Calculate Tool KPIs
        const toolsOutCount = tools.filter(t => t.status === 'Checked-Out').length;
        const toolsAvailCount = tools.filter(t => t.status === 'Available').length;
        
        // 2. Update KPI UI
        if (document.getElementById('kpi-active')) document.getElementById('kpi-active').textContent = activeCount;
        if (document.getElementById('kpi-review')) document.getElementById('kpi-review').textContent = reviewCount;
        if (document.getElementById('kpi-progress')) document.getElementById('kpi-progress').textContent = progressCount;
        
        // NEW: Update Tool KPI UI
        if (document.getElementById('kpi-tools-out')) document.getElementById('kpi-tools-out').textContent = toolsOutCount;
        if (document.getElementById('kpi-tools-avail')) document.getElementById('kpi-tools-avail').textContent = toolsAvailCount;

        const faultsBody = document.getElementById('faults-table-body');
        faultsBody.innerHTML = ''; 
                
        // Filter array to only include faults that are NOT "Resolved"
        const liveFaults = faults.filter(fault => fault.status.trim().toLowerCase() !== 'resolved');
                
        // Populate Faults Table
        liveFaults.forEach(fault => {
            
            // Fault Status Logic
            let badgeClass = 'badge-active';
            if(fault.status === 'In-Progress') badgeClass = 'badge-assigned'; 
            if(fault.status === 'In-Review') badgeClass = 'badge-review';

            // NEW: Fault Priority Logic
            let priorityClass = 'badge-low'; // Default to low
            if (fault.priority === 'High' || fault.priority === 'HIGH') priorityClass = 'badge-high';
            if (fault.priority === 'Medium' || fault.priority === 'MEDIUM') priorityClass = 'badge-medium';

            const row = `
                <tr>
                    <td>F-${fault.id}</td>
                    <td>${fault.title}</td>
                    <td>${fault.location}</td>
                    <td><span class="badge ${priorityClass}">${fault.priority ? fault.priority.toUpperCase() : 'N/A'}</span></td>
                    <td><span class="badge ${badgeClass}">${fault.status.toUpperCase()}</span></td>
                </tr>
            `;
            faultsBody.innerHTML += row;
        });

        // Populate Tools Table
        const toolsBody = document.getElementById('tools-table-body');
        toolsBody.innerHTML = ''; 
        
        tools.forEach(tool => {
            
            // NEW: Tool Status Logic
            let toolBadgeClass = 'badge-out'; // Default to Checked-Out (Muted)
            if (tool.status === 'Available') {
                toolBadgeClass = 'badge-available'; // Green
            }

            const row = `
                <tr>
                    <td>${tool.id}</td>
                    <td>${tool.tool_type}</td>
                    <td><span class="badge ${toolBadgeClass}">${tool.status.toUpperCase()}</span></td>
                    <td>${tool.current_user_id ? 'User ' + tool.current_user_id : 'In Storage'}</td>
                </tr>
            `;
            toolsBody.innerHTML += row;
        });

    } catch (error) {
        console.error("Failed to load dashboard data:", error);
    }
}


// Startup Check (Session Persistence)
export async function checkSessionOnLoad() {
    try {
        // Attempt to fetch data. If it works, the user's cookie is still valid!
        await getFaults();
        showView('dashboard-view');
        loadDashboardData();
    } catch (error) {
        // Cookie expired or missing. Leave them on the login screen.
        console.log("No active session. Please log in.");
    }
}


// Event Listeners Setup
export function setupEventListeners() {

    const btnMenuToggle = document.getElementById('btn-menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    // Mobile Menu Toggle
    if (btnMenuToggle && sidebar) {
        btnMenuToggle.addEventListener('click', () => {
            // Toggles the 'open' class on and off every time you click
            sidebar.classList.toggle('open');
        });
    }

    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const btnLogout = document.getElementById('btn-logout');

    // Handle Login Submit
    if (loginForm) {

        loginForm.addEventListener('submit', async (e) => {

            e.preventDefault(); 
            
            const usernameInput = document.getElementById('username').value;
            const passwordInput = document.getElementById('password').value;
            
            try {

                loginError.textContent = "Authenticating..."; 
                
                const user = await login(usernameInput, passwordInput);
                
                loginError.textContent = "";
                loginForm.reset(); 
                
                console.log("Successfully logged in as:", user.first_name);
                showView('dashboard-view'); 
                loadDashboardData(); 
                
            } catch (error) {
                loginError.textContent = error.message || "Invalid credentials.";
            }

        });

    }


    // Handle Logout
    if (btnLogout) {

        btnLogout.addEventListener('click', async () => {

            try {

                await logout();
                showView('login-view'); 

            } catch (error) {

                if (error.message.includes("WARNING_UNRETURNED_TOOLS")) {

                    const force = confirm("You have unreturned tools! Are you sure you want to log out?");

                    if (force) {

                        await logout(true); 
                        showView('login-view');

                    }
                } else {
                    alert("Logout failed: " + error.message);
                }

            }

        });

    }
    
}