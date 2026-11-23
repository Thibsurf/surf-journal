// ════════════════════════════════════════════════════════════════════════════
// wave-physics.js — ce que la houle devient en arrivant sur le récif
// ════════════════════════════════════════════════════════════════════════════
// Script CLASSIQUE (pas de module ES), ES5, aucune dépendance, aucun DOM.
//
// POURQUOI UN MODULE : ces formules servent au schéma de houle d'accueil.html
// ET à la lecture des séries dans la fiche d'un créneau. Recopier une formule
// de physique à deux endroits, c'est la garantie qu'elles divergeront — règle
// du projet, et déjà payée trois fois sur l'interprétation des partitions.
//
// SOURCES, toutes vérifiables :
//   · longueur d'onde en profondeur finie : approximation explicite de
//     FENTON & McKEE (1990), Coastal Engineering 14(6) — c'est celle qu'emploie
//     le calculateur eCoast « Wave Shoaling and Refraction », qui cite le
//     Coastal Engineering Manual de l'US Army Corps of Engineers (2006).
//   · coefficient de shoaling Ks = √(Cg0/Cg) : théorie linéaire, conservation
//     du flux d'énergie. Même source.
//   · déferlement en eau peu profonde quand H/profondeur dépasse 0,78 : indice
//     de McCowan, repris tel quel par le CEM et par eCoast (« Linear Wave
//     Theory » : breaking if H/Z > 0.78).
//   · battement de deux trains : superposition de deux sinusoïdes de fréquences
//     voisines. Ce n'est PAS tiré d'un calculateur — aucun de ceux consultés ne
//     le propose — mais de l'algèbre élémentaire, et elle est vérifiée dans
//     test_swell.js contre des cas calculés à la main.
//
// Unités : mètres, secondes, radians. Jamais de nœuds ni de pieds ici.

var WP_G = 9.81;

// Indice de déferlement en eau peu profonde (McCowan). Au-delà de ce rapport
// hauteur/profondeur, la crête ne tient plus.
var WP_INDICE_DEFERLEMENT = 0.78;

// Cambrure limite en eau profonde (Miche) : une houle trop cambrée déferle
// SANS fond, c'est le moutonnement du large. eCoast l'écrit H/L > 0.17.
var WP_CAMBRURE_LIMITE = 0.17;

// ── Eau profonde ────────────────────────────────────────────────────────────
// L0 = g·T²/2π et C0 = g·T/2π. C'est ce qui fait qu'à 8 s les crêtes sont à
// 100 m et à 13 s à 264 m : le carré de la période, pas la période.
function wpL0(T) { return (T > 0) ? WP_G * T * T / (2 * Math.PI) : null; }
function wpC0(T) { return (T > 0) ? WP_G * T / (2 * Math.PI) : null; }

// ── Longueur d'onde à une profondeur donnée — Fenton & McKee (1990) ─────────
// L = L0 · [ tanh( (σ√(z/g))^(3/2) ) ]^(2/3),  σ = 2π/T
//
// Approximation EXPLICITE de la relation de dispersion, qui elle est implicite
// (σ² = gk·tanh(kz) ne se résout pas en k). Erreur annoncée < 1,7 % partout,
// ce qui est très inférieur à l'incertitude d'une prévision de houle.
//
// Les deux limites se vérifient à la main, et test_swell.js les vérifie :
//   · z grand  → tanh → 1   → L = L0            (eau profonde)
//   · z petit  → tanh(x) ≈ x → L → T·√(g·z)      (eau peu profonde)
function wpLongueurOnde(T, z) {
  if (!(T > 0)) return null;
  var L0 = wpL0(T);
  if (z == null || !(z > 0)) return L0;
  var sigma = 2 * Math.PI / T;
  var x = Math.pow(sigma * Math.sqrt(z / WP_G), 1.5);
  return L0 * Math.pow(Math.tanh(x), 2 / 3);
}

// ── Cinématique complète à une profondeur ───────────────────────────────────
// n = ½·(1 + 2kz/sinh(2kz)) est le rapport vitesse de groupe / vitesse de
// phase : ½ en eau profonde (la vague court deux fois plus vite que le train),
// 1 en eau peu profonde (les deux se confondent).
function wpCinematique(T, z) {
  if (!(T > 0)) return null;
  var profond = (z == null || !(z > 0));
  var L = wpLongueurOnde(T, z);
  if (!(L > 0)) return null;
  var k = 2 * Math.PI / L;
  var C = L / T;
  var n = 0.5;
  if (!profond) {
    var kz2 = 2 * k * z;
    // Math.sinh déborde vers l'infini au-delà de ~710. Bien avant ça, à
    // kz2 > 20, le terme 2kz/sinh(2kz) vaut moins de 1e-7 : on est en eau
    // profonde, n = ½. Sans cette borne, un fond de 500 m rendrait NaN.
    n = (kz2 > 20) ? 0.5 : 0.5 * (1 + kz2 / Math.sinh(kz2));
  }
  return { L: L, k: k, C: C, n: n, Cg: n * C, profond: profond };
}

