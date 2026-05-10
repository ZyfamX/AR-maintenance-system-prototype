// utils.js is used for small helper functions that are shared across multiple files, to keep the code DRY and organized.

/**
 * Creates a beautiful sliding Toast notification on the screen.
 * @param {string} message - The text to display
 * @param {string} type - 'success' or 'error'
 */
export function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `ar-toast toast-${type}`;
    const icon = type === 'success' ? '✅' : '🚫';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

/**
 * Safely formats an ISO timestamp into a readable, uniform string.
 * @param {string} iso - The ISO date string from the database
 * @param {boolean} includeDate - Whether to show just the time, or date + time
 */
export function formatTime(iso, includeDate = true) {
    if (!iso) return '<span style="color:#64748b;">N/A</span>';
    const d = new Date(iso);
    if (isNaN(d)) return iso; // Fallback if string is invalid
    
    if (includeDate) {
        return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Returns the full name of a user by their ID.
 * Falls back to a styled "Unassigned" label if no ID is provided.
 */
export function getUserFullName(usersArray, id) {
    if (!id) return '<span style="color:#64748b;">Unassigned</span>';
    const matchedUser = usersArray.find(user => String(user.id) === String(id));
    return matchedUser ? `${matchedUser.first_name} ${matchedUser.last_name}` : `User ${id}`;
}

/**
 * Prompts the browser/device for the user's current GPS location.
 * @returns {Promise<{lat: number, lon: number}>}
 */
export function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported by your browser."));
        } else {
            navigator.geolocation.getCurrentPosition(
                (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
                (error) => reject(new Error("Location permission denied. You must allow GPS access."))
            );
        }
    });
}