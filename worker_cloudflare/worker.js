export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });

    // =========================
    // DEBUG
    // =========================
    if (url.pathname === "/debug") {
      const token = await env.KV_BINDING.get("jwt");
      const info = tokenInfo(token);
      return json({
        ok: true,
        status: "worker ready",
        hasToken: !!token,
        tokenPreview: token ? token.slice(0, 20) + "..." : null,
        tokenValid: info.valid,
        tokenAgeMin: info.ageMin,
        tokenExpiresIn: info.expiresIn,
      });
    }

    // =========================
    // SAVE TOKEN  (/token  ET  /token-sync pour rétrocompat extension v8)
    // =========================
    if (
      (url.pathname === "/token" || url.pathname === "/token-sync") &&
      request.method === "POST"
    ) {
      const body = await request.json();
      if (!body.token) {
        return json({ ok: false, error: "missing token" }, 400);
      }
      const trimmed = body.token.trim();
      await env.KV_BINDING.put("jwt", trimmed, { expirationTtl: 3600 }); // expire auto après 1h
      console.log("[Worker] Token stocké, longueur:", trimmed.length);
      return json({ ok: true, stored: true });
    }

    // =========================
    // GET TOKEN — pour les pages mobiles sans extension
    // =========================
    if (url.pathname === "/token" && request.method === "GET") {
      const token = await env.KV_BINDING.get("jwt");
      if (!token) return json({ ok: false, error: "no token" }, 404);
      const info = tokenInfo(token);
      if (!info.valid) return json({ ok: false, error: "token expired", ageMin: info.ageMin }, 410);
      return json({ ok: true, token });
    }

    // =========================
    // HELPER FETCH METEO
    // =========================
    async function fetchMeteo(endpoint) {
      const token = await env.KV_BINDING.get("jwt");
      if (!token) return json({ ok: false, error: "No token available" }, 500);
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await res.text();
      try {
        return json(JSON.parse(text));
      } catch {
        return json({ raw: text }, res.status);
      }
    }

    if (url.pathname === "/forecast") {
      const lat = url.searchParams.get("lat");
      const lon = url.searchParams.get("lon");
      if (!lat || !lon) return json({ error: "missing lat/lon" }, 400);
      return await fetchMeteo(
        `https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=${lat}&lon=${lon}`
      );
    }

    if (url.pathname === "/tide") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      return await fetchMeteo(
        `https://rpcache.meteo.nc/internet2018client/2.0/tide?id=${id}`
      );
    }

    if (url.pathname === "/history") {
      const lat = url.searchParams.get("lat");
      const lon = url.searchParams.get("lon");
      const id = url.searchParams.get("id");
      if (!lat || !lon || !id) return json({ error: "missing params" }, 400);
      return await fetchMeteo(
        `https://rpcache.meteo.nc/internet2018client/2.0/observation/history?lat=${lat}&lon=${lon}&id=${id}`
      );
    }

    // =========================
    // PROXY HTML — scraping meteo.nc (pour récupérer les rafales absentes de l'API JSON)
    // =========================
    if (url.pathname === "/proxy") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400, headers: corsHeaders });
      // Sécurité : n'autoriser que meteo.nc
      if (!target.startsWith("https://meteo.nc/")) {
        return new Response("Unauthorized domain", { status: 403, headers: corsHeaders });
      }
      const proxied = await fetch(target, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SurfNC/1.0)" },
      });
      return new Response(proxied.body, {
        status: proxied.status,
        headers: {
          "Content-Type": proxied.headers.get("Content-Type") || "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=1800", // cache 30min côté Cloudflare
        },
      });
    }

    return json({ ok: true, status: "worker ready" });
  },

  // =========================
  // CRON — vérifie l'état du token en KV
  // Tourne toutes les 5min (*/5 * * * *)
  // NE peut PAS récupérer un nouveau token (rpcache lie le Bearer à l'IP client)
  // Rôle : alerter si le token a expiré et n'a pas été renouvelé par l'extension
  // =========================
  async scheduled(event, env, ctx) {
    console.log("[Cron] Tick —", new Date().toISOString());

    let token = null;
    try {
      token = await env.KV_BINDING.get("jwt");
    } catch (e) {
      console.error("[Cron] KV read error:", e.message);
      return; // ne pas planter — juste logger
    }

    if (!token) {
      console.warn("[Cron] ⚠ Aucun token en KV — extension pas encore utilisée ?");
      return;
    }

    const info = tokenInfo(token);

    if (!info.valid) {
      console.warn(
        "[Cron] 🔴 Token expiré depuis",
        info.ageMin != null ? info.ageMin + "min" : "durée inconnue",
        "— en attente que l'extension renouvelle"
      );
    } else {
      console.log(
        "[Cron] 🟢 Token valide,",
        info.expiresIn != null
          ? "expire dans " + info.expiresIn + "min"
          : "âge " + info.ageMin + "min"
      );
    }
  },
};

// =========================
// UTILITAIRE — infos JWT sans vérification de signature
// =========================
function tokenInfo(token) {
  if (!token || !token.startsWith("eyJ")) {
    return { valid: false, ageMin: null, expiresIn: null };
  }
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp) {
      const expiresIn = Math.round((payload.exp - now) / 60);
      return { valid: payload.exp > now + 30, ageMin: null, expiresIn };
    }
    if (payload.iat) {
      const ageMin = Math.round((now - payload.iat) / 60);
      return { valid: ageMin < 22, ageMin, expiresIn: Math.max(0, 22 - ageMin) };
    }
    return { valid: true, ageMin: null, expiresIn: null };
  } catch (e) {
    return { valid: false, ageMin: null, expiresIn: null };
  }
}
