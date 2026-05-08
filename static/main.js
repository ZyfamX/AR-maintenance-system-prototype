import { setupEventListeners, checkSessionOnLoad } from './ui.js';
import { checkSession, startSessionChecker } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    
    setupEventListeners();
    
    // Check if the user is already logged in before forcing them to the login screen
    checkSessionOnLoad();

    if (sessionStorage.getItem("sessionExpired") === "true") {
        sessionStorage.removeItem("sessionExpired");

        alert("Session expired! Please log in again.");
    }

    const login = document.getElementById("login-view")

    startSessionChecker(() => {
        return login === null || login.classList.contains("hidden");
    });
    
    console.log("AR Maintenance System Initialized.");
});