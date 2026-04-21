import fetch from "node-fetch";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

/**
 * Récupère le token Météo.nc en interceptant les requêtes réseau
 */
async function getTokenFromMeteo() {
  console.log("[BOT] 🌐 Lancement navigateur...");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let token = null;

  // Capture du token dès qu'il apparaît dans les headers
  page.on("request", (request) => {
    const headers = request.headers();

    const auth = headers.authorization;
    if (!token && auth && auth.startsWith("Bearer ")) {
      token = auth.replace("Bearer ", "");
      console.log("[BOT] 🎯 Token capturé !");
    }
  });

  // IMPORTANT : éviter le timeout "load"
  await page.goto("https://meteo.nc", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Attente active (max 10s)
  const start = Date.now();
  while (!token && Date.now() - start < 10000) {
    await new Promise((r) => setTimeout(r, 500));
  }

  await browser.close();

  if (!token) {
    throw new Error("❌ Token non trouvé via interception réseau");
  }

  return token;
}

async function run() {
  console.log("[BOT] 🚀 Start refresh token");

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("❌ Variables d'environnement manquantes");
    }

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };

    // 1. Récupération du nouveau token
    const newToken = await getTokenFromMeteo();

    console.log("[BOT] 🔐 Token récupéré:", newToken.substring(0, 25) + "...");

    // 2. Mise à jour Supabase
    console.log("[BOT] 🔄 Mise à jour Supabase...");

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

    if (!updateResponse.ok) {
      throw new Error(`❌ Supabase update failed: ${updateResponse.status}`);
    }

    console.log("[BOT] 📋 Supabase response:", updateData);
    console.log("[BOT] ✅ Token mis à jour avec succès !");
  } catch (err) {
    console.error("[BOT] ❌ Error:", err.message);
    process.exit(1);
  }
}

run();
