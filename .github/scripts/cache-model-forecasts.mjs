// Archive périodique des prévisions multi-modèles (GFS/BOM/MF/ECMWF) pour les
// spots prioritaires, dans model_forecast_cache — sans dépendre d'une visite
// manuelle de previsions.html (demandé par l'utilisateur : "ça suppose
// d'ouvrir toutes les pages météo, pas moyen d'automatiser un peu ça ?").
//
// Ne couvre PAS meteo.nc : ce modèle nécessite un token capturé côté
// navigateur (extension), pas reproductible ici sans risquer de casser ce
// mécanisme — il reste alimenté par les visites normales de l'app (déjà
// fonctionnel, cf. _saveForecastDays côté client).
//
// Logique de fetch/parsing calquée sur previsions.html (BOM THREDDS ASCII,
// Windguru iapi.php, Open-Meteo) pour rester cohérente avec ce que l'app
// affiche déjà — mêmes URLs, mêmes conventions d'ID que _cacheModelPoints().

const SUPABASE_URL = 'https://tiiptlozingmgzcnexpu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0';

// Spots prioritaires = DEFAULT_SPOTS de previsions.html (les points marins
// pré-configurés de l'app, pas les spots persos ajoutés par les utilisateurs).
const SPOTS = [
  { name: 'Passe de Dumbéa',  lat: -22.35, lon: 166.24 },
  { name: 'Ilot Ténia',       lat: -22.01, lon: 165.94 },
  { name: 'Passe de Boulari', lat: -22.50, lon: 166.44 },
  { name: 'Passe de Ouano',   lat: -21.91, lon: 165.75 },
  { name: 'Passe de Mato',    lat: -22.69, lon: 166.63 },
  { name: 'Îlot Maître',      lat: -22.36, lon: 166.38 },
  { name: 'Baie de Sainte Marie', lat: -22.29, lon: 166.46 },
];

const BOM_WW3_BASE = 'https://ocean-thredds01.spc.int/thredds/dodsC/POP/model/regional/bom/forecast/hourly/wavewatch3_latest/latest_merged.nc';

function wgIdForSpot(spot) {
  const n = spot.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('tenia')) return 6476;
  if (n.includes('dumbe')) return 208760;
  if (n.includes('ouano')) return 208762;
  if (n.includes('maitre')) return 207051;
  if (n.includes('poe')) return 208763;
  if (n.includes('vata')) return 208755;
  if (n.includes('noumea')) return 4164;
  return null;
}

async function fetchWithTimeout(url, ms = 15000, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, headers }); }
  finally { clearTimeout(t); }
}

