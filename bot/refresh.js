import fetch from "node-fetch";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getTokenFromMeteo() {
  console.log("[BOT] 🌐 Lancement navigateur...");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let token = null;

  // 👇 On écoute TOUTES les requêtes réseau
  page.on("request", (request) => {
    const headers = request.headers();

    if (headers.authorization && headers.authorization.startsWith("Bearer")) {
      console.log("[BOT] 🎯 Token détecté !");
      token = headers.authorization.replace("Bearer ", "");
    }
  });

  await page.goto("https://meteo.nc");

  // On laisse le temps aux requêtes de partir
  await page.waitForTimeout(8000);

  await browser.close();

  if (!token) {
    throw new Error("❌ Token non trouvé via Playwright");
  }

  console.log("[BOT] ✅ Token récupéré !");
  return token;
}

async function run() {
  console.log("[BOT] 🚀 Start");

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("Variables d'environnement manquantes");
    }

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };

    // 🔥 1. récupérer le NOUVEAU token
    const newToken = await getTokenFromMeteo();

    console.log("[BOT] 🔐 Nouveau token:", newToken.substring(0, 20) + "...");

    // 🔄 2. update Supabase
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

    const data = await updateResponse.json();

    console.log("[BOT] 📋 Update:", data);

    if (!updateResponse.ok) {
      throw new Error("Update Supabase failed");
    }

    console.log("[BOT] ✅ Token mis à jour !");
  } catch (err) {
    console.error("[BOT] ❌", err.message);
    process.exit(1);
  }
}

run();
