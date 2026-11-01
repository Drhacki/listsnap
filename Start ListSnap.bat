@echo off
rem Starts ListSnap on this PC at http://localhost:8080 and opens it in the browser.
cd /d "%~dp0"
start "" http://localhost:8080
python -m http.server 8080 --bind 127.0.0.1
