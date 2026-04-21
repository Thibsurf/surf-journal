import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const METEO_TEST_URL =
  "https://rpcache.meteo.nc/internet2018client/2.0/forecast?lat=-22&lon=166";

async function run() {
  console.log("[BOT] start");

  // 1. récupérer token
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  const json = await res.json();
  const token = json?.[0]?.token;

  if (!token) throw new Error("No token");

  // 2. test réel API
  const test = await fetch(METEO_TEST_URL, {
    headers: { Authorization: "Bearer " + token },
  });

  console.log("[BOT] status:", test.status);

  if (test.status !== 200) {
    console.log("[BOT] ❌ token invalide → stop");
    return;
  }

  // 3. OK → update timestamp
  await fetch(
    `${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updated_at: new Date().toISOString(),
      }),
    }
  );

  console.log("[BOT] ✅ token validé");
}

run().catch(console.error);
