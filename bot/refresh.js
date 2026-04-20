import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const RPC_URL = "https://rpcache.meteo.nc/internet2018client/2.0/forecast?lat=-22&lon=166";

async function run() {
  console.log("[BOT] clean start");

  // 1. récupérer dernier token stocké (fallback simple)
  const res = await fetch("https://tiiptlozingmgzcttgxbs.supabase.co/rest/v1/shared_tokens?id=eq.meteo-nc", {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });

  const data = await res.json();
  const token = data?.[0]?.token;

  if (!token) {
    throw new Error("No token in Supabase");
  }

  // 2. test API direct (SANS navigateur)
  const test = await fetch(RPC_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      origin: "https://meteo.nc"
    }
  });

  console.log("[BOT] status:", test.status);

  if (test.status === 200) {
    console.log("[BOT] token OK");
  } else {
    console.log("[BOT] token expired or invalid");
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
