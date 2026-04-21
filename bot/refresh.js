import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// 1. Configuration sécurisée : Utilisez la clé publique pour les requêtes REST
const headers = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

// 2. Endpoint Météo.nc pour tester le token
const METEO_TEST_URL =
  "https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=-22.38056&lon=166.22314";

async function run() {
  console.log("[BOT] 🚀 Démarrage du rafraîchissement du token...");

  // 3. Récupérer le token depuis Supabase (en utilisant la clé publique)
  try {
    const { data: tokenData, error: fetchError } = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_token?select=token&app_name=eq.meteo-nc`,
      { headers }
    ).then((res) => res.json());

    if (fetchError || !tokenData || !tokenData[0]?.token) {
      throw new Error("❌ Impossible de récupérer le token depuis Supabase");
    }

    const token = tokenData[0].token;
    console.log("[BOT] 🔍 Token actuel:", token.substring(0, 20) + "...");

    // 4. Tester le token avec l'API Météo.nc
    const testResponse = await fetch(METEO_TEST_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("[BOT] 📊 Statut de l'API Météo.nc:", testResponse.status);

    if (testResponse.status !== 200) {
      console.log("[BOT] ❌ Token invalide → génération d'un nouveau token...");
      // TODO: Ajoutez ici la logique pour générer un nouveau token (ex. : appeler l'API Météo.nc)
      // Exemple :
      // const newToken = await generateNewToken();
      // await updateTokenInSupabase(newToken);
      console.log("[BOT] ⚠️ Génération d'un nouveau token non implémentée.");
      return;
    }

    // 5. Si le token est valide, mettre à jour le timestamp
    await fetch(
      `${SUPABASE_URL}/rest/v1/shared_token?app_name=eq.meteo-nc`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=minimal", // Évite de retourner le résultat
        },
        body: JSON.stringify({
          updated_at: new Date().toISOString(),
        }),
      }
    );

    console.log("[BOT] ✅ Token validé et timestamp mis à jour !");
  } catch (err) {
    console.error("[BOT] ❌ Erreur:", err.message);
    process.exit(1);
  }
}

// Exemple de fonction pour générer un nouveau token (à adapter selon Météo.nc)
async function generateNewToken() {
  // Exemple : Appeler l'API Météo.nc pour obtenir un nouveau token
  // const response = await fetch("https://api.meteo.nc/token", { ... });
  // return response.json().token;
  return "NOUVEAU_TOKEN"; // Remplacez par l'appel réel
}

// Exemple de fonction pour mettre à jour le token dans Supabase
async function updateTokenInSupabase(newToken) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/shared_token?app_name=eq.meteo-nc`,
    {
      method: "PATCH",
      headers: {
        ...headers,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        token: newToken,
        updated_at: new Date().toISOString(),
      }),
    }
  );
}

run();
