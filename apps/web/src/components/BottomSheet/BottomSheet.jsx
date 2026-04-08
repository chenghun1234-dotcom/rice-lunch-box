// ============================================================
// apps/web/src/components/BottomSheet/BottomSheet.jsx
//
// 지도 하단 식당 리스트 (BottomSheet 스타일)
//
// 3단계 높이:
//   peek  = 72px  (핸들 + 첫 카드 살짝 보임)
//   half  = 42vh  (절반)
//   full  = 88vh  (거의 전체)
//
// 기능:
//   - 드래그 핸들로 높이 전환
//   - 정렬: 거리순 / 가격순
//   - 거리 뱃지 (내 위치 기준 m/km)
//   - 광고 식당 🏆 배지
//   - 클릭 → onSelect(restaurant) 콜백
// ============================================================
import React, { useRef, useState, useMemo, useCallback } from "react";

// ── 거리 계산 (Haversine) ─────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371000; // 미터
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m) {
  if (!m || m < 0) return null;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

// ── 식당 카드 ─────────────────────────────────────────────────────────────────
function StoreCard({ r, myLat, myLng, onSelect, isSelected }) {
  const dist = myLat && myLng && r.lat && r.lng
    ? haversine(myLat, myLng, r.lat, r.lng)
    : null;

  const isAd = !!r.is_ad;

  return (
    <li
      className={[
        "bs-card",
        isAd        ? "bs-card--ad"     : "",
        isSelected  ? "bs-card--active" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(r)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(r)}
    >
      <div className="bs-card__left">
        <span className="bs-card__category">
          {isAd && <span className="bs-card__ad-badge">AD</span>}
          {r.category ?? "음식점"}
        </span>
        <p className="bs-card__name">{r.name}</p>
        {r.main_menu && (
          <p className="bs-card__menu">{r.main_menu}</p>
        )}
        {r.discount_label && (
          <p className="bs-card__discount">🔥 {r.discount_label}</p>
        )}
      </div>
      <div className="bs-card__right">
        {r.avg_price ? (
          <span className={`bs-card__price${isAd ? " bs-card__price--ad" : ""}`}>
            {r.avg_price.toLocaleString()}원
          </span>
        ) : (
          <span className={`bs-card__price${isAd ? " bs-card__price--ad" : ""}`}>
            {r.price_range ?? "₩"}
          </span>
        )}
        {dist !== null && (
          <span className="bs-card__dist">{formatDist(dist)}</span>
        )}
      </div>
    </li>
  );
}

// ── BottomSheet 메인 ──────────────────────────────────────────────────────────
const HEIGHTS = ["peek", "half", "full"];

export default function BottomSheet({ restaurants = [], myLat, myLng, onSelect, selected }) {
  const [stage, setStage]   = useState("half"); // peek | half | full
  const [sort, setSort]     = useState("dist"); // dist | price
  const sheetRef            = useRef(null);
  const dragStartY          = useRef(null);
  const dragStartStage      = useRef(null);

  // ── 거리+정렬 ────────────────────────────────────────────
  const sorted = useMemo(() => {
    const withDist = restaurants.map((r) => ({
      ...r,
      _dist: myLat && myLng && r.lat && r.lng
        ? haversine(myLat, myLng, r.lat, r.lng)
        : Infinity,
    }));
    if (sort === "price") {
      return [...withDist].sort((a, b) => (a.avg_price ?? 99999) - (b.avg_price ?? 99999));
    }
    return [...withDist].sort((a, b) => a._dist - b._dist);
  }, [restaurants, myLat, myLng, sort]);

  // ── 드래그 핸들 (터치 + 마우스) ──────────────────────────
  const onPointerDown = useCallback((e) => {
    dragStartY.current    = e.clientY ?? e.touches?.[0]?.clientY;
    dragStartStage.current = stage;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [stage]);

  const onPointerUp = useCallback((e) => {
    if (dragStartY.current === null) return;
    const endY = e.clientY ?? e.changedTouches?.[0]?.clientY ?? dragStartY.current;
    const dy   = dragStartY.current - endY; // 위 = 양수, 아래 = 음수
    const cur  = HEIGHTS.indexOf(dragStartStage.current);

    if (dy > 40 && cur < HEIGHTS.length - 1) setStage(HEIGHTS[cur + 1]); // 위로 → 더 열기
    else if (dy < -40 && cur > 0)            setStage(HEIGHTS[cur - 1]); // 아래로 → 닫기

    dragStartY.current = null;
  }, []);

  // ── 높이 CSS 변수 ─────────────────────────────────────────
  const heightMap = { peek: "72px", half: "40vh", full: "88vh" };

  return (
    <div
      ref={sheetRef}
      className={`bottom-sheet bottom-sheet--${stage}`}
      style={{ "--bs-height": heightMap[stage] }}
      aria-label="주변 식당 목록"
    >
      {/* 드래그 핸들 */}
      <div
        className="bs-handle"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onTouchStart={(e) => { dragStartY.current = e.touches[0].clientY; dragStartStage.current = stage; }}
        onTouchEnd={(e)   => { const dy = dragStartY.current - e.changedTouches[0].clientY; const cur = HEIGHTS.indexOf(stage); if (dy > 40 && cur < 2) setStage(HEIGHTS[cur+1]); else if (dy < -40 && cur > 0) setStage(HEIGHTS[cur-1]); dragStartY.current = null; }}
      >
        <span className="bs-handle__bar" />
      </div>

      {/* 헤더 */}
      <div className="bs-header">
        <p className="bs-header__count">
          {stage === "peek"
            ? <span onClick={() => setStage("half")} style={{cursor:"pointer"}}>▲ 화면 안 식당 {restaurants.length}곳</span>
            : <span>화면 안 식당 <strong>{restaurants.length}</strong>곳</span>
          }
        </p>
        <div className="bs-sort">
          <button
            className={`bs-sort__btn${sort === "dist" ? " active" : ""}`}
            onClick={() => setSort("dist")}
          >📍 거리순</button>
          <button
            className={`bs-sort__btn${sort === "price" ? " active" : ""}`}
            onClick={() => setSort("price")}
          >💰 가격순</button>
        </div>
      </div>

      {/* 목록 */}
      <ul className="bs-list">
        {sorted.length === 0 ? (
          <li className="bs-empty">
            <span>이 지역에 등록된 식당이 없습니다</span>
            <small>지도를 이동하면 다른 지역을 볼 수 있어요</small>
          </li>
        ) : (
          sorted.map((r) => (
            <StoreCard
              key={r.id ?? r.name}
              r={r}
              myLat={myLat}
              myLng={myLng}
              onSelect={onSelect}
              isSelected={selected?.id === r.id}
            />
          ))
        )}
      </ul>
    </div>
  );
}
