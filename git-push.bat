@echo off
setlocal

title POS - Git Push rapido

echo.
echo ======================================
echo   POS - Commit y Push automatico
echo ======================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git no esta instalado o no esta en PATH.
  echo.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo ERROR: Esta carpeta no es un repositorio Git.
  echo.
  pause
  exit /b 1
)

set /p COMMIT_MSG=Escribe la descripcion del commit y presiona Enter: 
if "%COMMIT_MSG%"=="" (
  echo.
  echo Cancelado: no escribiste descripcion de commit.
  echo.
  pause
  exit /b 1
)

echo.
echo Agregando cambios...
git add -A
if errorlevel 1 (
  echo ERROR: Fallo git add.
  echo.
  pause
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No hay cambios para commitear.
  echo.
  pause
  exit /b 0
)

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
if "%BRANCH%"=="" set BRANCH=main

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo.
  echo No existe remoto "origin" configurado.
  set /p REMOTE_URL=Escribe la URL de tu repositorio (https://... o git@...): 
  if "%REMOTE_URL%"=="" (
    echo ERROR: No se proporciono URL de remoto.
    echo.
    pause
    exit /b 1
  )

  git remote add origin "%REMOTE_URL%"
  if errorlevel 1 (
    echo ERROR: No se pudo agregar el remoto origin.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Creando commit...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo ERROR: Fallo git commit.
  echo.
  pause
  exit /b 1
)

echo.
echo Haciendo push a origin/%BRANCH% ...
git push -u origin %BRANCH%
if errorlevel 1 (
  echo ERROR: Fallo git push. Revisa credenciales, rama remota o conexion.
  echo.
  pause
  exit /b 1
)

echo.
echo Listo: commit y push completados correctamente.
echo.
pause
exit /b 0
