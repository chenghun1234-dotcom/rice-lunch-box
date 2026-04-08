// ============================================================
// apps/web/src/components/AdList/PlaylistCard.jsx
// 큐레이션 테마 플레이리스트 카드 (예: "이번 주 직장인 점심 특가 TOP 5")
// ============================================================
import React from "react";

/**
 * @param {{
 *   playlist: {
 *     id: string, slug: string, title: string, description: string,
 *     theme_tag: string, is_sponsored: boolean,
 *     playlist_restaurants: Array<{ rank_position: number, restaurants: object }>
 *   },
 *   onRestaurantClick: (restaurantId) => void
 * }} props
 */
export default function PlaylistCard({ playlist, onRestaurantClick }) {
  const items = (playlist.playlist_restaurants ?? [])
    .sort((a, b) => a.rank_position - b.rank_position)
    .slice(0, 5);

  return (
    <section className="playlist-card">
      <header className="playlist-card__header">
        <h2 className="playlist-card__title">
          {playlist.is_sponsored && <span className="badge badge--sponsor">스폰서</span>}
          {playlist.title}
        </h2>
        {playlist.description && (
          <p className="playlist-card__desc">{playlist.description}</p>
        )}
      </header>

      <ol className="playlist-card__list">
        {items.map(({ rank_position, restaurants: r }) => (
          <li
            key={r.id}
            className="playlist-card__item"
            onClick={() => onRestaurantClick(r.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onRestaurantClick(r.id)}
          >
            <span className="rank">{rank_position}</span>
            {r.image_url && (
              <img
                src={r.image_url}
                alt={r.name}
                loading="lazy"
                className="playlist-card__img"
              />
            )}
            <div className="playlist-card__item-info">
              <strong>{r.name}</strong>
              <span>{r.avg_price?.toLocaleString() ?? "?"}원</span>
              {r.tags?.length > 0 && (
                <ul className="tag-list">
                  {r.tags.map((tag) => (
                    <li key={tag} className="tag">{tag}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