// ── BOM WaveWatch3 (houle + vent, même flux THREDDS) ────────────────────
async function fetchBom(spot) {
  try {
    const latIdx = Math.max(0, Math.min(720, Math.round((45 - spot.lat) / 0.125)));
    const lonIdx = Math.max(0, Math.min(1600, Math.round((spot.lon - 100) / 0.125)));
    const dasR = await fetchWithTimeout(BOM_WW3_BASE + '.das');
    const dasText = await dasR.text();
    const epochM = dasText.match(/seconds since (\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (!epochM) throw new Error('epoch introuvable');
    const epochMs = Date.UTC(+epochM[1], +epochM[2] - 1, +epochM[3], +epochM[4], +epochM[5], +epochM[6]);
    const vars = ['sig_ht_sw1', 'pk_wav_per', 'mn_dir_sw1', 'wnd_spd', 'wnd_dir'];
    const url = BOM_WW3_BASE + '.ascii?time[0:1:80],' + vars.map(v =>
      `${v}[0:1:80][${latIdx}:1:${latIdx}][${lonIdx}:1:${lonIdx}]`
    ).join(',');
    const r = await fetchWithTimeout(url);
    const text = await r.text();
    function parseFlat(name) {
      const mm = text.match(new RegExp(name + '\\[\\d+\\]\\s*\\n([^\\n]+)'));
      return mm ? mm[1].split(',').map(s => parseFloat(s.trim())) : [];
    }
    function parseGrid(name) {
      const mm = text.match(new RegExp(name + '\\.' + name + '\\[\\d+\\]\\[1\\]\\[1\\]([\\s\\S]*?)(?:\\n\\n|$)'));
      if (!mm) return [];
      const out = [];
      const lineRe = /\[(\d+)\]\[0\],\s*([\-\d.]+)/g;
      let lm;
      while ((lm = lineRe.exec(mm[1]))) out[+lm[1]] = parseFloat(lm[2]);
      return out;
    }
    const times = parseFlat('time');
    const hs = parseGrid('sig_ht_sw1'), per = parseGrid('pk_wav_per'), dir = parseGrid('mn_dir_sw1');
    const wspd = parseGrid('wnd_spd'), wdir = parseGrid('wnd_dir');
    const swell = [], wind = [];
    for (let i = 0; i < times.length; i++) {
      const ms = epochMs + times[i] * 1000;
      if (hs[i] != null && !isNaN(hs[i])) swell.push({ ms, val: hs[i], period: per[i], dir: dir[i] });
      if (wspd[i] != null && !isNaN(wspd[i])) wind.push({ ms, val: wspd[i] * 1.944, dir: wdir[i] });
    }
    return { swell, wind };
  } catch (e) { console.warn('[BOM]', spot.name, e.message); return { swell: [], wind: [] }; }
}

// ── Météo-France global (MFWAM) via Open-Meteo — houle seulement ───────
async function fetchMfWave(spot) {
  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat}&longitude=${spot.lon}`
      + '&hourly=swell_wave_height,swell_wave_period,swell_wave_direction&models=meteofrance_wave&forecast_days=10&timezone=GMT';
    const r = await fetchWithTimeout(url);
    const j = await r.json();
    if (!j?.hourly?.time) return [];
    const h = j.hourly, out = [];
    for (let i = 0; i < h.time.length; i++) {
      const ms = Date.parse(h.time[i] + 'Z');
      if (h.swell_wave_height[i] != null) out.push({ ms, val: h.swell_wave_height[i], period: h.swell_wave_period?.[i], dir: h.swell_wave_direction?.[i] });
    }
    return out;
  } catch (e) { console.warn('[MF wave]', spot.name, e.message); return []; }
}

// ── GFS (houle via ncep_gfswave025, vent via gfs_seamless) — Open-Meteo ──
async function fetchGfsWave(spot) {
  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat}&longitude=${spot.lon}`
      + '&hourly=swell_wave_height,swell_wave_period,swell_wave_direction&models=ncep_gfswave025&forecast_days=10&timezone=GMT';
    const r = await fetchWithTimeout(url);
    const j = await r.json();
    if (!j?.hourly?.time) return [];
    const h = j.hourly, out = [];
    for (let i = 0; i < h.time.length; i++) {
      const ms = Date.parse(h.time[i] + 'Z');
      if (h.swell_wave_height[i] != null) out.push({ ms, val: h.swell_wave_height[i], period: h.swell_wave_period?.[i], dir: h.swell_wave_direction?.[i] });
    }
    return out;
  } catch (e) { console.warn('[GFS wave]', spot.name, e.message); return []; }
}
async function fetchGfsWind(spot) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}`
      + '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&models=gfs_seamless&forecast_days=10&timezone=GMT';
    const r = await fetchWithTimeout(url);
    const j = await r.json();
    if (!j?.hourly?.time) return [];
    const h = j.hourly, out = [];
    for (let i = 0; i < h.time.length; i++) {
      const ms = Date.parse(h.time[i] + 'Z');
      if (h.wind_speed_10m[i] != null) out.push({ ms, val: h.wind_speed_10m[i], dir: h.wind_direction_10m?.[i] });
    }
    return out;
  } catch (e) { console.warn('[GFS wind]', spot.name, e.message); return []; }
}

// ── ECMWF (IFS-WAM / IFS vent) via Windguru iapi.php ────────────────────
async function fetchEcmwf(spot) {
  const wgId = wgIdForSpot(spot);
  if (!wgId) return { swell: [], wind: [] };
  async function one(idModel) {
    try {
      // Referer non vide obligatoire côté Windguru (401 sinon) — un navigateur
      // l'envoie automatiquement, mais le fetch() de Node ne met rien par
      // défaut (confirmé : 401 sans, 200 avec un Referer arbitraire non-vide).
      const r = await fetchWithTimeout(
        `https://www.windguru.cz/int/iapi.php?q=forecast&id_model=${idModel}&id_spot=${wgId}`,
        15000,
        { Referer: `https://www.windguru.cz/${wgId}` }
      );
      if (!r.ok) return null;
      const j = await r.json();
      return j?.fcst || null;
    } catch (e) { console.warn('[ECMWF]', spot.name, idModel, e.message); return null; }
  }
  const [waveF, windF] = await Promise.all([one(118), one(117)]);
  const swell = [];
  if (waveF?.hours && waveF.SWELL1 && waveF.initstamp) {
    for (let i = 0; i < waveF.hours.length; i++) {
      if (waveF.SWELL1[i] != null) swell.push({ ms: waveF.initstamp * 1000 + waveF.hours[i] * 3600000, val: waveF.SWELL1[i], period: waveF.SWPER1?.[i], dir: waveF.SWDIR1?.[i] });
    }
  }
  const wind = [];
  if (windF?.hours && windF.WINDSPD && windF.initstamp) {
    for (let i = 0; i < windF.hours.length; i++) {
      if (windF.WINDSPD[i] != null) wind.push({ ms: windF.initstamp * 1000 + windF.hours[i] * 3600000, val: windF.WINDSPD[i], dir: windF.WINDDIR?.[i] });
    }
  }
  return { swell, wind };
}

