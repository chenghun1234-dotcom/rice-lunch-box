// ============================================================
// workers/log-collector/index.js
// Cloudflare Worker: 원본 이벤트 로그를 R2에 NDJSON으로 저장
// 역할: DB 용량 절약 - 원본은 R2(무료), 요약만 Supabase DB에 보관
// R2 무료 티어: 저장 10GB / 월, 읽기 1,000만 회 / 월
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/log" && request.method === "POST") {
      return handleLog(request, env, corsHeaders);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ── 로그 수신 → R2 저장 ──────────────────────────────────
async function handleLog(request, env, corsHeaders) {
  let events;
  try {
    const body = await request.json();
    events = Array.isArray(body) ? body : [body];
  } catch {
    return new Response(JSON.stringify({ error: "JSON 파싱 오류" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 타임스탬프 주입
  const enriched = events.map((e) => ({
    ...e,
    ts:         Date.now(),
    user_agent: request.headers.get("user-agent") ?? "",
    cf_country: request.cf?.country ?? "",
    cf_city:    request.cf?.city    ?? "",
  }));

  // ── R2 키: logs/YYYY/MM/DD/HH/{uuid}.ndjson ──────────────
  const now  = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(now.getUTCDate()).padStart(2, "0");
  const hh   = String(now.getUTCHours()).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const r2Key = `logs/${yyyy}/${mm}/${dd}/${hh}/${uuid}.ndjson`;

  // NDJSON 포맷 (줄당 JSON 1개 → 배치 분석 친화적)
  const ndjson = enriched.map((e) => JSON.stringify(e)).join("\n");

  await env.LOG_BUCKET.put(r2Key, ndjson, {
    httpMetadata: { contentType: "application/x-ndjson" },
  });

  // 클릭 이벤트는 실시간으로 Supabase에도 전달 (집계에 사용)
  const clicks = enriched.filter((e) => e.event_type === "click");
  if (clicks.length > 0) {
    await forwardToSupabase(clicks, env);
  }

  return new Response(
    JSON.stringify({ saved: enriched.length, r2_key: r2Key }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── 클릭 이벤트만 Supabase에 전달 (실시간 집계용) ─────────
async function forwardToSupabase(clicks, env) {
  const rows = clicks.map(({ event_type, restaurant_id, ad_slot, geohash6, lat, lng, user_agent }) => ({
    event_type, restaurant_id, ad_slot, geohash6, lat, lng, user_agent,
  }));

  await fetch(`${env.SUPABASE_URL}/rest/v1/user_events`, {
    method:  "POST",
    headers: {
      apikey:         env.SUPABASE_ANON_KEY,
      Authorization:  `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer:         "return=minimal",
    },
    body: JSON.stringify(rows),
  });
}
