// ═════════════════════════════════════════════════════════════════════════════
// obs-stations.js — LA liste des stations de mesure du vent meteo.nc
// ═════════════════════════════════════════════════════════════════════════════
// Script CLASSIQUE (pas de module ES), chargé avant les blocs inline qui la lisent.
//
// Extraite de previsions.html le 23/11/2026 parce qu'accueil.html en a besoin
// pour la fiche de sortie (dernière mesure de vent près du spot). Une seconde
// copie aurait divergé : l'id de la station de Ténia a déjà dû être migré
// (9881836 → 9880904) une fois, et l'autre copie l'aurait ignoré.
//
// Deux identifiants par station, et ce n'est pas une redondance :
//   · `id`     = l'identifiant INSEE attendu par l'API /observation/history ;
//   · `spotId` = celui que les spots portent dans leur champ `obsId`.
// Les deux coïncident presque partout, SAUF Bourake (id 98802003, spotId
// 9880904) et Phare Amédée (98818002 / 9881836). Un lecteur qui n'en teste
// qu'un seul rate ces deux stations-là — et ce sont justement celles de six
// des huit spots par défaut.

// Stations observations vent meteo.nc
// URL: /observation/history?lat=LAT&lon=LON&id=ID
var OBS_STATIONS = [
  // Source officielle : Drupal JSON meteo.nc/fr/observations
  // insee = id API (vérifié sur Koumac, Koné, Bourake, Pouébo, Yaté)
  // ── Grand Sud / Nouméa ───────────────────────────────────────────────────
  { name:'Phare Amédée',        id:'98818002', spotId:'9881836',  lat:-22.4783, lon:166.480,  meteoUrl:'https://meteo.nc/fr/observations/phare-amedee-noumea' }, // id 98818003 = capteur sans vent ; 98818002 = relevé vent réel
  { name:'Nouméa',              id:'98818001', spotId:'98818001', lat:-22.276,  lon:166.350,  meteoUrl:'https://meteo.nc/fr/observations/noumea' },
  { name:'Yaté',                id:'98832002', spotId:'98832002', lat:-22.1565, lon:167.100, dlat:-22.156, dlon:166.940,  meteoUrl:'https://meteo.nc/fr/observations/yate' }, // API: lon=167.1 (lagon); dlat/dlon = position carte
  { name:'Montagne des Sources',id:'98832004', spotId:'98832004', lat:-22.1438, lon:166.610,  meteoUrl:'https://meteo.nc/fr/observations/montagne-des-sources-yate' },
  { name:'Moue (Île des Pins)', id:'98809001', spotId:'98809001', lat:-22.5898, lon:167.452,  meteoUrl:'https://meteo.nc/fr/observations/moue-ile-des-pins' },
  // ── Côte Ouest ────────────────────────────────────────────────────────────
  { name:'La Tontouta',         id:'98821001', spotId:'98821001', lat:-22.0173, lon:166.222,  meteoUrl:'https://meteo.nc/fr/observations/la-tontouta-paita' },
  { name:'Bourake (Boulouparis)',id:'98802003', spotId:'9880904', lat:-21.850,  lon:166.000,  meteoUrl:'https://meteo.nc/fr/observations/bourake-boulouparis' },
  { name:'Poé (Bourail)',       id:'98803005', spotId:'98803005', lat:-21.608,  lon:165.400,  meteoUrl:'https://meteo.nc/fr/observations/poe-bourail' },
  { name:'Népoui (Poya)',       id:'98827002', spotId:'98827002', lat:-21.3182, lon:165.002,  meteoUrl:'https://meteo.nc/fr/observations/nepoui-poya' },
  { name:'Koné',                id:'98811001', spotId:'98811001', lat:-21.0513, lon:164.833,  meteoUrl:'https://meteo.nc/fr/observations/kone' },
  { name:'Koumac',              id:'98812001', spotId:'98812001', lat:-20.5587, lon:164.284,  meteoUrl:'https://meteo.nc/fr/observations/koumac' },
  { name:'Poingam (Poum)',      id:'98826002', spotId:'98826002', lat:-20.0812, lon:164.031,  meteoUrl:'https://meteo.nc/fr/observations/poingam-poum' },
  { name:'Bélep',               id:'98801001', spotId:'98801001', lat:-19.7198, lon:163.661,  meteoUrl:'https://meteo.nc/fr/observations/belep' },
  // ── Côte Est ──────────────────────────────────────────────────────────────
  { name:'Borindi (Thio)',      id:'98829003', spotId:'98829003', lat:-21.7963, lon:166.492,  meteoUrl:'https://meteo.nc/fr/observations/borindi-thio' },
  { name:'Canala',              id:'98804001', spotId:'98804001', lat:-21.5263, lon:165.969,  meteoUrl:'https://meteo.nc/fr/observations/canala' },
  { name:'Houaïlou',            id:'98808001', spotId:'98808001', lat:-21.2783, lon:165.628,  meteoUrl:'https://meteo.nc/fr/observations/houailou' },
  { name:'Aoupinie (Ponérihouen)',id:'98823002',spotId:'98823002',lat:-21.1782, lon:165.285,  meteoUrl:'https://meteo.nc/fr/observations/aoupinie-ponerihouen' },
  { name:'Touho',               id:'98830002', spotId:'98830002', lat:-20.7893, lon:165.255,  meteoUrl:'https://meteo.nc/fr/observations/touho' },
  { name:'Hienghène',           id:'98807001', spotId:'98807001', lat:-20.6883, lon:164.949,  meteoUrl:'https://meteo.nc/fr/observations/hienghene' },
  { name:'Pouébo',              id:'98824001', spotId:'98824001', lat:-20.3832, lon:164.568,  meteoUrl:'https://meteo.nc/fr/observations/pouebo' },
  // ── Îles Loyauté ──────────────────────────────────────────────────────────
  { name:'Ouanaham (Lifou)',    id:'98814001', spotId:'98814001', lat:-20.7777, lon:167.241,  meteoUrl:'https://meteo.nc/fr/observations/ouanaham-lifou' },
  { name:'La Roche (Maré)',     id:'98815001', spotId:'98815001', lat:-21.4815, lon:168.036,  meteoUrl:'https://meteo.nc/fr/observations/la-roche-mare' },
  { name:'Ouloup (Ouvéa)',      id:'98820001', spotId:'98820001', lat:-20.6392, lon:166.571,  meteoUrl:'https://meteo.nc/fr/observations/ouloup-ouvea' },
];

