import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Endpoint Météo.nc (optionnel pour tester le token)
const METEO_TEST_URL =
  "https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=-22.38056&lon=166.22314";

async function run() {
  console.log("[BOT] 🚀 Démarrage du rafraîchissement du token...");

  try {
    // 1. Vérification des variables d'environnement
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("❌ Variables SUPABASE_URL ou SUPABASE_KEY manquantes.");
    }

    console.log("[BOT] 🔐 Connexion à Supabase OK");

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };

    // 2. Récupérer le token actuel
    console.log("[BOT] 🔍 Récupération du token...");
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc&select=token`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`❌ GET failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || data.length === 0 || !data[0]?.token) {
      throw new Error("❌ Aucun token trouvé en base.");
    }

    const currentToken = data[0].token;
    console.log("[BOT] ✅ Token actuel récupéré");

    // ⚠️ TODO: ici tu dois remplacer par ton vrai refresh
    const newToken = currentToken;

    // 3. (optionnel) tester le token
    /*
    const testResponse = await fetch(METEO_TEST_URL, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    console.log("[BOT] 🌦️ Test API météo status:", testResponse.status);
    */

    // 4. Mise à jour dans Supabase
    console.log("[BOT] 🔄 Mise à jour du token...");

    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          token: newToken,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    const updateData = await updateResponse.json();

    console.log("[BOT] 📋 Réponse update:", updateData);

    if (!updateResponse.ok) {
      throw new Error(`❌ Update failed: ${updateResponse.status}`);
    }

    console.log("[BOT] ✅ Token mis à jour avec succès !");
  } catch (err) {
    console.error("[BOT] ❌ Erreur:", err.message);
    process.exit(1);
  }
}

run();