// ── Coefficient de shoaling ─────────────────────────────────────────────────
// Ks = √(Cg0 / Cg). Le flux d'énergie se conserve : quand la vague ralentit en
// arrivant sur le fond, son énergie se comprime en hauteur.
//
// Détail qui surprend et qui est juste : Ks passe D'ABORD sous 1. Une houle
// commence par PERDRE un peu de hauteur avant de grossir — minimum 0,913 vers
// z/L0 = 0,157. C'est un étalon utile : si une implémentation ne montre pas ce
// creux, elle est fausse. test_swell.js le vérifie.
function wpShoaling(T, z) {
  var c = wpCinematique(T, z);
  var cg0 = (T > 0) ? 0.5 * wpC0(T) : null;
  if (!c || !(c.Cg > 0) || !(cg0 > 0)) return null;
  return Math.sqrt(cg0 / c.Cg);
}

// Hauteur de la houle à la profondeur z, partie de H0 en eau profonde.
function wpHauteurA(H0, T, z) {
  var ks = wpShoaling(T, z);
  return (ks == null || !(H0 > 0)) ? null : H0 * ks;
}

// ── Profondeur de déferlement ───────────────────────────────────────────────
// On cherche z tel que H(z)/z = 0,78. H(z) croît quand z décroît, donc le
// rapport est monotone : une dichotomie suffit, et elle est plus honnête qu'une
// formule approchée du type « 1,3 × H0 » qui ignore la période.
//
// Rend null si la houle est nulle, ou si le déferlement tombe hors de la
// fourchette explorée (0,05 m à 200 m de fond).
function wpProfondeurDeferlement(H0, T) {
  if (!(H0 > 0) || !(T > 0)) return null;
  function exces(z) {                 // > 0 = ça déferle déjà
    var h = wpHauteurA(H0, T, z);
    return (h == null) ? -1 : h / z - WP_INDICE_DEFERLEMENT;
  }
  var bas = 0.05, haut = 200;
  if (exces(bas) <= 0 || exces(haut) >= 0) return null;
  for (var i = 0; i < 60; i++) {
    var mid = 0.5 * (bas + haut);
    if (exces(mid) > 0) bas = mid; else haut = mid;
  }
  return 0.5 * (bas + haut);
}

// La houle « sent le fond » quand la profondeur descend sous la moitié de sa
// longueur d'onde en eau profonde. C'est la frontière conventionnelle entre eau
// profonde et profondeur intermédiaire.
function wpProfondeurRessentie(T) {
  var L0 = wpL0(T);
  return (L0 == null) ? null : L0 / 2;
}

// ── Deux houles qui se croisent : le battement ──────────────────────────────
// Deux trains de périodes voisines se renforcent puis s'annulent. La période de
// ce cycle est la période de BATTEMENT :
//
//     T_bat = T1·T2 / |T1 − T2|
//
// (différence des fréquences : 1/T_bat = |1/T1 − 1/T2|.)
//
// Et le nombre de vagues dans un cycle est le rapport entre ce battement et la
// période moyenne VUE À L'EAU, qui est la moyenne des deux fréquences :
//
//     N = T_bat / T_porteuse = (T1 + T2) / (2·|T1 − T2|)
//
// CE QUE ÇA VAUT, ET CE QUE ÇA NE VAUT PAS. Deux périodes PROCHES donnent de
// vraies séries : 13 s et 12 s → une série toutes les 2 min 36, de 12 à 13
// vagues. Deux périodes ÉLOIGNÉES ne font pas des séries, elles font deux
// houles qui s'entremêlent : 13 s et 8 s donnent N = 2,1, ce qui ne se lit pas
// comme une série à l'eau. D'où le seuil des appelants.
//
// Et surtout : la mer réelle a un spectre CONTINU, pas deux raies. Le vrai
// groupement de vagues vient de la largeur du spectre. Ce calcul est donc un
// ordre de grandeur quand deux trains dominent, pas une horloge — et c'est
// comme ça qu'il doit être présenté.
function wpBattement(T1, T2) {
  if (!(T1 > 0) || !(T2 > 0)) return null;
  var d = Math.abs(T1 - T2);
  if (d < 0.05) return null;          // trains de même période : pas de battement
  return {
    periode:   T1 * T2 / d,                    // s — durée d'un cycle complet
    vagues:    (T1 + T2) / (2 * d),            // nombre de vagues par série
    porteuse:  2 * T1 * T2 / (T1 + T2)         // s — période moyenne vue à l'eau
  };
}

// Amplitude relative du battement, de 0 à 1 : deux houles de même hauteur
// s'annulent complètement (1), une petite houle sur une grosse ne module
// presque rien (→ 0). C'est ce qui dit si la série se VOIT.
function wpModulation(h1, h2) {
  if (!(h1 > 0) || !(h2 > 0)) return null;
  return Math.min(h1, h2) / Math.max(h1, h2);
}

// ── Façade, pour le code qui préfère un objet ───────────────────────────────
if (typeof window !== 'undefined') {
  window.WavePhysics = {
    L0: wpL0, C0: wpC0,
    longueurOnde: wpLongueurOnde,
    cinematique: wpCinematique,
    shoaling: wpShoaling,
    hauteurA: wpHauteurA,
    profondeurDeferlement: wpProfondeurDeferlement,
    profondeurRessentie: wpProfondeurRessentie,
    battement: wpBattement,
    modulation: wpModulation,
    G: WP_G,
    INDICE_DEFERLEMENT: WP_INDICE_DEFERLEMENT,
    CAMBRURE_LIMITE: WP_CAMBRURE_LIMITE
  };
}
