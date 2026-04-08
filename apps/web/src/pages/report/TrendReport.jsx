// ============================================================
// apps/web/src/pages/report/TrendReport.jsx
// 지역별 가성비 트렌드 리포트 (유료 구독 B2B 페이지)
// 프랜차이즈 본사 / 식품 제조사 대상 데이터 판매
// ============================================================
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

// 구독 여부 확인 토큰 (URL 쿼리: ?token=xxx)
function getReportToken() {
  return new URLSearchParams(window.location.search).get("token");
}

export default function TrendReport() {
  const [report,   setReport]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [locked,   setLocked]   = useState(false);

  useEffect(() => {
    loadReport();
  }, []);

  async function loadReport() {
    const token = getReportToken();

    // 토큰 없으면 미리보기 모드 (하단 데이터 블러 처리)
    const isSubscriber = await verifyToken(token);
    if (!isSubscriber) setLocked(true);

    const { data } = await supabase
      .from("geo_menu_stats")
      .select("*")
      .order("total_clicks", { ascending: false })
      .order("stat_month", { ascending: false })
      .limit(isSubscriber ? 200 : 10);  // 비구독 최대 10개

    setReport(data ?? []);
    setLoading(false);
  }

  if (loading) return <div className="loading">리포트 생성 중...</div>;

  // 월별 그룹핑
  const byMonth = groupByMonth(report ?? []);
  const months  = Object.keys(byMonth).sort().reverse();

  return (
    <div className="trend-report">
      <header className="report-header">
        <h1>📊 지역별 가성비 트렌드 리포트</h1>
        <p className="report-date">
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long" })} 기준
        </p>
        {locked && (
          <div className="locked-banner">
            🔒 전체 데이터는 유료 구독 후 열람 가능합니다.
            <a href="mailto:hello@dosirak.app" className="btn btn--primary" style={{ marginLeft: 12 }}>
              구독 문의
            </a>
          </div>
        )}
      </header>

      {/* ── 요약 카드 ── */}
      <div className="report-summary">
        <div className="summary-card">
          <span className="summary-value">{report?.length ?? 0}</span>
          <span className="summary-label">분석된 지역·카테고리</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">
            {report?.reduce((a, b) => a + (b.total_clicks ?? 0), 0).toLocaleString()}
          </span>
          <span className="summary-label">총 클릭 수 (지난 달)</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">
            {new Set(report?.map((r) => r.geohash6)).size}
          </span>
          <span className="summary-label">분석된 동 수</span>
        </div>
      </div>

      {/* ── 월별 TOP 지역 테이블 ── */}
      {months.map((month, mIdx) => (
        <section key={month} className={`report-section ${locked && mIdx > 0 ? "blurred" : ""}`}>
          <h2>{formatMonth(month)} 가성비 핫플레이스 TOP</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>지역 (Geohash)</th>
                <th>인기 카테고리</th>
                <th>클릭 수</th>
                <th>인사이트</th>
              </tr>
            </thead>
            <tbody>
              {byMonth[month].slice(0, locked ? 5 : 20).map((row, idx) => (
                <tr key={idx}>
                  <td className="rank-cell">#{idx + 1}</td>
                  <td>
                    <code>{row.geohash6}</code>
                    {row.top_item_name && <span className="geo-hint">{row.top_item_name}</span>}
                  </td>
                  <td>
                    <span className="category-badge">{row.category}</span>
                  </td>
                  <td className="click-cell">{row.total_clicks?.toLocaleString()}</td>
                  <td className="insight-cell">
                    <InsightText row={row} rank={idx + 1} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {locked && mIdx === 0 && (
            <div className="blur-overlay">
              <span>🔒 구독 후 전체 데이터 열람</span>
            </div>
          )}
        </section>
      ))}

      {/* ── B2B 세일즈 CTA ── */}
      <section className="report-cta">
        <h2>이 데이터가 필요한 기업은?</h2>
        <ul>
          <li>🏪 <strong>저가형 프랜차이즈 본사</strong> — 신규 출점 후보지 선정</li>
          <li>🍜 <strong>식품 제조사 / 밀키트 업체</strong> — 지역별 메뉴 반응도 분석</li>
          <li>🏢 <strong>지역 상권 연합회</strong> — 상권 활성화 전략 수립</li>
          <li>📈 <strong>소상공인 컨설팅</strong> — 경쟁 분석 리포트 제공</li>
        </ul>
        <a
          href="mailto:hello@dosirak.app?subject=트렌드 리포트 구독 문의"
          className="btn btn--primary btn--large"
        >
          월 리포트 구독 문의하기 →
        </a>
      </section>
    </div>
  );
}

// ── 헬퍼 ────────────────────────────────────────────────
function groupByMonth(data) {
  return data.reduce((acc, row) => {
    const m = row.stat_month ?? "unknown";
    if (!acc[m]) acc[m] = [];
    acc[m].push(row);
    return acc;
  }, {});
}

function formatMonth(isoDate) {
  try {
    const d = new Date(isoDate);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  } catch { return isoDate; }
}

function InsightText({ row, rank }) {
  if (rank === 1) return <span className="insight-hot">🔥 이 지역 1위</span>;
  if (row.total_clicks > 500) return <span className="insight-rising">📈 급상승 중</span>;
  return <span className="insight-normal">안정적</span>;
}

async function verifyToken(token) {
  if (!token) return false;
  // 실제 구현: subscription_payments 테이블에서 유효한 토큰 확인
  // 여기서는 간단히 'demo_token' 허용
  return token === "demo_token";
}
