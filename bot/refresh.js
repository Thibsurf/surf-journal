import { chromium } from "playwright";

const SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function pushToSupabase(token) {
  await fetch(`${SUPABASE_URL}/rest/v1/shared_tokens`, {
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
}

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  console.log("🌐 Opening meteo.nc...");

  await page.goto("https://meteo.nc", {
    waitUntil: "networkidle"
  });

  console.log("⏳ Waiting for token injection...");

  await page.waitForTimeout(10000);

  const token = await page.evaluate(() => {
    return localStorage.getItem("nc-token");
  });

  console.log("🔑 Token found:", token?.slice(0, 30));

  if (!token || token.length < 20) {
    await page.screenshot({ path: "debug.png", fullPage: true });
    throw new Error("TOKEN_NOT_FOUND");
  }

  console.log("📤 Sending to Supabase...");
  await pushToSupabase(token);

  console.log("✅ Done");

  await browser.close();
}

run().catch(async (e) => {
  console.error("❌ FATAL ERROR");
  console.error(e);
  process.exit(1);
});
