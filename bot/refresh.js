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

  console.log("📡 Supabase status:", res.status);
  const text = await res.text();
  console.log("📡 Supabase response:", text);
}

async function run() {
  console.log("🚀 START BOT");

  if (!SUPABASE_KEY) {
    throw new Error("MISSING_SUPABASE_KEY");
  }

  const browser = await chromium.launch({
    headless: true,
    slowMo: 200
  });

  const page = await browser.newPage();

  page.on("console", msg => console.log("🌐 PAGE:", msg.text()));

  console.log("🌍 Opening meteo.nc...");

  await page.goto("https://meteo.nc", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  console.log("⏳ Waiting extra hydration time...");

  // ⚠️ plus long = plus fiable
  await page.waitForTimeout(20000);

  console.log("🔍 Checking localStorage...");

  const token = await page.evaluate(() => {
    return localStorage.getItem("nc-token");
  });

  console.log("🔑 TOKEN:", token);

  if (!token) {
    await page.screenshot({ path: "debug.png", fullPage: true });
    throw new Error("TOKEN_NOT_FOUND");
  }

  console.log("📤 Sending to Supabase...");
  await pushToSupabase(token);

  console.log("✅ DONE");

  await browser.close();
}

run().catch(async (e) => {
  console.error("❌ FATAL ERROR");
  console.error(e?.stack || e);

  process.exit(1);
});
