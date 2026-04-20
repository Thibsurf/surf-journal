import { chromium } from "playwright";

const SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function pushToSupabase(token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_tokens`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      id: "meteo-nc",
      token,
      updated_at: new Date().toISOString()
    })
  });

  console.log("📡 Supabase:", res.status);
}

async function run() {
  console.log("🚀 BOT START");

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let token = null;

  // 🧠 CAPTURE GLOBAL (LE PLUS IMPORTANT)
  page.on("response", async (res) => {
    try {
      const url = res.url();

      // si API renvoie token dans headers ou JSON
      if (url.includes("rpcache.meteo.nc")) {
        const text = await res.text().catch(() => null);

        if (text && text.includes("token")) {
          console.log("📡 API RESPONSE DETECTED");
        }
      }
    } catch {}
  });

  console.log("🌍 Loading meteo.nc");

  await page.goto("https://meteo.nc", {
    waitUntil: "domcontentloaded"
  });

  // 🧠 STEP 1 — laisser JS s'exécuter
  await page.waitForTimeout(15000);

  // 🧠 STEP 2 — tentative localStorage
  token = await page.evaluate(() => localStorage.getItem("nc-token"));

  console.log("🔑 localStorage token:", token);

  // 🧠 STEP 3 — fallback cookies
  if (!token) {
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name.includes("session") || c.name.includes("auth"));

    console.log("🍪 cookies:", cookies.map(c => c.name));

    if (sessionCookie) {
      token = sessionCookie.value;
    }
  }

  // 🧠 STEP 4 — retry intelligent
  if (!token) {
    console.log("⏳ retry waiting...");
    await page.waitForTimeout(10000);

    token = await page.evaluate(() => localStorage.getItem("nc-token"));
  }

  // 🧠 FINAL CHECK
  if (!token || token.length < 20) {
    await page.screenshot({ path: "debug.png", fullPage: true });
    throw new Error("TOKEN_NOT_FOUND");
  }

  console.log("✅ TOKEN OK:", token.slice(0, 30));

  await pushToSupabase(token);

  await browser.close();
}

run().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
