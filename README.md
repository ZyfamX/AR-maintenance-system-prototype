# AR-maintenance-system-prototype
Designing and developing a prototype AR-based maintenance support system for a public transport context. AR technology can n enhance maintenance operations by enabling authorised personnel to visualise fault locations, overlay contextual information onto physical infrastructure, and collaborate securely in real time

## User logins for testing:
| Username       | Password   | Role       | Tool IDs Assigned | Fault IDs Assigned |
| -------------- | ---------- | ---------- | ----------------- | ------------------ |
| j.smith_sup    | J@Sm!th1   | Supervisor | 26                | —                  |
| a.davis_tech   | A@Dav!s2   | Technician | 5, 11, 20         | 10                 |
| e.carter_sup   | E@Cart!er3 | Supervisor | —                 | —                  |
| j.walker_sup   | J@Walk!er4 | Supervisor | —                 | —                  |
| o.brown_tech   | O@Br0wn5   | Technician | 6                 | 5, 11              |
| s.taylor_tech  | S@Tayl0r6  | Technician | 15, 31            | 8, 12              |
| j.wilson_tech  | J@W!ls0n7  | Technician | 2                 | 3, 13              |
| o.johnson_tech | O@J0hns0n8 | Technician | 8, 23             | 2                  |
| h.evans_tech   | H@Ev@ns9   | Technician | 10                | 6                  |
| a.thomas_tech  | A@Th0mas1  | Technician | 9, 25             | 21                 |
| g.clarke_tech  | G@Cl@rke2  | Technician | 17                | 1, 9               |
| i.roberts_tech | I@R0berts3 | Technician | 3, 29             | 7                  |
| t.hughes_tech  | T@Hughes4  | Technician | 27                | 22                 |
| m.lewis_tech   | M@Lew!s5   | Technician | 13, 22            | 14                 |
| n.young_tech   | N@Y0ung6   | Technician | 21, 24            | —                  |


### 🛠️ Available Tools (Unassigned)
These tools are currently marked as "Available" in the system and are not checked out by any technician:
* **Marker IDs:** `1`, `4`, `7`, `12`, `14`, `16`, `18`, `19`, `28`, `30`

### ⚠️ Unassigned Faults (Pending Action)
These faults have been logged in the system but have not yet been assigned to a technician (`assigned_to_id: null`):
* **Active (New/Unassigned):** Marker IDs `4`, `19`, `20`, `23`
* **In-Review (Awaiting Supervisor Action):** Marker IDs `15`, `16`, `17`, `18`