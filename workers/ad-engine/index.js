// ============================================================
// workers/ad-engine/index.js
// Cloudflare Worker: Geohash 캐싱 + 광고 라우팅 미들웨어
// 역할: Supabase Edge Function 앞단에서 KV 캐시로 요청 수 절감
// 무료 한도: 일 100,000 요청 / KV 읽기 10만 회
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 처리
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── 라우팅 ───────────────────────────────────────────────
    if (url.pathname === "/api/nearby-ads" && request.method === "POST") {
      return handleNearbyAds(request, env, ctx, corsHeaders);
    }
    if (url.pathname === "/api/playlists" && request.method === "GET") {
      return handlePlaylists(request, env, corsHeaders);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ── 1. 주변 광고 식당 (KV 캐시 적용) ─────────────────────
async function handleNearbyAds(request, env, ctx, corsHeaders) {
  const body = await request.json();
  const { lat, lng, radius = 1000, slots = 3 } = body;

  if (!lat || !lng) {
    return jsonResponse({ error: "lat, lng 필요" }, 400, corsHeaders);
  }

  // geohash6 계산 (동 단위 캐시 키)
  const gh6 = encodeGeohash(lat, lng, 6);
  const cacheKey = `ads:${gh6}:r${radius}:s${slots}`;

  // ── KV 캐시 조회 (무료 읽기 활용) ──
  const cached = await env.GEO_CACHE.get(cacheKey, { type: "json" });
  if (cached) {
    return jsonResponse({ ...cached, from_cache: true }, 200, corsHeaders);
  }

  // ── 캐시 미스: Supabase Edge Function 호출 ──
  const supabaseRes = await fetch(
    `${env.SUPABASE_URL}/functions/v1/nearby-ads`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_ANON_KEY,
        "x-geohash6": gh6,
      },
      body: JSON.stringify({ lat, lng, radius, slots }),
    }
  );

  if (!supabaseRes.ok) {
    return new Response(supabaseRes.body, {
      status: supabaseRes.status,
      headers: corsHeaders,
    });
  }

  const data = await supabaseRes.json();

  // ── KV에 캐시 저장 (60초 TTL) ──
  // waitUntil: 응답 후 비동기 저장 (응답 속도에 영향 없음)
  ctx.waitUntil(
    env.GEO_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 60 })
  );

  return jsonResponse(data, 200, corsHeaders);
}

// ── 2. 플레이리스트 (1시간 캐시) ────────────────────────
async function handlePlaylists(request, env, corsHeaders) {
  const cacheKey = "playlists:active";

  const cached = await env.GEO_CACHE.get(cacheKey, { type: "json" });
  if (cached) {
    return jsonResponse(cached, 200, corsHeaders);
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/playlists?select=*,playlist_restaurants(rank_position,restaurants(*))&order=sort_order.asc`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    }
  );

  const data = await res.json();

  // 1시간 캐시 (플레이리스트는 자주 바뀌지 않음)
  await env.GEO_CACHE.put(cacheKey, JSON.stringify(data), {
    expirationTtl: 3600,
  });

  return jsonResponse(data, 200, corsHeaders);
}

// ── 유틸: Geohash 인코딩 (외부 라이브러리 없이 구현) ──────
function encodeGeohash(lat, lng, precision = 6) {
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let idx = 0, bit = 0, evenBit = true;
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  let hash = "";

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lngMin = mid; }
      else             { idx = idx * 2;     lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; }
      else            { idx = idx * 2;     latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0; idx = 0;
    }
  }
  return hash;
}

// ── 유틸: JSON 응답 ─────────────────────────────────────
function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
