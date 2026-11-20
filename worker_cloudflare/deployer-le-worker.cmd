@echo off
REM ============================================================================
REM  deployer-le-worker.cmd  --  double-cliquer sur ce fichier, c'est tout.
REM
REM  POURQUOI CE SCRIPT : le deploiement du Worker se fait a la main (il n'est
REM  PAS couvert par le push GitHub, qui ne deploie que les pages). Et la
REM  commande demande de se placer dans ce dossier, dont le chemin contient des
REM  espaces et un accent -- taper le "cd" a la main rate une fois sur deux.
REM  Ce fichier se place tout seul dans son propre dossier (%~dp0).
REM
REM  CE QU'IL FAIT :
REM    1. verifie que tu es connecte a Cloudflare, et t'y connecte sinon
REM       (ouvre le navigateur, il suffit d'accepter)
REM    2. deploie worker.js
REM    3. teste les routes juste apres, pour que tu saches tout de suite si la
REM       route /surfline passe ou si Surfline refuse aussi Cloudflare
REM ============================================================================

cd /d "%~dp0"
echo.
echo   Dossier : %CD%
echo.

echo   [1/3] Verification de la connexion Cloudflare...
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo         Pas connecte. Ouverture du navigateur pour autoriser wrangler...
  call npx wrangler login
  if errorlevel 1 (
    echo.
    echo   ECHEC de la connexion. Rien n'a ete deploye.
    pause
    exit /b 1
  )
) else (
  echo         Deja connecte.
)

echo.
echo   [2/3] Deploiement du Worker...
call npx wrangler deploy
if errorlevel 1 (
  echo.
  echo   ECHEC du deploiement. L'ancienne version reste en ligne.
  pause
  exit /b 1
)

echo.
echo   [3/3] Test des routes, en direct...
echo.
set W=https://meteo-proxy-worker.thibault-dlh.workers.dev

echo   - /debug   (doit repondre ok:true)
curl -s --max-time 20 "%W%/debug"
echo.
echo.
echo   - /surfline  (LOTUS -- la question du jour)
curl -s -o "%TEMP%\sl.json" -w "    HTTP %%{http_code}  %%{size_download} octets" --max-time 30 "%W%/surfline?ep=forecasts/swells&spotId=5842041f4e65fad6a7708d70&days=3"
echo.
echo.
echo   Comment lire ce dernier resultat :
echo     HTTP 200 et plusieurs milliers d'octets  =  gagne, Cloudflare passe.
echo                                                 LOTUS repartira au prochain
echo                                                 passage du cron (3x/jour).
echo     HTTP 502  =  Surfline refuse aussi l'egress Cloudflare, comme
echo                  windguru.cz. Le job retombera en direct tout seul et rien
echo                  n'est casse -- mais il faudra un autre chemin pour LOTUS.
echo.
pause
