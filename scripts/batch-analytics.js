// ============================================================
// scripts/batch-analytics.js
// 매일 새벽 2시 KST (= UTC 17:00) 실행
// 역할 1: user_events → daily_stats 집계 후 Supabase upsert
// 역할 2: 30일 이상 된 raw user_events 삭제 (DB 용량 관리)
// 역할 3: 월별 geo_menu_stats 갱신
// ============================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 집계 대상 날짜 (기본: 어제)
const TARGET_DATE = process.env.TARGET_DATE
  ?? new Date(Date.now() - 86400_000).toISOString().split("T")[0];

console.log("🌙 배치 분석 시작:", TARGET_DATE);

async function main() {
  await Promise.all([
    aggregateDailyStats(),
    aggregateGeoMenuStats(),
  ]);
  await purgeOldEvents();
  console.log("✅ 배치 분석 완료");
}

// ── 1. 일별 통계 집계 ────────────────────────────────────
async function aggregateDailyStats() {
  console.log("📊 daily_stats 집계 중...");

  // Supabase는 복잡한 집계 쿼리를 RPC로 처리
  const { error } = await supabase.rpc("aggregate_daily_stats", {
    p_date: TARGET_DATE,
  });

  if (error) {
    console.error("daily_stats 집계 오류:", error.message);
    throw error;
  }
  console.log("  → daily_stats 완료");
}

// ── 2. 지역별 메뉴 반응도 집계 ───────────────────────────
async function aggregateGeoMenuStats() {
  console.log("🗺  geo_menu_stats 집계 중...");

  const statMonth = TARGET_DATE.slice(0, 7) + "-01"; // YYYY-MM-01

  const { error } = await supabase.rpc("aggregate_geo_menu_stats", {
    p_month: statMonth,
  });

  if (error) {
    console.error("geo_menu_stats 집계 오류:", error.message);
    // 치명적 오류 아님 → 경고만
  } else {
    console.log("  → geo_menu_stats 완료");
  }
}

// ── 3. 30일 이상 된 원본 이벤트 삭제 (DB 용량 절약) ───────
async function purgeOldEvents() {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  console.log("🗑  old events 삭제 기준:", cutoff);

  const { count, error } = await supabase
    .from("user_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    console.error("이벤트 삭제 오류:", error.message);
  } else {
    console.log(`  → ${count}건 삭제됨`);
  }
}

main().catch((e) => {
  console.error("배치 실패:", e);
  process.exit(1);
});
