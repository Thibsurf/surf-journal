// ── Plan A : token autonome via cookie mfsession + ROT13 ─────────────────────
// Si meteo.nc retourne un challenge Cloudflare, activer Plan B (puppeteer).
// Voir commentaire dans scheduled() pour les instructions Plan B.

const TOKEN_PAGE = "https://meteo.nc/fr/marine/";
const TOKEN_TTL  = 900; // 15 min (token meteo.nc dure ~20-25 min)

function rot13(s) {
  return s.replace(/[a-zA-Z]/g, c => {
    const b = c <= "Z" ? 65 : 97;
    return String.fromCharCode(b + (c.charCodeAt(0) - b + 13) % 26);
  });
}

// Fetch TOKEN_PAGE, extrait Set-Cookie mfsession, ROT13 → Bearer JWT
async function fetchFreshToken() {
  const res = await fetch(TOKEN_PAGE, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    redirect: "manual",
  });
  // getSetCookie() gère les headers multiples ; fallback sur get() si non dispo
  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const m = setCookies.join("; ").match(/mfsession=([^;,\s]+)/);
  if (!m) {
    console.warn("[Worker] fetchFreshToken: mfsession absent — status=" + res.status +
      " location=" + (res.headers.get("location") ?? "-"));
    throw new Error(
      "mfsession absent (status=" + res.status + ") — probable challenge Cloudflare → activer Plan B"
    );
  }
  const token = rot13(decodeURIComponent(m[1]));
  console.log("[Worker] Token frais obtenu via mfsession ✓");
  return token;
}

// Retourne le token depuis KV s'il est encore valide, sinon fetch Plan A
async function getToken(env) {
  const cached = await env.KV_BINDING.get("jwt");
  if (cached && tokenInfo(cached).valid) return cached;
  if (cached) console.log("[Worker] Token KV expiré → refresh autonome");
  else        console.log("[Worker] Pas de token en KV → fetch autonome");
  const t = await fetchFreshToken();
  await env.KV_BINDING.put("jwt", t, { expirationTtl: TOKEN_TTL });
  return t;
}

// Proxy vers rpcache avec auto-retry sur 401/403 (token refusé → re-fetch)
async function proxyMeteo(env, endpoint) {
  let token = await getToken(env);
  let res = await fetch(endpoint, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    console.log("[Worker] " + res.status + " sur rpcache — purge KV + re-fetch token");
    await env.KV_BINDING.delete("jwt");
    token = await getToken(env);
    res = await fetch(endpoint, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
  }
  return res;
}

// Retourne { status, body } en JSON, avec fallback raw si le body n'est pas JSON
async function jsonOrRaw(res, cors) {
  const text = await res.text();
  try {
    return new Response(JSON.stringify(JSON.parse(text)), {
      status: res.status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch {
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "text/plain", ...cors },
    });
  }
}

// Infos JWT sans vérification de signature
function tokenInfo(token) {
  if (!token || !token.startsWith("eyJ")) return { valid: false, ageMin: null, expiresIn: null };
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
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
  } catch {
    return { valid: false, ageMin: null, expiresIn: null };
  }
}

