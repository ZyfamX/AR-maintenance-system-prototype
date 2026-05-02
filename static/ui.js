import { login, logout } from './api.js';

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