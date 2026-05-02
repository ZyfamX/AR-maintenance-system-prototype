import { setupEventListeners, checkSessionOnLoad } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    
    setupEventListeners();
    
    // Check if the user is already logged in before forcing them to the login screen
    checkSessionOnLoad();
    
    console.log("AR Maintenance System Initialized.");
});