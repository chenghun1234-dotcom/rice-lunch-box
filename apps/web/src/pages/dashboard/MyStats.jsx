// ============================================================
// apps/web/src/pages/dashboard/MyStats.jsx
// 업주 무료 인사이트 + 광고 성과 표시 (영업 미끼 데이터)
// ============================================================
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/**
 * @param {{ advertiserId: string }} props
 */
export default function MyStats({ advertiserId }) {
  const [stats,   setStats]   = useState([]);
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchMyStats(advertiserId),
      fetchFreeInsight(advertiserId),
    ]).then(([s, i]) => {
      setStats(s);
      setInsight(i);
    }).finally(() => setLoading(false));
  }, [advertiserId]);

  if (loading) return <p className="loading">성과 데이터 로딩 중...</p>;

  return (
    <div className="my-stats">

      {/* ── 무료 인사이트 (영업 미끼) ── */}
      {insight && (
        <div className="insight-teaser">
          <h3>📍 내 가게 주변 30일 검색 현황</h3>
          <div className="insight-grid">
            <div className="insight-card">
              <span className="insight-value">{insight.total_search?.toLocaleString() ?? "-"}</span>
              <span className="insight-label">가성비 식당 검색 수</span>
            </div>
            <div className="insight-card">
              <span className="insight-value">{insight.top_category ?? "-"}</span>
              <span className="insight-label">주변 1위 카테고리</span>
            </div>
            <div className="insight-card">
              <span className="insight-value">
                {insight.avg_ctr ? (insight.avg_ctr * 100).toFixed(1) + "%" : "-"}
              </span>
              <span className="insight-label">평균 클릭률</span>
            </div>
          </div>
          <p className="insight-cta">
            💡 이 지역에서 <strong>{insight.total_search?.toLocaleString()}명</strong>이 가성비 식당을 찾았습니다.
            {" "}<strong>월 5,000원</strong>으로 1순위에 노출하세요.
          </p>
        </div>
      )}

      {/* ── 광고 성과 (광고 등록 후) ── */}
      {stats.length > 0 ? (
        <>
          <h3>📊 최근 7일 광고 성과</h3>
          <table className="stats-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>노출</th>
                <th>클릭</th>
                <th>클릭률</th>
                <th>슬롯1</th>
                <th>슬롯2</th>
                <th>슬롯3</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={`${row.stat_date}-${row.restaurant_id}`}>
                  <td>{row.stat_date}</td>
                  <td>{row.impressions?.toLocaleString()}</td>
                  <td>{row.clicks?.toLocaleString()}</td>
                  <td className={row.ctr > 0.05 ? "ctr-high" : ""}>
                    {row.ctr ? (row.ctr * 100).toFixed(1) + "%" : "0%"}
                  </td>
                  <td>{row.ad_slot_1}</td>
                  <td>{row.ad_slot_2}</td>
                  <td>{row.ad_slot_3}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 합계 요약 */}
          <div className="stats-summary">
            <span>7일 합계 노출: <strong>{stats.reduce((a, b) => a + (b.impressions ?? 0), 0).toLocaleString()}</strong></span>
            <span>7일 합계 클릭: <strong>{stats.reduce((a, b) => a + (b.clicks ?? 0), 0).toLocaleString()}</strong></span>
          </div>
        </>
      ) : (
        <p className="no-stats">아직 광고가 집계되지 않았습니다. 광고 등록 후 다음날 확인하세요.</p>
      )}
    </div>
  );
}

// ── 내 식당 성과 조회 ────────────────────────────────────
async function fetchMyStats(advertiserId) {
  const { data } = await supabase
    .from("my_restaurant_stats")
    .select("*")
    .eq("advertiser_id", advertiserId)
    .order("stat_date", { ascending: false });
  return data ?? [];
}

// ── 무료 인사이트 조회 (geohash 기반) ──────────────────
async function fetchFreeInsight(advertiserId) {
  // 업주의 첫 번째 식당 geohash6 가져오기
  const { data: ar } = await supabase
    .from("advertiser_restaurants")
    .select("restaurants(geohash6)")
    .eq("advertiser_id", advertiserId)
    .limit(1)
    .single();

  const gh6 = ar?.restaurants?.geohash6;
  if (!gh6) return null;

  const { data } = await supabase.rpc("get_free_insight", { p_geohash6: gh6 });
  return data?.[0] ?? null;
}
