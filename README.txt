================================================================================
                    C H E V R O N N E X U S
    Secure Local Media Share & Home Theater Portal
================================================================================

ChevronNexus is a high-performance, completely offline local Wi-Fi sharing 
network and media streaming portal. It allows users connected to the same 
network to share photos, videos, and stream movies at gigabit speeds without 
cellular data consumption or cloud tracking.

--------------------------------------------------------------------------------
1. CORE FEATURES
--------------------------------------------------------------------------------

* Expanded User Registration:
  New users register their Full Name, Device Name, and Security Key (password).
  Upon completion, the dashboard displays their custom name in a personalized
  traveler greeting and registers their device IP.

* Device-Isolated Workspaces (Sandboxing):
  Uploads are segregated by client IP into safe directories (e.g. 
  uploads/192_168_1_50/). Clients can only see, download, or delete files 
  uploaded from their own device, keeping individual workspaces private and 
  clutter-free.

* Dedicated Home Theater Portal: 
  A dedicated movie dashboard scans the local /Movie folder, rendering cinematic
  cards with search controls, sorting filters, and simulated HDR10.
  Includes:
    - Summon Film Portal: Film dropzone supporting large uploads (up to 10 GB).
    - Movie Downloader: Direct card-level downloads of raw files with original name headers.

* Immersion Video Player: 
  Custom-designed HTML5 media streaming player featuring:
    - Skip Forward/Backward (10s) controls.
    - Simulated "HDR Boost" (dynamic rendering filters).
    - Playback Speed Adjuster (0.5x - 2.0x).
    - Auto-hiding control panel when mouse is idle.
    - Range-seekable streaming engine.

--------------------------------------------------------------------------------
2. PREMIUM AESTHETIC & THEMES
--------------------------------------------------------------------------------

The application features three distinct design spaces built with pure HTML, 
Vanilla CSS, and Vanilla JavaScript (with no external internet CDN requirements):

* Landing Page (Antigravity IDE Theme):
  - A sleek developer-focused login portal mimicking Google's Antigravity IDE.
  - Features an expanded "About Section" card displaying Wi-Fi Gigabit sharing,
    SQLite credentials isolation, Movie Center uploads, and Device sandboxes.
  - Interactive login card with neon cyan scanning borders and cyber corners.

* Files Hub Dashboard (Genshin Impact Theme):
  - Golden/Amber cinematic theme with historical elegance.
  - Users are welcomed as "Travelers" using their registered Full Name.
  - Dynamic artifact-style grid cards for media items. 
  - Dynamic Anemo Cyan (✨) and Pyro Red (🔥) glyph badges represent photos and 
    videos respectively.
  - Summon Portal Dropzone for dragging/dropping uploads.

* Home Theater (Dark Theme):
  - Deep black layout with red accents.
  - Fast search filters, uploader queue progress bars, and poster grids (2/3 scale).

--------------------------------------------------------------------------------
3. IMMERSIVE CUSTOM CURSOR FOLLOW-LAG ANIMATIONS
--------------------------------------------------------------------------------

To make the app feel alive and premium, a custom pointer-following circle lag-ring
animates dynamically across all pages, synced to match the current color theme:
  * Landing page: Cyan ring (#00f0ff) expanding with a purple glow.
  * Files Hub dashboard: Gold ring (#ecc065) expanding with a white glow.
  * Home Theater page: Red ring (#e50914) expanding on poster cards.
  * Sizing is handled using event delegation to seamlessly apply hover-expansion 
    states to dynamically loaded elements.

--------------------------------------------------------------------------------
4. TECH STACK
--------------------------------------------------------------------------------

* Backend: Python 3, Flask, SQLite3
* Frontend: HTML5, CSS3 (Vanilla), Vanilla JS (No Tailwind or CDNs for offline work)
* Utility: qrcode.js (for easy mobile phone connection QR code scans)

--------------------------------------------------------------------------------
5. QUICK START INSTRUCTIONS
--------------------------------------------------------------------------------

1. Place your media files:
   - Place shared photos/videos in the 'uploads/<device_ip>/' directory (created automatically).
   - Place movie files (MP4, MKV, WebM) in the 'Movie/' directory.

2. Start the Server:
   - Double-click 'start.bat' on your Windows machine.
   - The script checks your environment, installs missing dependencies (Flask),
     and initiates the server.

3. Connect to ChevronNexus:
   - Local access on host machine: http://localhost:80 (or http://localhost:5000 if port 80 is occupied)
   - Network access from other devices on the same Wi-Fi: 
     Access using the server IP address displayed in the console terminal output
     (e.g., http://192.168.1.X) or scan the connection QR code shown on the
     Files Hub page.
