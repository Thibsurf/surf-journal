-- ═══════════════════════════════════════════════════════════════════════════
-- Corrections de DONNÉES du journal de sessions — audit du 14/08/2026
-- À exécuter dans l'éditeur SQL du dashboard Supabase (la clé anon n'a aucun
-- droit d'écriture sur ces lignes : policy « Users manage own sessions »
-- auth.uid() = user_id, cf. le bloc DDL de index.html).
--
-- Chaque bloc est indépendant. Les blocs § A et § B sont sûrs (nettoyage sans
-- perte). Le § C demande une décision de ta part et est LAISSÉ EN COMMENTAIRE.
--
-- Toujours commencer par le SELECT de contrôle qui précède chaque UPDATE : il
-- montre exactement les lignes visées avant de les toucher.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- § A. Ligne décalée d'un champ — 23/03/2025, Gros nem
--      id = 3ab49844-9340-4ec6-8b9f-25345754cedb
--
--   hs           = 12              → une houle de 12 m à Gros nem (lue 1,2)
--   launch_point = '1,1m'          → une hauteur de marée dans le champ Lieu
--   swell_dir    = '5nds (GLASSY)' → une vitesse de vent dans le champ Direction
--   wind_dir     = '0,79m'         → une hauteur de marée dans le champ Direction
--   moves        = {tube,tube}     → doublon (tube_count = 2 porte déjà l'info)
--
-- Effet mesuré avant correction : fiche spot Gros nem à Hs moy. 1,68 m au lieu
-- de 1,14 m, et une branche plein Nord dans la rose des houles.
-- Les valeurs ci-dessous reprennent CE QUI EST DÉJÀ DANS LA LIGNE, remis dans le
-- bon champ. Rien n'est inventé : launch_point et swell_dir, dont la vraie
-- valeur est inconnue, passent à NULL plutôt que de recevoir une supposition.
-- ───────────────────────────────────────────────────────────────────────────
select id, date, spot, hs, period, launch_point, swell_dir, wind_kts, wind_dir, tide, moves, observations
  from sessions where id = '3ab49844-9340-4ec6-8b9f-25345754cedb';

update sessions set
  hs           = 1.2,            -- 12 → 1,2 m (« petits tubes » dans les observations)
  tide         = '1,1m – 0,79m', -- les deux valeurs de marée récupérées des champs voisins
  wind_kts     = 5,              -- extrait de '5nds (GLASSY)'
  wind_dir     = 'Glassy',       -- idem
  swell_dir    = null,           -- inconnue (ne pas deviner)
  launch_point = null,           -- inconnu (ne pas deviner)
  moves        = '{tube}'
where id = '3ab49844-9340-4ec6-8b9f-25345754cedb';

-- ───────────────────────────────────────────────────────────────────────────
-- § B. Nettoyage de vocabulaire (aucune information perdue)
-- ───────────────────────────────────────────────────────────────────────────

-- B1. « Droite de dumbéa » et « Droite de Dumbéa » comptaient comme DEUX spots
--     dans le top 7 des stats et dans la page Spots.
select id, date, spot, spots from sessions
 where spot ilike '%droite de dumbéa%' or array_to_string(spots, '|') ilike '%droite de dumbéa%';

update sessions set spot  = replace(spot, 'Droite de dumbéa', 'Droite de Dumbéa')
 where spot like '%Droite de dumbéa%';
update sessions set spots = array_replace(spots, 'Droite de dumbéa', 'Droite de Dumbéa')
 where 'Droite de dumbéa' = any(spots);

-- B2. Points de mise à l'eau : casse et variantes
update sessions set launch_point = 'Port Ouenghi' where launch_point = 'Port ouenghi';
update sessions set launch_point = 'Ténia'        where launch_point = 'Ilot Ténia';

-- B3. Marqueurs « vide » saisis à la main → NULL (le formulaire, lui, écrit
--     déjà NULL ; ces valeurs viennent des saisies anciennes)
update sessions set launch_point = null where launch_point in ('∅', '');
update sessions set context      = null where context      in ('--', '');
update sessions set wind_dir     = null where wind_dir     in ('∅', '?');

-- B4. Marée « 0, 62m » (06/06/2025) : l'espace après la virgule cassait le
--     nombre et le spot héritait d'un « niveau idéal » de 0,00 m. Le code sait
--     désormais recoller ce cas, mais autant assainir la donnée.
update sessions set tide = '0,62m' where tide = '0, 62m';

-- ───────────────────────────────────────────────────────────────────────────
-- § C. DÉCISIONS À PRENDRE — laissé en commentaire, rien ne s'exécute
-- ───────────────────────────────────────────────────────────────────────────

-- C1. Cardinal et degrés se contredisent sur 3 lignes. Le code retient le
--     NOMBRE : « E (195°) » part donc plein Sud dans les graphes. Impossible de
--     savoir laquelle des deux moitiés est juste — à toi de trancher, ligne par
--     ligne (le SELECT te donne le contexte : spot, houle, saison).
select date, spot, wind_dir, wind_kts, swell_dir, observations from sessions
 where wind_dir in ('E (195°)', 'SSO (20°)', 'S (229°)') order by date;

-- -- variante « les degrés sont bons, le cardinal est mal saisi » :
-- update sessions set wind_dir = 'S (195°)'   where wind_dir = 'E (195°)';    -- 10/04/2025
-- update sessions set wind_dir = 'NNE (20°)'  where wind_dir = 'SSO (20°)';   -- 18/04/2026
-- update sessions set wind_dir = 'SO (229°)'  where wind_dir = 'S (229°)';    -- 19/04/2026
--
-- -- variante « le cardinal est bon, le nombre est une coquille » :
-- update sessions set wind_dir = 'E'   where wind_dir = 'E (195°)';
-- update sessions set wind_dir = 'SSO' where wind_dir = 'SSO (20°)';
-- update sessions set wind_dir = 'S'   where wind_dir = 'S (229°)';

-- C2. Vents de sept.→nov. 2024 : 0,9 / 1,6 / 1,7 / 1,8 / 1,4 / 1,6 nds sur 6
--     sessions consécutives (moyenne 2,73 nds, contre 7,36 en 2026). Cohérent
--     avec une saisie en m/s (meteo.nc observation donne des m/s), mais ça reste
--     une hypothèse : 6 sessions glassy d'affilée en début de saison sont
--     possibles. Si tu confirmes le m/s, la conversion est ×1,944 :
select date, spot, wind_kts, wind_dir, observations from sessions
 where wind_kts > 0 and wind_kts < 2 order by date;
--
-- update sessions set wind_kts = round((wind_kts * 1.944)::numeric, 1)
--  where date < '2024-12-01' and wind_kts > 0 and wind_kts < 2;

-- C3. Prénoms du crew en double : « Andréas »/« Andreas », « Seb »/« Sebastian »,
--     « Romain »/« Romain Calblock ». À fusionner de préférence depuis l'appli
--     (onglet Crew → ✏️, qui relit shared_with avant d'écrire et gère le
--     multi-appareils), pas en SQL.
select unnest(shared_with) as prenom, count(*) from sessions group by 1 order by 2 desc;
