// ============================================================
// supabase/functions/nearby-ads/index.ts
// Supabase Edge Function: 위치 기반 광고 식당 반환
// 호출: POST /functions/v1/nearby-ads
// Body: { lat: number, lng: number, radius?: number, slots?: number }
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { lat, lng, radius = 1000, slots = 3 } = await req.json();

    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ error: "lat, lng 파라미터가 필요합니다." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // anon key로 클라이언트 생성 (RLS 적용됨)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    // PostGIS 함수 호출 (003_postgis_functions.sql 에 정의됨)
    const { data, error } = await supabase.rpc("nearby_ad_restaurants", {
      user_lat:   lat,
      user_lng:   lng,
      radius_m:   radius,
      slot_limit: slots,
    });

    if (error) throw error;

    // 노출(impression) 이벤트 비동기 기록 (응답을 막지 않음)
    if (data && data.length > 0) {
      const geohash6 = req.headers.get("x-geohash6") ?? null;
      const events = data.map((r: any, idx: number) => ({
        event_type:    "impression",
        restaurant_id: r.id,
        ad_slot:       idx + 1,
        geohash6,
        lat,
        lng,
        user_agent: req.headers.get("user-agent"),
      }));

      // fire-and-forget: 로그 실패해도 응답엔 영향 없음
      supabase.from("user_events").insert(events).then(() => {});
    }

    return new Response(
      JSON.stringify({ ads: data ?? [], count: data?.length ?? 0 }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          // 30초 캐시 (같은 위치 중복 호출 방지)
          "Cache-Control": "public, max-age=30",
        },
      }
    );
  } catch (err) {
    console.error("nearby-ads error:", err);
    return new Response(
      JSON.stringify({ error: "서버 오류가 발생했습니다." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
