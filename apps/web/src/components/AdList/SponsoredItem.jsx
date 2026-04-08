// ============================================================
// apps/web/src/components/AdList/SponsoredItem.jsx
// 상단 고정 광고 카드 컴포넌트 (Pinned / 타임세일 배지 포함)
// ============================================================
import React from "react";

/**
 * @param {{
 *   ad: {
 *     id: string, name: string, category: string, address: string,
 *     avg_price: number, image_url: string, plan_type: string,
 *     discount_label: string, sale_price: number,
 *     timesale_start: number, timesale_end: number,
 *     distance_m: number, is_timesale_now: boolean
 *   },
 *   slot: number,         // 1~3
 *   onAdClick: (id, slot) => void
 * }} props
 */
export default function SponsoredItem({ ad, slot, onAdClick }) {
  const isTimeSale = ad.is_timesale_now && ad.discount_label;
  const distanceLabel =
    ad.distance_m < 1000
      ? `${Math.round(ad.distance_m)}m`
      : `${(ad.distance_m / 1000).toFixed(1)}km`;

  return (
    <li
      className={`sponsored-item ${isTimeSale ? "timesale" : ""}`}
      onClick={() => onAdClick(ad.id, slot)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onAdClick(ad.id, slot)}
      aria-label={`광고: ${ad.name}`}
    >
      {/* 배지 */}
      <div className="badges">
        {slot <= 3 && <span className="badge badge--pinned">📌 추천</span>}
        {isTimeSale && (
          <span className="badge badge--timesale">
            🔥 점심특가 {ad.timesale_start}~{ad.timesale_end}시
          </span>
        )}
      </div>

      {/* 이미지 (URL만 저장, 스토리지 비용 0) */}
      {ad.image_url && (
        <img
          className="sponsored-item__img"
          src={ad.image_url}
          alt={ad.name}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}

      {/* 정보 */}
      <div className="sponsored-item__info">
        <div className="sponsored-item__header">
          <strong className="sponsored-item__name">{ad.name}</strong>
          <span className="sponsored-item__dist">{distanceLabel}</span>
        </div>

        <span className="sponsored-item__category">{ad.category}</span>

        <div className="sponsored-item__price">
          {isTimeSale && ad.sale_price ? (
            <>
              <s className="price--original">
                {ad.avg_price?.toLocaleString()}원
              </s>
              <strong className="price--sale">
                {ad.sale_price.toLocaleString()}원
              </strong>
              <span className="price--label">{ad.discount_label}</span>
            </>
          ) : (
            <span>{ad.avg_price?.toLocaleString() ?? "가격 미정"}원</span>
          )}
        </div>

        <p className="sponsored-item__address">{ad.address}</p>
      </div>

      {/* 광고 표시 (법적 의무) */}
      <span className="ad-disclosure">광고</span>
    </li>
  );
}