// Distance en degrés — suffisant pour classer des stations à l'échelle de la
// Nouvelle-Calédonie, et c'est la règle qui servait déjà dans previsions.html.
// Surtout : UNE SEULE règle, pour que les deux pages désignent la même station.
function obsStationDist(st, lat, lon){
  return Math.sqrt(Math.pow(st.lat - lat, 2) + Math.pow(st.lon - lon, 2));
}

function obsStationNearest(lat, lon){
  var best = OBS_STATIONS[0], bd = Infinity;
  for (var i = 0; i < OBS_STATIONS.length; i++){
    var d = obsStationDist(OBS_STATIONS[i], lat, lon);
    if (d < bd){ bd = d; best = OBS_STATIONS[i]; }
  }
  return best;
}

// La station D'UN SPOT. Le réglage du spot (`obsId`) PRIME toujours sur la
// distance : Passe de Dumbéa est rattachée au Phare Amédée par choix, bien que
// la station de Nouméa soit plus proche — le phare est au vent du lagon, la
// ville est abritée. Règle posée au chantier du widget global, qui avait commencé
// par une garde de distance : elle désignait Nouméa et donnait un vent faux.
function obsStationForSpot(sp){
  if (!sp) return null;
  if (sp.obsId){
    for (var i = 0; i < OBS_STATIONS.length; i++){
      if (OBS_STATIONS[i].spotId === sp.obsId || OBS_STATIONS[i].id === sp.obsId) return OBS_STATIONS[i];
    }
  }
  if (typeof sp.lat !== 'number' || typeof sp.lon !== 'number') return null;
  return obsStationNearest(sp.lat, sp.lon);
}
