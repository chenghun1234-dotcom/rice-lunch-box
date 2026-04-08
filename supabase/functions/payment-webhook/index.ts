// ============================================================
// supabase/functions/payment-webhook/index.ts
// 토스페이먼츠 결제 웹훅 처리 (결제 성공 → 광고 활성화)
// 호출: POST /functions/v1/payment-webhook
// 토스 대시보드: 웹훅 URL에 이 엔드포인트 등록 필수
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOSS_SECRET_KEY = Deno.env.get("TOSS_SECRET_KEY")!;
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 플랜별 광고 기간 (일 단위)
const PLAN_DAYS: Record<string, number> = {
  pinned:   30,  // 월 구독
  timesale:  1,  // 일 단위
  playlist: 30,
};

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── 토스페이먼츠 웹훅 서명 검증 ──────────────────────────
  const body       = await req.text();
  const signature  = req.headers.get("toss-signature") ?? "";
  const isValid    = await verifyTossSignature(body, signature);
  if (!isValid) {
    console.error("토스 웹훅 서명 불일치");
    return new Response("Unauthorized", { status: 401 });
  }

  const event = JSON.parse(body);
  console.log("Toss webhook:", event.eventType, event.data?.orderId);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 이벤트 타입별 처리 ────────────────────────────────────
  switch (event.eventType) {

    case "PAYMENT_STATUS_CHANGED": {
      const { paymentKey, orderId, status, approvedAt, totalAmount } = event.data;

      if (status === "DONE") {
        await handlePaymentDone(supabase, { paymentKey, orderId, approvedAt, totalAmount });
      } else if (status === "CANCELED") {
        await handlePaymentCanceled(supabase, orderId);
      }
      break;
    }

    case "BILLING_KEY_ISSUED":
      // 정기결제 빌링키 발급 → billing_keys 테이블에 저장 (선택 구현)
      console.log("빌링키 발급:", event.data?.billingKey);
      break;

    default:
      console.log("처리하지 않는 이벤트:", event.eventType);
  }

  return new Response("ok", { status: 200 });
});

// ── 결제 완료 처리 ─────────────────────────────────────────
async function handlePaymentDone(
  supabase: any,
  { paymentKey, orderId, approvedAt, totalAmount }: any
) {
  // orderId 형식: "{plan_type}_{restaurant_id}_{advertiser_id}_{timestamp}"
  const parts         = orderId.split("_");
  const planType      = parts[0];
  const restaurantId  = parts[1];
  const advertiserId  = parts[2];

  const periodDays = PLAN_DAYS[planType] ?? 30;
  const start      = new Date(approvedAt);
  const end        = new Date(start);
  end.setDate(end.getDate() + periodDays);

  // 1. 결제 기록 업데이트
  await supabase
    .from("subscription_payments")
    .upsert({
      toss_order_id:    orderId,
      toss_payment_key: paymentKey,
      advertiser_id:    advertiserId,
      restaurant_id:    restaurantId,
      plan_type:        planType,
      amount_krw:       totalAmount,
      status:           "done",
      paid_at:          approvedAt,
      period_start:     start.toISOString().split("T")[0],
      period_end:       end.toISOString().split("T")[0],
    }, { onConflict: "toss_order_id" });

  // 2. 광고주 활성화
  await supabase
    .from("advertisers")
    .upsert({
      restaurant_id: restaurantId,
      plan_type:     planType,
      plan_start:    start.toISOString().split("T")[0],
      plan_end:      end.toISOString().split("T")[0],
      budget_krw:    totalAmount,
      is_paid:       true,
      is_active:     true,
    }, { onConflict: "restaurant_id,plan_type,plan_start" });

  console.log(`✅ 광고 활성화: ${restaurantId} (${planType}) ~ ${end.toISOString().split("T")[0]}`);
}

// ── 결제 취소 처리 ─────────────────────────────────────────
async function handlePaymentCanceled(supabase: any, orderId: string) {
  await supabase
    .from("subscription_payments")
    .update({ status: "canceled" })
    .eq("toss_order_id", orderId);

  console.log(`❌ 결제 취소: ${orderId}`);
}

// ── 토스페이먼츠 HMAC-SHA256 서명 검증 ───────────────────
async function verifyTossSignature(body: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const encoder   = new TextEncoder();
    const keyData   = encoder.encode(TOSS_SECRET_KEY);
    const msgData   = encoder.encode(body);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig    = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const hexSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hexSig === signature;
  } catch {
    return false;
  }
}
