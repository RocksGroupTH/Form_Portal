@echo off
setlocal EnableExtensions

rem Form Portal deploy. This is NOT the Rocks Fast script -- every value below
rem differs from that one, and running theirs against this app is what produces
rem a 502: it cd's into fast.rocksgroup.com, checks out `main` (this repo has no
rem `main`, only `master`, so it fails there and exits), drives a PM2 process
rem called `fast`, and health-checks port 3020. Form Portal is `master`,
rem `form-portal`, and port 3081.
rem
rem SITE_DIR is the IIS site root for form.portal.rocksgroup.com. Change it here
rem if the site lives somewhere else on the host -- it is the one value that
rem cannot be read out of the repo.
set "SITE_DIR=C:\inetpub\form.portal.rocksgroup.com"
set "APP_NAME=form-portal"
set "APP_PORT=3081"
set "BRANCH=master"

rem The host's PM2 already carries an entry called `form.portal` (a dot), created
rem before ecosystem.config.cjs existed -- that file declares `form-portal` (a
rem hyphen). Deleting only one name leaves the other registered, so `pm2 list`
rem grows a second, permanently stopped row and `pm2 save` persists it. Both
rem names are cleaned up below; `form-portal` from the ecosystem file is the one
rem that survives.
set "LEGACY_NAME=form.portal"

cd /d "%SITE_DIR%" || goto :nodir

if not exist logs mkdir logs

echo [deploy] sync to origin/%BRANCH%...
git fetch origin || goto :fail
git checkout %BRANCH% || goto :fail
git reset --hard origin/%BRANCH% || goto :fail

echo [deploy] stop app (brief downtime)...
call pm2 stop %APP_NAME% 2>nul
call pm2 stop %LEGACY_NAME% 2>nul

echo [deploy] install deps...
call npm ci || goto :recover

echo [deploy] build...
call npm run build || goto :recover

echo [deploy] start app...
call pm2 delete %APP_NAME% 2>nul
call pm2 delete %LEGACY_NAME% 2>nul
call pm2 start ecosystem.config.cjs --update-env || goto :recover

call pm2 save

echo [deploy] waiting for health check...
timeout /t 5 /nobreak >nul
curl -sf http://127.0.0.1:%APP_PORT%/api/health >nul
if errorlevel 1 (
  echo [deploy] WARN: health check failed on 127.0.0.1:%APP_PORT% - see pm2 logs %APP_NAME%
  echo [deploy] If PM2 says the app is online but this still fails, the app is
  echo [deploy] listening on a different port than IIS/ARR proxies to.
  call pm2 logs %APP_NAME% --lines 40 --nostream
  exit /b 1
)

echo [deploy] DONE - app is healthy on :%APP_PORT%
exit /b 0

:recover
echo [deploy] FAILED during install/build - attempting to bring the app back...
if exist .next (
  call pm2 delete %APP_NAME% 2>nul
  call pm2 delete %LEGACY_NAME% 2>nul
  call pm2 start ecosystem.config.cjs --update-env
  call pm2 save
  echo [deploy] App restart attempted. Check: pm2 logs %APP_NAME%
) else (
  echo [deploy] No .next build output - cannot restart. Fix build errors first.
)
exit /b 1

:fail
echo [deploy] FAILED before the app was stopped - old version may still be serving.
exit /b 1

:nodir
echo [deploy] FAILED - %SITE_DIR% does not exist. Set SITE_DIR at the top of this file.
exit /b 1