// ── meteo.nc (modèle officiel régionalisé NC) via rpcache ────────────────
// Le token Bearer est capturé côté navigateur par l'extension puis poussé
// dans Supabase (shared_tokens) par le worker Cloudflare toutes les 5 min —
// on le RELIT ici pour interroger rpcache côté serveur, sans reproduire la
// capture (impossible hors navigateur). Si le token est absent/expiré, on
// saute meteo.nc sans faire échouer le reste (il reste alimenté par les
// visites normales de l'app via _saveForecastDays).
async function getNcToken() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_tokens?select=token&id=eq.meteo-nc`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const j = await r.json();
    return j?.[0]?.token || null;
  } catch (e) { console.warn('[nc token]', e.message); return null; }
}

async function fetchMeteoNc(spot, token) {
  if (!token) return { swell: [], wind: [] };
  try {
    const r = await fetchWithTimeout(
      `https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=${spot.lat}&lon=${spot.lon}`,
      12000,
      { Authorization: `Bearer ${token}`, Referer: 'https://meteo.nc/' }
    );
    if (!r.ok) { console.warn('[nc]', spot.name, 'HTTP', r.status); return { swell: [], wind: [] }; }
    const j = await r.json();
    const rows = j?.properties?.marine || j?.properties?.hourly || j?.properties?.forecast;
    if (!rows?.length) return { swell: [], wind: [] };
    const swell = [], wind = [];
    for (const d of rows) {
      // rpcache/forecast/marine étiquette les temps en UTC réel (cf.
      // previsions.html : +11h appliqué SANS normalisation de jour, à la
      // différence de l'endpoint tide) → new Date(d.time) = vrai UTC.
      const ms = new Date(d.time).getTime();
      const h1 = d.primary_swell_height ?? d.wave_height;
      if (h1 != null) swell.push({ ms, val: h1, period: d.primary_swell_period, dir: d.primary_swell_direction });
      if (d.wind_speed_kt != null) wind.push({ ms, val: d.wind_speed_kt, dir: d.wind_direction });
    }
    return { swell, wind };
  } catch (e) { console.warn('[nc]', spot.name, e.message); return { swell: [], wind: [] }; }
}

// ── Regroupe des points par date NC-locale (+11h) → lignes model_forecast_cache ──
function toRows(spot, modelKey, kind, pts) {
  if (!pts.length) return [];
  const byDate = {};
  for (const p of pts) {
    const d = new Date(p.ms + 11 * 3600000);
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    (byDate[ds] ||= []).push({ h: d.getUTCHours(), val: p.val, period: p.period ?? null, dir: p.dir ?? null });
  }
  return Object.entries(byDate).map(([ds, hours]) => ({
    id: `${ds}_${spot.lat.toFixed(3)}_${spot.lon.toFixed(3)}_${modelKey}_${kind}`,
    date: ds, spot_name: spot.name, lat: spot.lat, lon: spot.lon,
    model: modelKey, kind, hours, updated_at: new Date().toISOString(),
  }));
}

async function upsert(rows) {
  if (!rows.length) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/model_forecast_cache`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const t = await r.text();
    // Table absente (l'utilisateur ne l'a peut-être pas encore créée) → message
    // clair dans les logs du job plutôt qu'un échec silencieux, mais pas fatal.
    console.warn('[upsert] échec', r.status, t.slice(0, 300));
  } else {
    console.log(`[upsert] ${rows.length} ligne(s) ok (${rows[0].model}/${rows[0].kind}, ${rows[0].spot_name})`);
  }
}

async function run() {
  console.log(`=== Cache modèles météo — ${new Date().toISOString()} ===`);
  const ncToken = await getNcToken();
  console.log(ncToken ? '[nc] token trouvé — meteo.nc inclus' : '[nc] pas de token Supabase — meteo.nc sauté (alimenté par les visites de l\'app)');
  for (const spot of SPOTS) {
    console.log(`--- ${spot.name} ---`);
    const [bom, mfWave, gfsWave, gfsWind, ecmwf, nc] = await Promise.all([
      fetchBom(spot), fetchMfWave(spot), fetchGfsWave(spot), fetchGfsWind(spot), fetchEcmwf(spot), fetchMeteoNc(spot, ncToken),
    ]);
    const rows = [
      ...toRows(spot, 'nc', 'swell_primary', nc.swell),
      ...toRows(spot, 'nc', 'wind', nc.wind),
      ...toRows(spot, 'bom', 'swell_primary', bom.swell),
      ...toRows(spot, 'bom', 'wind', bom.wind),
      ...toRows(spot, 'mf', 'swell_primary', mfWave),
      ...toRows(spot, 'gfs', 'swell_primary', gfsWave),
      ...toRows(spot, 'gfs', 'wind', gfsWind),
      ...toRows(spot, 'ecmwf', 'swell_primary', ecmwf.swell),
      ...toRows(spot, 'ecmwf', 'wind', ecmwf.wind),
    ];
    // Supabase limite la taille d'un batch insert — ce volume (~10j × 6
    // modèles/kind max) reste largement en dessous, mais on découpe par
    // prudence si jamais un spot remonte beaucoup de lignes.
    for (let i = 0; i < rows.length; i += 50) await upsert(rows.slice(i, i + 50));
  }
  console.log('=== Terminé ===');
}

run().catch(e => { console.error('Erreur fatale:', e); process.exit(1); });
