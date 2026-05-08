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

    const login = document.getElementById("login-view")

    setInterval(async () => {
        if (login === null || login?.classList.contains("hidden")) {
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

    const login = document.getElementById("login-view")
    const loginVisible = login === null || login.classList.contains("hidden")

    if (!loginVisible) {
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