// ============================================================
// apps/web/src/lib/payment.js
// 토스페이먼츠 결제 유틸 (셀프서비스 광고 결제)
// ============================================================

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY;

// 플랜 정보 정의
export const AD_PLANS = [
  {
    id:          "pinned",
    name:        "상단 고정 노출",
    description: "검색 결과 상단 1~3위에 고정 노출",
    price:       5000,
    unit:        "월",
    badge:       "📌 가장 인기",
    highlight:   true,
  },
  {
    id:          "timesale",
    name:        "점심 타임세일",
    description: "오전 11시~13시 점심 특가 배너 노출",
    price:       1000,
    unit:        "일",
    badge:       "🔥 타임세일",
    highlight:   false,
  },
  {
    id:          "playlist",
    name:        "큐레이션 입점",
    description: "이번 주 특선 플레이리스트 TOP 5 입점",
    price:       3000,
    unit:        "건",
    badge:       "🎯 테마 입점",
    highlight:   false,
  },
];

/**
 * 토스페이먼츠 결제창 호출
 * @param {{
 *   plan: typeof AD_PLANS[0],
 *   restaurantId: string,
 *   advertiserId: string,
 *   restaurantName: string
 * }} params
 */
export async function requestTossPayment({ plan, restaurantId, advertiserId, restaurantName }) {
  if (!TOSS_CLIENT_KEY) {
    throw new Error("VITE_TOSS_CLIENT_KEY 환경변수가 없습니다.");
  }

  // 동적 SDK 로드 (번들에서 제외)
  const { loadTossPayments } = await import(
    "https://js.tosspayments.com/v1/payment"
  );
  const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);

  // orderId: Toss 제한 최대 64자 → UUID 앞 8자씩만 사용 (40자 이하)
  const shortR  = (restaurantId ?? "00000000").replace(/-/g, "").slice(0, 8);
  const shortA  = (advertiserId ?? "00000000").replace(/-/g, "").slice(0, 8);
  const orderId = `${plan.id}_${shortR}_${shortA}_${Date.now()}`;

  // hash SPA 라우팅: /#/ 포함 필수 (없으면 결제 후 빈 화면)
  const origin     = window.location.origin;
  const successUrl = `${origin}/#/dashboard/payment-success`;
  const failUrl    = `${origin}/#/dashboard/payment-fail`;

  await tossPayments.requestPayment("계좌이체", {
    amount:       plan.price,
    orderId,
    orderName:    `도시락탈출 ${plan.name} - ${restaurantName}`,
    customerName: restaurantName,
    successUrl,
    failUrl,
  });
}

/**
 * 결제 성공 후 서버 확인 (Supabase Edge Function 호출)
 * @param {string} paymentKey
 * @param {string} orderId
 * @param {number} amount
 */
export async function confirmPayment(paymentKey, orderId, amount) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey     = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(`${supabaseUrl}/functions/v1/confirm-payment`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "결제 확인 실패");
  }
  return res.json();
}
