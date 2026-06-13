@echo off
title LocalDrop Media Server
cls

echo ==========================================================
echo               L O C A L D R O P   S E R V E R
echo ==========================================================
echo.
echo [INFO] Checking environment...

:: 1. Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in your system PATH.
    echo.
    echo To resolve this:
    echo 1. Download Python 3.8.10 (last version supporting Windows 7):
    echo    https://www.python.org/downloads/release/python-3810/
    echo 2. Run the installer and check the box that says:
    echo    "Add Python 3.8 to PATH" (CRITICAL)
    echo 3. Open a new window and double-click start.bat again.
    echo.
    pause
    exit /b
)

:: 2. Check if requirements are installed (to avoid pip fetching online unnecessarily)
python -c "import flask, werkzeug" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Flask or Werkzeug is missing. Installing dependencies...
    echo [NOTE] This first-time install requires internet access.
    echo.
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install dependencies.
        echo Please ensure this computer has internet access for the first startup.
        echo Once installed, the server will run 100%% offline.
        echo.
        pause
        exit /b
    )
)

:: 3. Create upload folder if not existing
if not exist uploads (
    mkdir uploads
)

echo [SUCCESS] Environment ready.
echo.
echo [INFO] Starting LocalDrop server. Access links will display below...
echo.

:: 4. Start the server
python app.py

pause
