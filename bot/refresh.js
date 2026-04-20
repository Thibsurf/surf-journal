import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const RPC_URL = "https://rpcache.meteo.nc/internet2018client/2.0/forecast?lat=-22&lon=166";

async function run() {
  console.log("[BOT] start clean");

  // 1. récupérer token Supabase
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_tokens?id=eq.meteo-nc`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });

  const json = await res.json();
  const token = json?.[0]?.token;

  if (!token) throw new Error("No token");

  // 2. test API direct
  const r = await fetch(RPC_URL, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  console.log("[BOT] status:", r.status);

  if (r.status === 200) {
    console.log("[BOT] OK");
  } else {
    console.log("[BOT] FAIL token invalid");
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
