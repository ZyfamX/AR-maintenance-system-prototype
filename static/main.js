import { setupEventListeners } from './ui.js';

// Wait for the DOM (HTML) to be fully loaded before attaching listeners
document.addEventListener('DOMContentLoaded', () => {
    
    setupEventListeners();
    
    console.log("AR Maintenance System Initialized.");
    
});