// Upsert le token courant dans Supabase shared_tokens — lu par previsions.html en
// fallback quand *.workers.dev est injoignable (DNS mobile filtré). Le cron (5 min)
// garantit ainsi un token < 5 min dans Supabase sans aucune action du PC.
async function pushTokenToSupabase(env, token) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !token) return;
  try {
    const r = await fetch(env.SUPABASE_URL + "/rest/v1/shared_tokens?on_conflict=id", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: "meteo-nc", token, updated_at: new Date().toISOString() }),
    });
    console.log("[Supabase] upsert token:", r.status);
  } catch (e) {
    console.error("[Supabase] push fail:", e.message);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    try {
      // ── /debug ──────────────────────────────────────────────────────────────
      if (url.pathname === "/debug") {
        const token = await env.KV_BINDING.get("jwt");
        const info = tokenInfo(token);
        return json({
          ok: true,
          status: "worker autonome (Plan A)",
          hasToken: !!token,
          tokenPreview: token ? token.slice(0, 20) + "..." : null,
          tokenValid: info.valid,
          tokenAgeMin: info.ageMin,
          tokenExpiresIn: info.expiresIn,
        });
      }

      // ── /token POST — rétrocompat extension Chrome ───────────────────────────
      if (
        (url.pathname === "/token" || url.pathname === "/token-sync") &&
        request.method === "POST"
      ) {
        const body = await request.json();
        if (!body.token) return json({ ok: false, error: "missing token" }, 400);
        const trimmed = body.token.trim();
        await env.KV_BINDING.put("jwt", trimmed, { expirationTtl: 3600 });
        await pushTokenToSupabase(env, trimmed); // propage le token de l'extension vers Supabase
        console.log("[Worker] Token externe stocké (extension), longueur:", trimmed.length);
        return json({ ok: true, stored: true });
      }

      // ── /token GET — retourne un token valide (fetch autonome si nécessaire) ─
      if (url.pathname === "/token" && request.method === "GET") {
        const token = await getToken(env);
        return json({ ok: true, token });
      }

      // ── /forecast — forecast/marine (houle + vent passe) ────────────────────
      if (url.pathname === "/forecast") {
        const lat = url.searchParams.get("lat");
        const lon = url.searchParams.get("lon");
        if (!lat || !lon) return json({ error: "missing lat/lon" }, 400);
        const up = await proxyMeteo(
          env,
          "https://rpcache.meteo.nc/internet2018client/2.0/forecast/marine?lat=" + lat + "&lon=" + lon
        );
        return jsonOrRaw(up, cors);
      }

      // ── /tide — marées (id station SHOM, date optionnelle YYYY-MM-DD) ───────
      // Le param date DOIT être forwardé : sans lui, previsions.html recevait la
      // marée d'AUJOURD'HUI pour toute demande J±N → courbe plate/estimée au-delà.
      if (url.pathname === "/tide") {
        const id = url.searchParams.get("id");
        const date = url.searchParams.get("date");
        if (!id) return json({ error: "missing id" }, 400);
        const up = await proxyMeteo(
          env,
          "https://rpcache.meteo.nc/internet2018client/2.0/tide?id=" + id +
            (date ? "&date=" + encodeURIComponent(date) : "")
        );
        return jsonOrRaw(up, cors);
      }

      // ── /history — observations station ────────────────────────────────────
      if (url.pathname === "/history") {
        const lat = url.searchParams.get("lat");
        const lon = url.searchParams.get("lon");
        const id  = url.searchParams.get("id");
        if (!lat || !lon || !id) return json({ error: "missing params" }, 400);
        const up = await proxyMeteo(
          env,
          "https://rpcache.meteo.nc/internet2018client/2.0/observation/history?lat=" +
            lat + "&lon=" + lon + "&id=" + id
        );
        return jsonOrRaw(up, cors);
      }

      // ── /enso — flux NOAA CPC Nino 3.4 (detrended), cache edge 6h ───────────
      // Le site NOAA n'a pas de CORS → previsions.html passe par ici pour avoir
      // des données ENSO à jour (l'embarqué dans la page n'est qu'un fallback).
      if (url.pathname === "/enso") {
        const src =
          "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/detrend.nino34.ascii.txt";
        const cache = caches.default;
        const cacheKey = new Request("https://surf-nc-cache/enso-nino34");
        let hit = await cache.match(cacheKey);
        if (!hit) {
          const up = await fetch(src, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SurfNC/1.0)" },
          });
          if (!up.ok) return new Response("upstream " + up.status, { status: 502, headers: cors });
          const body = await up.text();
          // Sanité minimale : le fichier commence par l'en-tête YR MON…
          if (!/^\s*YR\s+MON/.test(body))
            return new Response("unexpected upstream format", { status: 502, headers: cors });
          hit = new Response(body, {
            headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=21600" },
          });
          await cache.put(cacheKey, hit.clone());
        }
        return new Response(hit.body, {
          status: 200,
          headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=21600", ...cors },
        });
      }

      // ── /proxy — proxy HTML meteo.nc (scraping rafales) ────────────────────
      if (url.pathname === "/proxy") {
        const target = url.searchParams.get("url");
        if (!target) return new Response("Missing url param", { status: 400, headers: cors });
        if (!target.startsWith("https://meteo.nc/"))
          return new Response("Unauthorized domain", { status: 403, headers: cors });
        const proxied = await fetch(target, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SurfNC/1.0)" },
        });
        return new Response(proxied.body, {
          status: proxied.status,
          headers: {
            "Content-Type": proxied.headers.get("Content-Type") || "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=1800",
          },
        });
      }

      return json({ ok: true, status: "worker ready" });
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },

  // ── Cron : rafraîchit le token proactivement toutes les 5 min ──────────────
  // Plan A (défaut) : fetch TOKEN_PAGE, extrait mfsession, ROT13 → KV.
  // Plan B (si challenge CF) : décommenter les 4 lignes puppeteer ci-dessous,
  //   ajouter dans wrangler.toml :
  //     [browser_rendering]
  //     binding = "BROWSER"
  //   puis : npm i @cloudflare/puppeteer
  async scheduled(event, env) {
    console.log("[Cron] Tick —", new Date().toISOString());
    try {
      // ── Plan A (actif) ─────────────────────────────────────────────────────
      const token = await getToken(env);
      const info = tokenInfo(token);
      console.log(
        "[Cron] Token OK —",
        info.expiresIn != null
          ? "expire dans " + info.expiresIn + "min"
          : "âge " + info.ageMin + "min"
      );
      await pushTokenToSupabase(env, token); // garde Supabase < 5 min frais pour le fallback mobile

      // ── Plan B (inactif — décommenter si Plan A bloqué par Cloudflare) ────
      // const puppeteer = (await import("@cloudflare/puppeteer")).default;
      // const browser = await puppeteer.launch(env.BROWSER);
      // try {
      //   const page = await browser.newPage();
      //   await page.goto(TOKEN_PAGE, { waitUntil: "networkidle0" });
      //   const mf = (await page.cookies()).find(c => c.name === "mfsession");
      //   if (mf) {
      //     const t = rot13(decodeURIComponent(mf.value));
      //     await env.KV_BINDING.put("jwt", t, { expirationTtl: TOKEN_TTL });
      //     console.log("[Cron Plan B] Token puppeteer stocké ✓");
      //   } else {
      //     console.error("[Cron Plan B] mfsession introuvable dans les cookies !");
      //   }
      // } finally {
      //   await browser.close();
      // }
    } catch (e) {
      console.error("[Cron] Échec fetch token:", e.message);
    }
  },
};
