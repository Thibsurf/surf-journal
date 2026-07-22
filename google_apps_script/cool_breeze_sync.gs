/**
 * Cool Breeze → Fuel Pro : synchro automatique Google Sheet → Supabase.
 *
 * INSTALLATION (à faire une fois, dans le Google Sheet "Cool Breeze", pas ici) :
 *   1. Extensions → Apps Script, coller ce fichier (remplace Code.gs).
 *   2. Projet Apps Script → Paramètres du projet (⚙) → "Propriétés du script" → ajouter :
 *        SUPABASE_SERVICE_ROLE_KEY = <clé service_role, PAS l'anon key>
 *      (Dashboard Supabase → Project Settings → API → service_role secret)
 *      ⚠️ Ne jamais mettre cette clé dans le Sheet lui-même ni dans ce fichier en clair —
 *      elle bypass RLS. Les Script Properties ne sont visibles que par les éditeurs du script.
 *   3. Dans l'éditeur Apps Script : Exécuter → installer le déclencheur en lançant une fois
 *      `installTrigger` depuis la barre d'outils (menu Exécuter → sélectionner la fonction).
 *   4. Recharger le Sheet → un menu "Cool Breeze" apparaît, avec "Synchroniser maintenant"
 *      pour un premier passage manuel (recommandé avant de compter sur l'auto).
 *
 * FONCTIONNEMENT :
 *   - Ajoute une colonne "synced_at" en dernière position de chaque onglet suivi.
 *   - Chaque édition (onChange) déclenche un scan des lignes sans "synced_at" : elles sont
 *     classifiées (refuel/bidon_fill/expense/reimburse) exactement comme le fait le site
 *     (assets marine_fuel_pro.html, fonctions guessLogType/guessCategoryFromDesc/
 *     guessLitersAndPrice — copiées ici pour rester synchro avec le comportement du site :
 *     si tu changes la logique côté site, reporte le changement ici aussi).
 *   - Insert direct dans Supabase via REST (service_role key = bypass RLS, nécessaire car
 *     Apps Script n'a pas de session utilisateur authentifiée côté site).
 *   - Idempotent : une ligne déjà marquée "synced_at" n'est jamais renvoyée, même si le
 *     déclencheur tourne plusieurs fois. Une ligne modifiée APRÈS synchro n'est PAS re-poussée
 *     automatiquement (évite les doublons) — pour forcer un renvoi, vide sa cellule synced_at.
 */

// ── Config fixe (Cool Breeze / Supabase) ────────────────────────────────────
const SUPABASE_URL   = 'https://tiiptlozingmgzcnexpu.supabase.co';
const BOAT_ID         = 'fa42b547-e260-40d1-b431-ad34c3c83ad8';
const USER_THIBAULT   = '485fd32c-1392-412a-a4a7-b9214d0e6827';
const USER_LUCAS      = '278fdc19-5abd-4be6-8068-05544d79703e';

const SHEET_DEPENSES      = 'dépenses et équilibre';
const SHEET_REMBOURSEMENTS = 'remboursements';

// ── Table des prix essence NC (F/L) — copie de FUEL_PRICES_NC dans marine_fuel_pro.html.
// Complète les mois manquants ici ET côté site si tu veux que les litres se calculent
// automatiquement pour les pleins récents (sinon liters/price restent null).
const FUEL_PRICES_NC = {
  2023: [172.9, 162.1, 168.9, 169.7, 169.8, 168.3, 164.2, 164.7, 167.1, 173.1, 177.6, 171.2],
  2024: [168.9, 162.4, 165.5, 172.0, 173.7, 177.9, 168.6, 167.0, 169.6, 165.8, 157.2, 160.0],
  2025: [160.3, 161.6, 164.2, 167.0, 160.5, 157.1, 155.4, 157.1, 154.7, 155.6, 157.0, 155.9],
  2026: [158.8, 152.7, 151.1, 174.8, null, null, null, null, null, null, null, null],
};

function getFuelPrice_(dateIso) {
  const d = new Date(dateIso);
  const arr = FUEL_PRICES_NC[d.getFullYear()];
  if (!arr) return null;
  return arr[d.getMonth()] || null;
}

// Même logique que guessLogType() côté site (post-fix : uniquement appelé pour
// les lignes qui NE sont PAS des remboursements — voir buildPayload_).
function guessLogType_(desc) {
  const d = (desc || '').toLowerCase();
  const isFuelDesc = /^essence\b|^essence$|essence (?:fp|consommée|consommee|sortie|gold|signal|station|moselle|port|vata|bateau|rinçage|rincage)|plein essence|plein bateau|plein station|station moselle/.test(d);
  const isBidonRefill = /(?:plein|remplissage)\s+bidon|essence bidon|bidon (?:plein|rempli)/.test(d);
  if (isFuelDesc) return 'refuel';
  if (isBidonRefill) return 'bidon_fill';
  return 'expense';
}

// Copie de guessCategoryFromDesc() côté site.
function guessCategoryFromDesc_(desc) {
  if (!desc) return 'other';
  const d = desc.toLowerCase();
  if (/loyer|parking|nouville|sunset|caution badge|place/.test(d)) return 'parking';
  if (/assurance/.test(d)) return 'assurance';
  if (/voiture|trajet|remorque|tomo|station|pneus|roues|signal|virement/.test(d)) return 'transport';
  if (/immat|ditt|admin|caution(?! badge)/.test(d)) return 'admin';
  if (/révision|revision|entretien|réparation|reparation|rinçage|moteur vata/.test(d)) return 'maintenance';
  if (/sandwich|bagel|burger|pizza|brownie|barquette|tacos|otacos|cook|biere|bière|bières|poulet|viand|stass|boulange|croissant|fronton|raiss|nem|matt|valentine/.test(d)) return 'food';
  if (/sortie|tenia|baie|kouare|boulari|maa|tricount|ténia|goldcoast|fp/.test(d)) return 'food';
  if (/bidon|durit|tuyau|filtre|entonnoir/.test(d)) return 'equipment';
  if (/balise|plb|pompe|cale|gilet|lampe|feux|led|cordage|sangle|manille|extincteur|graisse|cosse|marteau|cache|graisseur|outil|matos|tole|housse|leash|guy cotten/.test(d)) return 'equipment';
  return 'other';
}

