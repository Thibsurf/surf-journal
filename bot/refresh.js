import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Endpoint Météo.nc pour tester le token (optionnel)
const METEO_TEST_URL =
  "https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=-22.38056&lon=166.22314";

async function run() {
  console.log("[BOT] 🚀 Démarrage du rafraîchissement du token...");

  try {
    // 1. Vérifiez que les variables d'environnement sont définies
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("❌ Variables d'environnement SUPABASE_URL ou SUPABASE_KEY non définies.");
    }

    const headers = {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    };

    // 2. Récupérer le token depuis Supabase (en utilisant l'id = 'meteo-nc')
    console.log("[BOT] 🔍 Tentative de récupération du token depuis Supabase...");
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc&select=token`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`❌ Erreur HTTP ${response.status}: ${response.statusText}`);
    }

    const tokenData = await response.json();
    console.log("[BOT] 📋 Réponse de Supabase:", JSON.stringify(tokenData));

    if (!tokenData || tokenData.length === 0 || !tokenData[0]?.token) {
      throw new Error("❌ Aucun token trouvé dans Supabase (vérifiez la table `shared_tokens`).");
    }

    const token = tokenData[0].token;
    console.log("[BOT] ✅ Token récupéré:", token.substring(0, 20) + "...");

    // 3. (Optionnel) Tester le token avec l'API Météo.nc
    // const testResponse = await fetch(METEO_TEST_URL, {
    //   headers: { Authorization: `Bearer ${token}` },
    // });
    // console.log("[BOT] 📊 Statut de l'API Météo.nc:", testResponse.status);

    // 4. (Optionnel) Mettre à jour le timestamp
    // await fetch(
    //   `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc`,
    //   {
    //     method: "PATCH",
    //     headers: {
    //       ...headers,
    //       Prefer: "return=minimal",
    //     },
    //     body: JSON.stringify({
    //       updated_at: new Date().toISOString(),
    //     }),
    //   }
    // );
    // console.log("[BOT] ✅ Timestamp mis à jour !");

  } catch (err) {
    console.error("[BOT] ❌ Erreur:", err.message);
    process.exit(1);
  }
}

run();
