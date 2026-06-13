// ════════════════════════════════════════════════════════════════════════════
// fuel-core.js — Cœur PUR & TESTABLE de marine_fuel_pro (Cool Breeze).
//
// Aucune dépendance DOM ni Supabase : uniquement des fonctions pures sur des
// tableaux de logs. Source de vérité unique pour les soldes, l'état des bidons
// (event sourcing) et le niveau réservoir (FOB). Chargé par marine_fuel_pro.html
// ET par test_fuel.html (mêmes fonctions testées et utilisées en prod).
//
// Modèle de log (table Supabase boat_fuel_logs) :
//   { id, boat_id, type, liters, distance_nm, price, total_price, note,
//     full_tank, pax, weight_kg, paid_by, category, created_at,
//     split (jsonb), reimburse_to (uuid/text),       ← colonnes dédiées (1.2)
//     bidon_id (text), bidon_cap (int) }              ← identité bidon (1.1)
//   type ∈ cruise | refuel | bidon_fill | pour | expense | reimburse |
//          correct | correct_bidon | nav
// ════════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  // ── Lecteurs split / remboursement : COLONNE d'abord, note legacy en fallback ──
  function getLogSplit(l) {
    if (l.split && typeof l.split === 'object') return l.split;
    if (l.note && l.note.indexOf('SPLIT:') !== -1) {
      try { var m = l.note.match(/SPLIT:(\{.*?\})(?:\s|$)/); if (m) return JSON.parse(m[1]); } catch (e) {}
    }
    return null;
  }
  function getReimburseTo(l) {
    if (l.reimburse_to) return l.reimburse_to;
    if (l.note) { var m = l.note.match(/__REMB_TO:([^_]+)__/); if (m) return m[1]; }
    return null;
  }
  // Un log est un remboursement si type=reimburse, OU colonne reimburse_to remplie,
  // OU marqueur legacy __REMB__ (réembours. stockés en 'expense' quand la table
  // refusait le type 'reimburse'). La colonne survit au nettoyage de la note (migration).
  function isReimburseLog(l) {
    return l.type === 'reimburse' || !!l.reimburse_to || (!!l.note && l.note.indexOf('__REMB__') !== -1);
  }
  // Une dépense partagée (entre dans le total réparti) — jamais un remboursement.
  function isShareable(l) {
    if (isReimburseLog(l)) return false;
    if (!l.total_price || l.total_price <= 0) return false;
    return l.type === 'refuel' || l.type === 'bidon_fill' || l.type === 'cruise' || l.type === 'expense';
  }
  // Part de chaque membre pour un log : split.shares (montants absolus) sinon égalitaire.
  function computeShares(l, members) {
    var total = l.total_price, split = getLogSplit(l), out = {};
    if (split && split.shares) { members.forEach(function (m) { out[m.id] = split.shares[m.id] || 0; }); return out; }
    members.forEach(function (m) { out[m.id] = members.length ? total / members.length : 0; });
    return out;
  }

  // ── computeBalances : soldes, transferts et anomalies (source de vérité) ──────
  // Retourne { rows, balance, transfers, totals, unattributed, unattributedLogs,
  //            unknownPayerIds, ambiguousReimb }
  function computeBalances(logs, members) {
    var knownIds = {}; members.forEach(function (m) { knownIds[m.id] = true; });
    var paid = {}, owed = {}, reimbursed = {};
    members.forEach(function (m) { paid[m.id] = 0; owed[m.id] = 0; reimbursed[m.id] = {}; });
    var totalGlobal = 0, unattributed = 0;
    var unknownPayerIds = {}, unattributedLogs = [], ambiguousReimb = [];

    logs.forEach(function (l) {
      if (!isShareable(l)) return;
      var total = l.total_price; totalGlobal += total;
      var payer = l.paid_by;
      if (payer && knownIds[payer]) { paid[payer] += total; }
      else {
        if (payer && !knownIds[payer]) unknownPayerIds[payer] = true;
        unattributed += total; unattributedLogs.push(l);
      }
      var shares = computeShares(l, members);
      Object.keys(shares).forEach(function (uid) { if (owed[uid] !== undefined) owed[uid] += shares[uid]; });
    });

    logs.forEach(function (l) {
      if (!isReimburseLog(l) || !l.total_price) return;
      var from = l.paid_by; if (!from || !knownIds[from]) return;
      var toId = getReimburseTo(l);
      if (!toId || !knownIds[toId]) {
        var others = members.filter(function (m) { return m.id !== from; });
        if (members.length > 2) ambiguousReimb.push(l); // exact à 2 membres, ambigu au-delà (1.4)
        toId = others.length ? others[0].id : null;
      }
      if (!toId) return;
      reimbursed[from][toId] = (reimbursed[from][toId] || 0) + l.total_price;
    });

    var fairShare = members.length ? totalGlobal / members.length : 0;
    var balance = {};
    members.forEach(function (m) {
      var meId = m.id, rembOut = 0, rembIn = 0;
      members.forEach(function (o) {
        if (o.id === meId) return;
        rembOut += (reimbursed[meId][o.id] || 0);
        rembIn += (reimbursed[o.id][meId] || 0);
      });
      balance[meId] = {
        paid: paid[meId], owed: owed[meId], fairShare: fairShare,
        rembOut: rembOut, rembIn: rembIn,
        total: (paid[meId] - owed[meId]) + (rembOut - rembIn)
      };
    });

    var rows = members.map(function (m) {
      var b = balance[m.id];
      return { m: m, id: m.id, label: m.label, paid: b.paid, owed: b.owed,
               fairShare: b.fairShare, rembOut: b.rembOut, rembIn: b.rembIn, total: b.total };
    });

    // Simplification de dettes → transferts minimaux
    var debtors = rows.filter(function (r) { return r.total < -1; }).sort(function (a, b) { return a.total - b.total; });
    var creditors = rows.filter(function (r) { return r.total > 1; }).sort(function (a, b) { return b.total - a.total; });
    var transfers = [];
    var deb = debtors.map(function (r) { return { r: r, rem: -r.total }; });
    var cred = creditors.map(function (r) { return { r: r, rem: r.total }; });
    var di = 0, ci = 0;
    while (di < deb.length && ci < cred.length) {
      var amt = Math.min(deb[di].rem, cred[ci].rem);
      if (amt > 1) transfers.push({
        fromId: deb[di].r.id, from: deb[di].r.label,
        toId: cred[ci].r.id, to: cred[ci].r.label, amt: Math.round(amt)
      });
      deb[di].rem -= amt; cred[ci].rem -= amt;
      if (deb[di].rem < 1) di++;
      if (cred[ci].rem < 1) ci++;
    }

    return {
      rows: rows, balance: balance, transfers: transfers,
      totals: { totalGlobal: totalGlobal, fairShare: fairShare },
      unattributed: unattributed, unattributedLogs: unattributedLogs,
      unknownPayerIds: Object.keys(unknownPayerIds), ambiguousReimb: ambiguousReimb
    };
  }

  // ── rebuildBidonsFromLogs : état des bidons rejoué depuis Supabase (1.1) ──────
  // bidon_fill  → création (bidon_id inconnu) ou remplissage
  // pour        → décrément (versé dans le réservoir)
  // correct_bidon → ancrage du niveau (ajustement manuel)
  // Les logs sans bidon_id (legacy) sont ignorés ici → traités par la migration.
  // Clamp [0, cap]. Indépendant de l'ordre d'arrivée (tri chronologique interne).
  function rebuildBidonsFromLogs(logs) {
    var sorted = logs.slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    var byId = {}, order = [];
    function ensure(id, cap, note, added) {
      if (!byId[id]) { byId[id] = { id: id, cap: cap || 20, level: 0, note: note || '', added: added || null }; order.push(id); }
      else if (cap && (!byId[id].cap || byId[id].cap === 20)) byId[id].cap = cap;
      return byId[id];
    }
    sorted.forEach(function (l) {
      var id = l.bidon_id; if (!id) return;
      var cap = l.bidon_cap || l.cap || null;
      if (l.type === 'bidon_fill') {
        var b = ensure(id, cap, l.note, l.created_at);
        b.level = Math.min(b.cap, b.level + (l.liters || 0));
      } else if (l.type === 'pour') {
        var b2 = byId[id]; if (!b2) return;
        b2.level = Math.max(0, b2.level - (l.liters || 0));
      } else if (l.type === 'correct_bidon') {
        var b3 = ensure(id, cap, l.note, l.created_at);
        b3.level = Math.max(0, Math.min(b3.cap, (l.liters != null ? l.liters : b3.level)));
      }
    });
    return order.map(function (id) { return byId[id]; });
  }

  // ── computeFOB : niveau réservoir par chaîne comptable depuis le dernier ancrage ─
  // FIX 1.5 : un refuel full_tank (plein ras) ancre TOUJOURS à `tank`, quel que soit
  // le volume ajouté (le réservoir est plein par définition). Garde-fou overfillFlag
  // si liters > tank (saisie probablement erronée).
  function computeFOB(logs, tankL) {
    var nil = { level: null, confidence: 0, anchorLog: null, anchorDate: null, logsSinceAnchor: 0, overfillFlag: false, tank: tankL || 0 };
    if (!tankL) return nil;
    var tank = tankL;
    var sorted = logs.slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });

    var anchorIdx = -1, anchorLevel = null, overfillFlag = false;
    for (var i = sorted.length - 1; i >= 0; i--) {
      var l = sorted[i];
      if (l.type === 'correct') { anchorIdx = i; anchorLevel = l.liters; break; }
      if (l.type === 'refuel' && l.full_tank) {
        anchorIdx = i; anchorLevel = tank;                    // plein ras = fiable, toujours
        if ((l.liters || 0) > tank) overfillFlag = true;      // garde-fou saisie douteuse
        break;
      }
    }
    if (anchorIdx < 0) {
      for (var j = 0; j < sorted.length; j++) {
        if (sorted[j].type === 'refuel') { anchorIdx = j; anchorLevel = Math.min(sorted[j].liters || 0, tank); break; }
      }
    }

    var level = null, logsSinceAnchor = 0, confidence = 0;
    if (anchorIdx >= 0) {
      level = anchorLevel;
      for (var k = anchorIdx + 1; k < sorted.length; k++) {
        var x = sorted[k];
        if (x.type === 'refuel') level = Math.min(level + (x.liters || 0), tank);
        else if (x.type === 'cruise') level = Math.max(level - (x.liters || 0), 0);
        else if (x.type === 'correct') { level = x.liters; logsSinceAnchor = 0; continue; }
        else if (x.type === 'pour') level = Math.min(level + (x.liters || 0), tank);
        logsSinceAnchor++;
      }
      var anchorLog = sorted[anchorIdx];
      var isExact = anchorLog.type === 'correct' || anchorLog.full_tank;
      if (logsSinceAnchor === 0 && isExact) confidence = 5;
      else if (logsSinceAnchor <= 2 && isExact) confidence = 4;
      else if (logsSinceAnchor <= 2) confidence = 4;
      else if (logsSinceAnchor <= 5) confidence = 3;
      else if (logsSinceAnchor <= 10) confidence = 2;
      else confidence = 1;
    }

    return {
      level: level, confidence: confidence,
      anchorLog: anchorIdx >= 0 ? sorted[anchorIdx] : null,
      anchorDate: anchorIdx >= 0 ? sorted[anchorIdx].created_at : null,
      logsSinceAnchor: logsSinceAnchor, overfillFlag: overfillFlag, tank: tank
    };
  }

  // ── migrateLegacyLog : marqueurs note (SPLIT:/__REMB__/__REMB_TO:) → colonnes (1.2) ──
  // Pur & idempotent. members optionnel : résout le destinataire d'un remboursement
  // legacy à 2 membres (__REMB__ sans __REMB_TO:). Retourne null si rien à migrer,
  // sinon { split, reimburse_to, note (nettoyée), ambiguous, changed }.
  function migrateLegacyLog(l, members) {
    members = members || [];
    var hadSplitCol = l.split && typeof l.split === 'object';
    var hadRembCol = !!l.reimburse_to;
    var split = hadSplitCol ? l.split : null;
    var reimburse_to = hadRembCol ? l.reimburse_to : null;
    var note = l.note || '';
    var isRemb = l.type === 'reimburse' || note.indexOf('__REMB__') !== -1 || hadRembCol;

    if (!split && note.indexOf('SPLIT:') !== -1) {
      try { var m = note.match(/SPLIT:(\{.*?\})(?:\s|$)/); if (m) split = JSON.parse(m[1]); } catch (e) {}
    }
    if (!reimburse_to) { var rm = note.match(/__REMB_TO:([^_]+)__/); if (rm) reimburse_to = rm[1]; }
    if (isRemb && !reimburse_to && members.length === 2 && l.paid_by) {
      var other = members.filter(function (x) { return x.id !== l.paid_by; })[0];
      if (other) reimburse_to = other.id;
    }

    // Nettoyage : SPLIT:{} et __REMB_TO:__ toujours retirés ; __REMB__ retiré seulement
    // si la nature "remboursement" reste détectable (type=reimburse ou reimburse_to posé).
    var clean = note.replace(/SPLIT:\{[^}]*\}/g, '').replace(/__REMB_TO:[^_]+__/g, '');
    var rembPreserved = (l.type === 'reimburse') || !!reimburse_to;
    if (rembPreserved) clean = clean.replace(/__REMB__/g, '');
    clean = clean.replace(/\s+/g, ' ').replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').trim();

    var ambiguous = isRemb && !reimburse_to && l.type !== 'reimburse'; // 3+ membres non résolu
    var changed = (!!split && !hadSplitCol) || (!!reimburse_to && !hadRembCol) || (clean !== note);
    if (!changed && !ambiguous) return null;
    return { split: split, reimburse_to: reimburse_to, note: clean, ambiguous: ambiguous, changed: changed };
  }

  global.FuelCore = {
    migrateLegacyLog: migrateLegacyLog,
    getLogSplit: getLogSplit,
    getReimburseTo: getReimburseTo,
    isReimburseLog: isReimburseLog,
    isShareable: isShareable,
    computeShares: computeShares,
    computeBalances: computeBalances,
    rebuildBidonsFromLogs: rebuildBidonsFromLogs,
    computeFOB: computeFOB
  };
})(typeof window !== 'undefined' ? window : globalThis);
