@echo off
cd /d "C:\Users\goret\OneDrive\Рабочий стол\Dashboard Charity"
if not exist ".local" mkdir ".local"
node scripts\dispatch-sber-sync.mjs >> ".local\dispatch.log" 2>&1
