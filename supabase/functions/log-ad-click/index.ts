// ============================================================
// supabase/functions/log-ad-click/index.ts
// Supabase Edge Function: 광고 클릭 이벤트 기록
// 호출: POST /functions/v1/log-ad-click
// Body: { restaurant_id, ad_slot, lat, lng, geohash6? }
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { restaurant_id, ad_slot, lat, lng, geohash6 } = body;

    if (!restaurant_id) {
      return new Response(
        JSON.stringify({ error: "restaurant_id가 필요합니다." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { error } = await supabase.from("user_events").insert({
      event_type:    "click",
      restaurant_id,
      ad_slot:       ad_slot ?? null,
      geohash6:      geohash6 ?? null,
      lat:           lat ?? null,
      lng:           lng ?? null,
      user_agent:    req.headers.get("user-agent"),
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("log-ad-click error:", err);
    return new Response(
      JSON.stringify({ error: "로그 기록 실패" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