// Copie de guessLitersAndPrice() côté site (signature corrigée : total, dateIso).
function guessLitersAndPrice_(total, dateIso) {
  const refPrice = getFuelPrice_(dateIso);
  if (!refPrice || !total) return { liters: null, price: refPrice || null };
  return { liters: Math.round((total / refPrice) * 100) / 100, price: refPrice };
}

// ── Menu ─────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cool Breeze')
    .addItem('Synchroniser maintenant', 'syncNow')
    .addItem('Installer la synchro auto (à faire une fois)', 'installTrigger')
    .addToUi();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();
  SpreadsheetApp.getUi().alert('Synchro automatique installée : toute modification du Sheet déclenchera un envoi des nouvelles lignes vers le site.');
}

// ── Synchro ──────────────────────────────────────────────────────────────
function syncNow() {
  const ss = SpreadsheetApp.getActive();
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    SpreadsheetApp.getUi().alert('SUPABASE_SERVICE_ROLE_KEY manquante dans les propriétés du script (⚙ Paramètres du projet).');
    return;
  }

  let pushed = 0, failed = 0;
  pushed += syncSheet_(ss.getSheetByName(SHEET_DEPENSES), 'depenses', key, r => failed++);
  pushed += syncSheet_(ss.getSheetByName(SHEET_REMBOURSEMENTS), 'remboursements', key, r => failed++);

  if (pushed || failed) {
    SpreadsheetApp.getActive().toast(`${pushed} log(s) envoyé(s) au site${failed ? ', ' + failed + ' échec(s)' : ''}`, 'Cool Breeze sync');
  }
}

function syncSheet_(sheet, kind, key, onFail) {
  if (!sheet) return 0;
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  let syncedCol = header.indexOf('synced_at');
  if (syncedCol === -1) {
    syncedCol = header.length;
    sheet.getRange(1, syncedCol + 1).setValue('synced_at');
  }

  let pushed = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row[syncedCol]) continue; // déjà synchronisé

    const payload = kind === 'depenses' ? buildDepensePayload_(row) : buildRemboursementPayload_(row);
    if (!payload) continue; // ligne vide / date manquante / payeur non reconnu

    const ok = insertLog_(payload, key);
    if (ok) {
      sheet.getRange(i + 1, syncedCol + 1).setValue(new Date());
      pushed++;
    } else {
      onFail(i);
    }
    Utilities.sleep(150); // évite de marteler l'API sur un gros lot
  }
  return pushed;
}

// Colonnes "dépenses et équilibre" : date, Par Thibault, Par Lucas, combien, quoi, frais bateau, commentaire, où
function buildDepensePayload_(row) {
  const [date, parT, parL, montant, quoi] = row;
  if (!date || !montant) return null;
  const payer = parT ? USER_THIBAULT : (parL ? USER_LUCAS : null);
  if (!payer) return null;

  const desc = quoi || 'Dépense';
  const type = guessLogType_(desc);
  const iso = new Date(date).toISOString();

  const payload = {
    boat_id: BOAT_ID, user_id: payer, paid_by: payer,
    type, total_price: montant, note: desc, created_at: iso, full_tank: false,
  };
  if (type === 'expense') payload.category = guessCategoryFromDesc_(desc);
  if (type === 'refuel' || type === 'bidon_fill') {
    const lp = guessLitersAndPrice_(montant, iso);
    payload.liters = lp.liters;
    payload.price = lp.price;
  }
  return payload;
}

// Colonnes "remboursements" : date, payé par lucas pour T, payé par thibault pour L, commentaire
function buildRemboursementPayload_(row) {
  const [date, lucasPourT, thibPourL, comment] = row;
  if (!date) return null;
  let payer = null, montant = null;
  if (lucasPourT) { payer = USER_LUCAS; montant = lucasPourT; }
  else if (thibPourL) { payer = USER_THIBAULT; montant = thibPourL; }
  else return null;

  return {
    boat_id: BOAT_ID, user_id: payer, paid_by: payer,
    type: 'reimburse', total_price: montant, note: comment || 'Remboursement',
    created_at: new Date(date).toISOString(), full_tank: false,
  };
}

function insertLog_(payload, key) {
  const attempt = (type) => {
    const body = Object.assign({}, payload, { type });
    const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/boat_fuel_logs', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    return res.getResponseCode();
  };

  let code = attempt(payload.type);
  // Fallback si la contrainte CHECK de la table n'accepte pas (encore) 'reimburse'
  // — mêmes règles que le fallback côté site (marqueur __REMB__ dans la note).
  if (code >= 400 && payload.type === 'reimburse') {
    const fallback = Object.assign({}, payload, { type: 'expense', note: '__REMB__ ' + payload.note });
    delete fallback.type; // reconstruit proprement
    const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/boat_fuel_logs', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
      payload: JSON.stringify(Object.assign({}, fallback, { type: 'expense' })),
      muteHttpExceptions: true,
    });
    code = res.getResponseCode();
  }
  return code >= 200 && code < 300;
}
