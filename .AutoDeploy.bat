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

rem ecosystem.config.cjs points PM2 at this file directly rather than at `npm`
rem or `next` (spawning a .cmd throws EINVAL on recent Node). `npm ci` deletes
rem node_modules wholesale before reinstalling, so a failed install leaves this
rem path missing while .next survives from the previous build. Starting PM2 in
rem that state spawns node against a script that is not there, burns
rem max_restarts, and lands the process in `errored` with 0b memory -- which
rem `pm2 save` then persists. Every start below is guarded on it.
set "NEXT_BIN=node_modules\next\dist\bin\next"

cd /d "%SITE_DIR%" || goto :nodir

if not exist logs mkdir logs

rem src/env.ts validates the whole environment at import, so a missing
rem .env.local crashes the app at startup rather than at first use. The file is
rem gitignored, so the `git reset --hard` below never restores it. Warn rather
rem than fail: the host may supply the environment some other way.
if not exist ".env.local" (
  echo [deploy] WARN: .env.local not found in %SITE_DIR%.
  echo [deploy] If the environment is not supplied another way, the app will
  echo [deploy] crash on start before it ever listens on :%APP_PORT%.
)

echo [deploy] sync to origin/%BRANCH%...
git fetch origin || goto :fail
git checkout %BRANCH% || goto :fail
git reset --hard origin/%BRANCH% || goto :fail

echo [deploy] stop app (brief downtime)...
rem The stop has to come before npm ci and npm run build. On Windows the running
rem process holds files under node_modules and .next open, so installing or
rem building underneath it fails on locked files. The downtime is the price of
rem that, which is why the recovery path below refuses to start a broken tree.
call pm2 stop %APP_NAME% 2>nul
call pm2 stop %LEGACY_NAME% 2>nul

echo [deploy] install deps...
call npm ci || goto :recover

if not exist "%NEXT_BIN%" (
  echo [deploy] npm ci exited 0 but %NEXT_BIN% is missing.
  goto :recover
)

echo [deploy] build...
call npm run build || goto :recover

echo [deploy] start app...
call pm2 delete %APP_NAME% 2>nul
call pm2 delete %LEGACY_NAME% 2>nul
call pm2 start ecosystem.config.cjs --update-env || goto :recover

call pm2 save

echo [deploy] waiting for health check...
rem A single 5s wait was too short on a host running a dozen Node apps at 82 percent
rem RAM -- a healthy app reported as a failed deploy. Poll instead, up to 60s,
rem and warn only once every attempt has failed. `if defined` is evaluated at
rem execution time, so this needs no delayed expansion.
set "HEALTH_OK="
for /l %%i in (1,1,12) do (
  if not defined HEALTH_OK (
    timeout /t 5 /nobreak >nul
    curl -sf http://127.0.0.1:%APP_PORT%/api/health >nul && set "HEALTH_OK=1"
  )
)
if not defined HEALTH_OK goto :unhealthy

echo [deploy] DONE - app is healthy on :%APP_PORT%
exit /b 0

:unhealthy
echo [deploy] WARN: health check failed on 127.0.0.1:%APP_PORT% after 60s.
echo [deploy] If PM2 says the app is online but this still fails, the app is
echo [deploy] listening on a different port than IIS/ARR proxies to.
call pm2 describe %APP_NAME%
call pm2 logs %APP_NAME% --lines 40 --nostream
exit /b 1

:recover
echo [deploy] FAILED during install/build - attempting to bring the app back...
rem Both halves must be present. Guarding on .next alone is what produced the
rem crash loop described at NEXT_BIN above: .next survives a failed npm ci, so
rem the guard passed and PM2 was told to start a script that no longer existed.
if not exist "%NEXT_BIN%" goto :norecover
if not exist ".next" goto :norecover
call pm2 delete %APP_NAME% 2>nul
call pm2 delete %LEGACY_NAME% 2>nul
call pm2 start ecosystem.config.cjs --update-env
call pm2 save
echo [deploy] App restart attempted. Check: pm2 logs %APP_NAME%
exit /b 1

:norecover
echo [deploy] Cannot restart - leaving the app stopped rather than crash-looping.
if not exist "%NEXT_BIN%" echo [deploy]   missing: %NEXT_BIN%   ^(fix: npm ci^)
if not exist ".next"      echo [deploy]   missing: .next   ^(fix: npm run build^)
echo [deploy] Fix the above, then re-run this script.
exit /b 1

:fail
echo [deploy] FAILED before the app was stopped - old version may still be serving.
exit /b 1

:nodir
echo [deploy] FAILED - %SITE_DIR% does not exist. Set SITE_DIR at the top of this file.
exit /b 1
