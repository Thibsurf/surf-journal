import { chromium } from "playwright";

const SUPABASE_URL =
  "https://tiiptlozingmgzcnexpu.supabase.co/rest/v1/shared_tokens";

const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function run() {
  console.log("[BOT] start");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://meteo.nc", {
    waitUntil: "networkidle"
  });

  await page.waitForTimeout(5000);

  const token = await page.evaluate(() =>
    localStorage.getItem("nc-token")
  );

  console.log("[TOKEN]", token);

  if (!token) {
    console.log("[ERROR] no token");
    await browser.close();
    process.exit(1);
  }

  const res = await fetch(SUPABASE_URL, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      id: "meteo-nc",
      token,
      updated_at: new Date().toISOString()
    })
  });

  console.log("[SUPABASE]", res.status);

  await browser.close();
}

run();
