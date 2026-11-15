@echo off
rem Starts Tucker Tally and restarts it a few seconds later if it ever stops by itself.
rem Used by the "start when I sign in" shortcut described in README.md.
rem (To stop it for good: close this window, or press Ctrl+C and answer Y.)
cd /d "%~dp0..\.."
title Tucker Tally
:again
node scripts\check-node.js && node server\index.js
echo.
echo Tucker Tally stopped. Starting again in 5 seconds (close this window to stop it)...
timeout /t 5 /nobreak >nul
goto again
