@echo off
REM ============================================================================
REM  lotus-local.cmd  --  alimente LOTUS depuis CE poste.
REM
REM  POURQUOI CE FICHIER EXISTE. Surfline refuse les IP de datacenter. Mesuré :
REM    - depuis une connexion residentielle  -> 200, 5 spots x 7 jours
REM    - depuis un runner GitHub Actions     -> 403 en 0,14 s, des la 1re tentative
REM    - depuis l'egress Cloudflare (Worker) -> 403 aussi (teste le 21/11/2026)
REM  Le code d'ingestion, lui, marche parfaitement. Il ne manque qu'une IP
REM  residentielle -- celle de cette machine. Aucun secret n'est necessaire :
REM  fetch_surfline.py ecrit avec la cle Supabase anon, qui est publique.
REM
REM  USAGE MANUEL : double-cliquer. Comptez une vingtaine de secondes.
REM
REM  POUR L'AUTOMATISER (facultatif) : coller cette ligne dans une invite de
REM  commandes Windows. Elle cree une tache planifiee qui lance ce script tous
REM  les jours a 7h00 et a 18h00, uniquement quand le PC est allume.
REM
REM    schtasks /create /tn "LOTUS surf NC" /sc daily /st 07:00 /ri 660 /du 12:00 ^
REM      /tr "\"%~f0\"" /f
REM
REM  Pour la supprimer :   schtasks /delete /tn "LOTUS surf NC" /f
REM  Pour la voir :        schtasks /query /tn "LOTUS surf NC"
REM ============================================================================

cd /d "%~dp0\.."
echo.
echo   Depot  : %CD%
echo   Lance  : ingestion/fetch_surfline.py
echo.

python ingestion\fetch_surfline.py
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo   Termine. Les donnees LOTUS sont ecrites dans Supabase et seront
  echo   visibles sur le site au prochain chargement.
) else (
  echo   ECHEC ^(code %RC%^). Causes possibles : pas de reseau, ou Surfline
  echo   a change son API. Le reste du site n'est pas affecte.
)
echo.
REM  Pas de pause quand la tache planifiee l'execute : on ne veut pas d'une
REM  fenetre qui reste ouverte indefiniment en arriere-plan.
if "%1"=="" pause
