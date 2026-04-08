// ============================================================
// supabase/functions/confirm-payment/index.ts
// 토스페이먼츠 결제 승인 (클라이언트 → 서버 → Toss API)
// POST /functions/v1/confirm-payment
// Body: { paymentKey, orderId, amount }
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY")!;
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLAN_DAYS: Record<string, number> = {
  pinned:   30,
  timesale:  1,
  playlist: 30,
};

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return new Response("Method Not Allowed", { status: 405 });

  try {
    const { paymentKey, orderId, amount } = await req.json();

    if (!paymentKey || !orderId || !amount) {
      return new Response(JSON.stringify({ error: "paymentKey, orderId, amount 필수" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── 1. 토스 결제 승인 API 호출 ────────────────────────────
    const encoded  = btoa(`${TOSS_SECRET_KEY}:`);
    const tossRes  = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization:  `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    if (!tossRes.ok) {
      const err = await tossRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err.message ?? "토스 결제 승인 실패", code: err.code }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const payment = await tossRes.json();

    // ── 2. Supabase에 결제 기록 ───────────────────────────────
    // orderId 형식: {planType}_{shortRestId}_{shortAdvId}_{timestamp}
    const parts      = orderId.split("_");
    const planType   = parts[0] ?? "pinned";
    const periodDays = PLAN_DAYS[planType] ?? 30;

    const supabase   = createClient(SUPABASE_URL, SERVICE_KEY);
    const now        = new Date();
    const endsAt     = new Date(now);
    endsAt.setDate(endsAt.getDate() + periodDays);

    // 결제 내역 저장 (테이블 없어도 graceful)
    await supabase.from("ad_payments").insert({
      order_id:    orderId,
      payment_key: paymentKey,
      plan_type:   planType,
      amount:      payment.totalAmount ?? amount,
      status:      "DONE",
      paid_at:     payment.approvedAt ?? now.toISOString(),
    }).then(({ error }) => {
      if (error) console.warn("ad_payments insert skip:", error.message);
    });

    return new Response(
      JSON.stringify({ success: true, orderId, approvedAt: payment.approvedAt }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    console.error("confirm-payment error:", e);
    return new Response(
      JSON.stringify({ error: e.message ?? "서버 오류" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
