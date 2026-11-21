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

REM  --- Le BON compte ? -------------------------------------------------------
REM  Pourquoi ce controle : le 21/11/2026, une connexion reussie a quand meme
REM  echoue au deploiement, parce que le compte connecte n'etait pas celui qui
REM  HEBERGE le worker. wrangler repondait "Authentication error [code: 10000]"
REM  puis deversait trente lignes de portees de jeton -- rien n'indiquait
REM  clairement qu'il fallait simplement changer de compte.
for /f "tokens=2 delims==" %%A in ('findstr /b /c:"account_id" wrangler.toml') do set ACC=%%A
set ACC=%ACC: =%
set ACC=%ACC:"=%
call npx wrangler whoami > "%TEMP%\cf_who.txt" 2>&1
findstr /c:"%ACC%" "%TEMP%\cf_who.txt" >nul
if errorlevel 1 (
  echo.
  echo   ARRET : tu es connecte au MAUVAIS compte Cloudflare.
  echo.
  echo     Compte attendu par wrangler.toml : %ACC%
  echo     Comptes de la session en cours :
  findstr /r /c:"[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]" "%TEMP%\cf_who.txt" | findstr /v "Scope"
  echo.
  echo   Le worker meteo-proxy-worker appartient au compte %ACC%,
  echo   pas a celui-ci. Rien n'a ete deploye, la version en ligne est intacte.
  echo.
  echo   Pour corriger :
  echo       npx wrangler logout
  echo       npx wrangler login
  echo   et choisir l'autre compte Cloudflare dans le navigateur
  echo   celui du sous-domaine thibault-dlh.workers.dev
  echo.
  pause
  exit /b 1
)
echo         Bon compte : %ACC%

echo.
echo   [2/3] Deploiement du Worker...
REM  --config OBLIGATOIRE. Sans lui, wrangler remonte d'un dossier et lit
REM  repo_git\wrangler.jsonc -- une config oubliee de mai 2026 pour un AUTRE
REM  worker ("surf-journal") qui publie tout le depot comme site statique.
REM  Constate le 21/11/2026 : il a tente d'envoyer 48 905 fichiers et s'est
REM  arrete sur la limite du plan gratuit. Le worker meteo n'etait pas deploye
REM  du tout, alors que rien dans la sortie ne disait clairement pourquoi.
call npx wrangler deploy --config wrangler.toml
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
