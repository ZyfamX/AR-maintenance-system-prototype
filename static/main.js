import { setupEventListeners, checkSessionOnLoad } from './ui.js';
import { checkSession } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    
    setupEventListeners();
    
    // Check if the user is already logged in before forcing them to the login screen
    checkSessionOnLoad();

    if (sessionStorage.getItem("sessionExpired") === "true") {
        sessionStorage.removeItem("sessionExpired");

        alert("Session expired! Please log in again.");
    }

    const dashboard = document.getElementById("dashboard-view")

    setInterval(async () => {
        if (dashboard && !dashboard.classList.contains("hidden")) {
            try {
                const active = await checkSession();
                if (!active) {
                    sessionStorage.setItem("sessionExpired", "true")
                    window.location.reload();
                }
            } catch (err) {
                console.error("Session check failed:", err)
            }
        }
    }, 60000);
    
    console.log("AR Maintenance System Initialized.");
});

document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") {
        return;
    }

    const dashboard = document.getElementById("dashboard")
    const dashboardVisible = dashboard && !dashboard.classList.contains("hidden")

    if (!dashboardVisible) {
        return;
    }

    try {
        const active = await checkSession();

        if(!active) {
            sessionStorage.setItem("sessionExpired", "true");
            window.location.reload();
        }
    } catch (err) {
        console.error("Session check failed:", err)
    }
});