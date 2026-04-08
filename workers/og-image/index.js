/**
 * OG Image Worker — workers/og-image/index.js
 *
 * GET /og?id={restaurant_id}
 * GET /og?slug={seo_slug}
 *
 * Cloudflare Workers Edge + Cache API
 * SVG template → PNG via @resvg/resvg-wasm (WASM loaded once per isolate)
 *
 * 반환: image/png  (Cache-Control: public, max-age=86400)
 * 용도: og:image meta tag URL → KakaoTalk 공유 시 "거지 카드" 미리보기
 */

// ── WASM lazy-init (isolate lifetime) ─────────────────────────────────────────
let resvgInitialized = false;
let Resvg;

async function initResvg() {
  if (resvgInitialized) return;
  // @resvg/resvg-wasm is published to npm; Workers use the WASM ESM build.
  // We load it from the npm CDN bundled with wrangler via Workers ES modules.
  const mod = await import("@resvg/resvg-wasm");
  const wasmResp = await fetch(
    "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm"
  );
  await mod.initWasm(wasmResp);
  Resvg = mod.Resvg;
  resvgInitialized = true;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only serve /og path
    if (url.pathname !== "/og") {
      return new Response("Not found", { status: 404 });
    }

    const restaurantId = url.searchParams.get("id");
    const slug = url.searchParams.get("slug");
    if (!restaurantId && !slug) {
      return new Response("?id or ?slug required", { status: 400 });
    }

    // ── Cache-first ────────────────────────────────────────────────────────────
    const cache = caches.default;
    const cacheKey = new Request(request.url);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    // ── Fetch restaurant data ──────────────────────────────────────────────────
    let restaurant;
    try {
      restaurant = await fetchRestaurant(env, restaurantId, slug);
    } catch (e) {
      return new Response("Failed to load restaurant", { status: 502 });
    }
    if (!restaurant) {
      return renderFallbackPng(env, ctx, cache, cacheKey);
    }

    // ── Build SVG ─────────────────────────────────────────────────────────────
    const svg = buildSvg(restaurant);

    // ── SVG → PNG via resvg-wasm ───────────────────────────────────────────────
    await initResvg();
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
    });
    const pngData = resvg.render().asPng();

    const response = new Response(pngData, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Restaurant-Id": restaurant.id ?? "",
      },
    });

    // Store in edge cache (background)
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

// ── Supabase REST fetch ────────────────────────────────────────────────────────
async function fetchRestaurant(env, id, slug) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;

  let query;
  if (id) {
    query = `${base}/rest/v1/restaurants?id=eq.${encodeURIComponent(id)}&select=id,name,category,price_range,rating,address,is_active&limit=1`;
  } else {
    // seo_pages → restaurant snapshot
    query = `${base}/rest/v1/seo_pages?slug=eq.${encodeURIComponent(slug)}&select=slug,title,description,restaurant_snapshot&limit=1`;
  }

  const resp = await fetch(query, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
  const rows = await resp.json();
  if (!rows.length) return null;

  if (slug) {
    // Shape SEO page into restaurant-like object
    const page = rows[0];
    const snap = page.restaurant_snapshot?.[0] ?? {};
    return {
      name: snap.name ?? page.title,
      category: snap.category ?? "음식점",
      price_range: snap.price_range ?? "₩",
      rating: snap.rating ?? null,
      address: page.title,
      id: null,
    };
  }
  return rows[0];
}

// ── SVG template (1200 × 630) ─────────────────────────────────────────────────
function buildSvg(r) {
  const name = escXml(r.name ?? "음식점");
  const category = escXml(r.category ?? "");
  const price = escXml(r.price_range ?? "");
  const address = escXml((r.address ?? "").substring(0, 40));
  const rating = r.rating ? `⭐ ${r.rating}` : "";
  const tagline =
    price === "₩" ? "가성비 최강" : price === "₩₩" ? "합리적인 가격" : "프리미엄";

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#0f3460"/>
      <stop offset="100%" style="stop-color:#533483"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Accent blobs -->
  <circle cx="1050" cy="80" r="200" fill="#e94560" opacity="0.15"/>
  <circle cx="150" cy="550" r="150" fill="#533483" opacity="0.2"/>

  <!-- Card -->
  <rect x="80" y="80" width="1040" height="470" rx="24" fill="url(#card)" opacity="0.85"/>

  <!-- Brand -->
  <text x="130" y="155" font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="28" fill="#e94560" font-weight="700">🍱 도시락탈출</text>

  <!-- Restaurant name -->
  <text x="130" y="265"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="72" fill="#ffffff" font-weight="800">${name}</text>

  <!-- Category + price row -->
  <rect x="130" y="295" width="160" height="44" rx="22" fill="#e94560"/>
  <text x="210" y="324" text-anchor="middle"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="22" fill="#fff" font-weight="600">${category}</text>

  <rect x="306" y="295" width="100" height="44" rx="22" fill="#533483"/>
  <text x="356" y="324" text-anchor="middle"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="22" fill="#fff" font-weight="600">${price}</text>

  <!-- Tagline -->
  <text x="130" y="400"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="38" fill="#a8b2d8" font-weight="400">${tagline} · ${rating}</text>

  <!-- Address -->
  <text x="130" y="460"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="26" fill="#8892b0">📍 ${address}</text>

  <!-- CTA -->
  <rect x="880" y="440" width="200" height="60" rx="30" fill="#e94560"/>
  <text x="980" y="478" text-anchor="middle"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="24" fill="#fff" font-weight="700">지금 보기 →</text>

  <!-- Bottom bar -->
  <rect x="80" y="520" width="1040" height="4" rx="2" fill="#e94560" opacity="0.5"/>
  <text x="130" y="558"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-size="20" fill="#8892b0">dosirak-escape.pages.dev</text>
</svg>`.trim();
}

// ── Fallback PNG (plain branded card) ─────────────────────────────────────────
async function renderFallbackPng(env, ctx, cache, cacheKey) {
  const svg = buildFallbackSvg();
  await initResvg();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  const pngData = resvg.render().asPng();
  const response = new Response(pngData, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function buildFallbackSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#1a1a2e"/>
  <text x="600" y="290" text-anchor="middle"
        font-family="sans-serif" font-size="80" fill="#e94560">🍱</text>
  <text x="600" y="380" text-anchor="middle"
        font-family="sans-serif" font-size="52" fill="#fff" font-weight="700">도시락탈출</text>
  <text x="600" y="440" text-anchor="middle"
        font-family="sans-serif" font-size="28" fill="#a8b2d8">내 주변 가성비 식당 찾기</text>
</svg>`.trim();
}

// ── XML escape ────────────────────────────────────────────────────────────────
function escXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
