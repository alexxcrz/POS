@echo off
setlocal EnableExtensions

title POS - Git Push rapido
cd /d "%~dp0"

set "LOG_FILE=%~dp0git-push.log"
echo ==== Inicio %DATE% %TIME% ==== > "%LOG_FILE%"

echo.
echo ======================================
echo   POS - Commit y Push automatico
echo ======================================
echo Carpeta actual: %CD%
echo Log: %LOG_FILE%
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git no esta instalado o no esta en PATH.
  goto :fail
)

git rev-parse --is-inside-work-tree 1>>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo ERROR: Esta carpeta no es un repositorio Git.
  goto :fail
)

set /p COMMIT_MSG=Escribe la descripcion del commit y presiona Enter: 
if "%COMMIT_MSG%"=="" (
  echo.
  echo Cancelado: no escribiste descripcion de commit.
  goto :end_ok
)

echo.
echo Agregando cambios...
git add -A 1>>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo ERROR: Fallo git add. Revisa git-push.log.
  goto :fail
)

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No hay cambios para commitear.
  goto :end_ok
)

for /f %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" set "BRANCH=main"
if "%BRANCH%"=="HEAD" set "BRANCH=main"

git remote get-url origin 1>>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo.
  echo No existe remoto "origin" configurado.
  set /p REMOTE_URL=Escribe la URL de tu repositorio ^(https://... o git@...^): 
  if "%REMOTE_URL%"=="" (
    echo ERROR: No se proporciono URL de remoto.
    goto :fail
  )

  git remote add origin "%REMOTE_URL%" 1>>"%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo ERROR: No se pudo agregar el remoto origin. Revisa git-push.log.
    goto :fail
  )
)

echo.
echo Creando commit...
git commit -m "%COMMIT_MSG%" 1>>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo ERROR: Fallo git commit. Revisa git-push.log.
  echo Tip: verifica que tengas configurado user.name y user.email en Git.
  goto :fail
)

echo.
echo Haciendo push a origin/%BRANCH% ...
git push -u origin %BRANCH% 1>>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo ERROR: Fallo git push. Revisa git-push.log para el detalle.
  goto :fail
)

echo.
echo Listo: commit y push completados correctamente.
goto :end_ok

:fail
echo.
echo ----- Ultimas lineas del log -----
powershell -NoProfile -Command "if (Test-Path '%LOG_FILE%') { Get-Content '%LOG_FILE%' -Tail 20 }"
echo -----------------------------------
echo.
pause
exit /b 1

:end_ok
echo.
pause
exit /b 0
