@echo off
REM scripts/start-dev.bat
REM Starts all AutoClipper services for local development.
REM Run this from the project root: scripts\start-dev.bat

echo.
echo ==================================================
echo  AutoClipper - Local Dev Startup
echo ==================================================
echo.

REM ── Check Redis ─────────────────────────────────────
echo [1/4] Checking Redis...
C:\laragon\bin\redis\redis-x64-5.0.14.1\redis-cli.exe ping >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  OK  Redis is running on port 6379
) else (
    echo  WARN Redis not responding. Starting Redis...
    start "Redis Server" "C:\laragon\bin\redis\redis-x64-5.0.14.1\redis-server.exe"
    timeout /t 2 /nobreak >nul
)

REM ── Check PostgreSQL ────────────────────────────────
echo [2/4] Checking PostgreSQL...
pg_isready -h localhost -p 5432 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  OK  PostgreSQL is running on port 5432
) else (
    echo  WARN PostgreSQL not detected on localhost:5432
    echo       Make sure PostgreSQL is running and DATABASE_URL in .env is correct.
    echo       Then run: npm run db:migrate
)

REM ── Run Prisma Migration ─────────────────────────────
echo [3/4] Running Prisma migrations...
call node_modules\.bin\prisma migrate deploy
if %ERRORLEVEL% NEQ 0 (
    echo  WARN Migration failed - check your DATABASE_URL in .env
) else (
    echo  OK  Database schema is up to date
)

REM ── Start Workers and Server ─────────────────────────
echo [4/4] Starting services...
echo.
echo  Starting Video Worker...
start "AutoClipper-VideoWorker" cmd /k "node src/workers/videoWorker.js"

echo  Starting Caption Worker...
start "AutoClipper-CaptionWorker" cmd /k "node src/workers/captionWorker.js"

echo  Starting API Server...
start "AutoClipper-APIServer" cmd /k "node src/app.js"

echo.
echo ==================================================
echo  All services started!
echo  API Server:     http://localhost:3000
echo  Health Check:   http://localhost:3000/health
echo ==================================================
echo.
