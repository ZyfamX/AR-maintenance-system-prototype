import { login, logout, getFaults, getTools } from './api.js';

// View Navigation Helper
// This function hides all screens, then unhides the one asked for
export function showView(viewId) {

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('ar-view').classList.add('hidden');

    document.getElementById(viewId).classList.remove('hidden');

}

// Event Listeners Setup
export function setupEventListeners() {

    // Grab the HTML elements we need to interact with
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    
    const btnLaunchAR = document.getElementById('btn-launch-ar');
    const btnHome = document.getElementById('btn-home');
    const btnLogout = document.getElementById('btn-logout');

    // Handle Login Submit
    loginForm.addEventListener('submit', async (e) => {

        e.preventDefault(); // CRITICAL: Stops the browser from refreshing the page!
        
        const usernameInput = document.getElementById('username').value;
        const passwordInput = document.getElementById('password').value;
        
        try {

            loginError.textContent = "Authenticating..."; // Loading state
            
            // Call the backend API
            const user = await login(usernameInput, passwordInput);
            
            // If we get here, login was successful!
            loginError.textContent = "";
            loginForm.reset(); // Clear the password from the input box
            
            console.log("Successfully logged in as:", user.first_name);
            showView('dashboard-view'); // Switch the screen!
            loadDashboardData(); // Load the dashboard data after successful login
            
        } catch (error) {
            // If the backend sends a 401 Unauthorized, it throws an error here
            loginError.textContent = error.message || "Invalid credentials.";
        }
    });

    // 2. Handle AR Scanner Launch
    btnLaunchAR.addEventListener('click', () => {showView('ar-view')});

    // 3. Handle Going Home
    btnHome.addEventListener('click', () => {showView('dashboard-view')});

    // 4. Handle Logout (With F22 Tool Check Logic)
    btnLogout.addEventListener('click', async () => {
        try {

            await logout();
            showView('login-view'); // Go back to login screen

        } catch (error) {

            // Catching the 409 Conflict from Requirement F22!
            if (error.message.includes("WARNING_UNRETURNED_TOOLS")) {

                const force = confirm("You have unreturned tools! Are you sure you want to log out?");

                if (force) {

                    await logout(true); // Pass the force=true flag
                    showView('login-view');
                }

            } else {
                alert("Logout failed: " + error.message);
            }

        }

    });

}


// --- Data Loading Logic ---
export async function loadDashboardData() {

    try {
        // Fetch data from your Python API
        const faults = await getFaults();
        const tools = await getTools();

        // 1. Update KPI Counters
        const activeFaults = faults.filter(f => f.status === 'Active' || f.status === 'Assigned').length;
        const deployedTools = tools.filter(t => t.status === 'Checked-Out').length;
        
        document.getElementById('kpi-faults').textContent = activeFaults;
        document.getElementById('kpi-tools').textContent = deployedTools;

        // 2. Populate Faults Table
        const faultsBody = document.getElementById('faults-table-body');
        faultsBody.innerHTML = ''; // Clear existing rows
        
        faults.forEach(fault => {
            // Pick a badge color based on status
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

        // 3. Populate Tools Table
        const toolsBody = document.getElementById('tools-table-body');
        toolsBody.innerHTML = ''; // Clear existing rows
        
        tools.forEach(tool => {
            const row = `
                <tr>
                    <td>${tool.asset_id || tool.id}</td>
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