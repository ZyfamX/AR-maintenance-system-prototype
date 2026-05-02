import { getTools } from './api.js';

const overlayEl = document.getElementById('overlay');
const fallbackEl = document.getElementById('fallback');
const statusEl = document.getElementById('status');
const markerEl = document.getElementById('hiroMarker');
const arTextEl = document.getElementById('arText');
const dataPanelEl = document.getElementById('dataPanel');

// Camera Fallback Logic
function showFallback(message) {

    fallbackEl.classList.remove("hidden");
    overlayEl.classList.add("hidden");

    const arScene = document.getElementById("arScene");

    if (arScene) arScene.style.display = "none";
    
    const msgEl = fallbackEl.querySelector("p");

    if (msgEl) msgEl.textContent = message;

}

function checkCameraSupport() {

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showFallback("Your browser does not support camera access.");
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ video: true })

        .then(stream => {

            // Camera works. Stop the test stream so AR.js can use it.
            stream.getTracks().forEach(track => track.stop());

            loadData(); // Fetch the data only if camera works
        })
        .catch(err => {
            showFallback("Camera permission was denied or the camera is unavailable.");
        });
}

// Data Fetching & AR Injection
async function loadData() {

    try {

        const tools = await getTools();
        
        // Show basic stats in the 2D overlay
        const available = tools.filter(t => t.status === "Available").length;
        dataPanelEl.innerHTML = `<p>Total Tools: ${tools.length}</p><p>Available: ${available}</p>`;
        
        // For the prototype, we will just display the first tool on the Hiro marker
        if (tools.length > 0) {

            const firstTool = tools[0];
            
            // Set 3D Text
            arTextEl.setAttribute("value", `${firstTool.tool_type}\n(${firstTool.status})`);
            
            // Change Box Color based on Status (Green if available, Red if checked out)
            const color = firstTool.status === "Available" ? "#00cc66" : "#cc3333";
            const box = markerEl.querySelector("a-box");

            if (box) box.setAttribute("color", color);
        }

    } catch (error) {
        dataPanelEl.innerHTML = `<p style="color:red;">Error loading data.</p>`;
    }
}

// Marker Event Listeners
markerEl.addEventListener("markerFound", () => {
    statusEl.textContent = "Marker detected!";
    statusEl.style.color = "#7ef7a0";
});

markerEl.addEventListener("markerLost", () => {
    statusEl.textContent = "Marker lost — point camera at the Hiro marker.";
    statusEl.style.color = "#f0c040";
});

// Start the sequence
checkCameraSupport();