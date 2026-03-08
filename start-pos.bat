@echo off
setlocal
set FRONT_PORT=5174
set BACK_PORT=8787

cd /d "%~dp0"

echo ==========================================
echo   Sistema Punto de Venta - Inicio Rapido
echo ==========================================

echo Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js desde: https://nodejs.org/
  pause
  exit /b 1
)

echo Verificando npm...
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible en PATH.
  pause
  exit /b 1
)

echo Liberando puertos si estan en uso...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%FRONT_PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%BACK_PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>nul
)

if not exist "node_modules" (
  echo Instalando dependencias de la raiz...
  call npm install
)

if not exist "frontend\node_modules" (
  echo Instalando dependencias del frontend...
  call npm --prefix frontend install
)

if not exist "backend\node_modules" (
  echo Instalando dependencias del backend...
  call npm --prefix backend install
)

echo Iniciando backend + frontend en una sola ventana...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 7; Start-Process 'http://localhost:%FRONT_PORT%'"

echo.
echo URL esperada: http://localhost:%FRONT_PORT%
echo Para detener todo, presiona Ctrl + C en esta misma ventana.
echo.

call npm run dev:full
