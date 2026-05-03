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

        const activeFaults = faults.filter(f => f.status === 'Active' || f.status === 'Assigned').length;
        const deployedTools = tools.filter(t => t.status === 'Checked-Out').length;
        
        document.getElementById('kpi-faults').textContent = activeFaults;
        document.getElementById('kpi-tools').textContent = deployedTools;

        const faultsBody = document.getElementById('faults-table-body');
        faultsBody.innerHTML = ''; 
        
        faults.forEach(fault => {

            let badgeClass = 'badge-active';
            if(fault.status === 'Assigned') badgeClass = 'badge-assigned';
            if(fault.status === 'Resolved') badgeClass = 'badge-resolved';

            const row = `
                <tr>
                    <td>F-${fault.id}</td>
                    <td>${fault.title}</td>
                    <td>${fault.location}</td>
                    <td><span class="badge ${badgeClass}">${fault.status.toUpperCase()}</span></td>
                </tr>
            `;

            faultsBody.innerHTML += row;

        });

        const toolsBody = document.getElementById('tools-table-body');
        toolsBody.innerHTML = ''; 
        
        tools.forEach(tool => {

            const row = `
                <tr>
                    <td>${tool.id}</td>
                    <td>${tool.tool_type}</td>
                    <td>${tool.status}</td>
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
    const forgotLink = document.getElementById('login-forgot');
    const modal = document.getElementById('forgot-modal');
    const closeModal = document.getElementById('close-modal');
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

    if (forgotLink && modal && closeModal) {
        forgotLink.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });

        closeModal.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
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