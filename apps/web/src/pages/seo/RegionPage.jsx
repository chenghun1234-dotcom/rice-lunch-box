/**
 * RegionPage.jsx — apps/web/src/pages/seo/RegionPage.jsx
 *
 * Programmatic SEO 랜딩 페이지
 * URL: /#/r/{slug}  예) #/r/mapo-gu-hapjeong-dong-jomshik
 *
 * - seo_pages 테이블에서 slug 조회
 * - <title> / <meta description> / og:* / JSON-LD 동적 주입
 * - Restaurant 목록 + CTA (지도에서 보기)
 * - increment_seo_view(slug) RPC 호출 (뷰 카운트)
 */
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

// ── Meta tag helpers ──────────────────────────────────────────────────────────
function setMeta(name, content, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function injectSeoTags(page) {
  const ogImageUrl = `${window.WORKER_OG_URL ?? "https://og.dosirak-escape.workers.dev"}/og?slug=${encodeURIComponent(page.slug)}`;

  document.title = page.title + " | 도시락탈출";
  setMeta("description", page.description);
  setMeta("keywords", (page.keywords ?? []).join(", "));

  // Open Graph
  setMeta("og:type", "website", true);
  setMeta("og:title", page.title, true);
  setMeta("og:description", page.description, true);
  setMeta("og:image", ogImageUrl, true);
  setMeta("og:url", window.location.href, true);

  // Twitter Card
  setMeta("twitter:card", "summary_large_image");
  setMeta("twitter:title", page.title);
  setMeta("twitter:description", page.description);
  setMeta("twitter:image", ogImageUrl);

  // Canonical link
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = window.location.href;

  // JSON-LD structured data
  const restaurants = (page.restaurant_snapshot ?? []).slice(0, 5);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: page.title,
    description: page.description,
    itemListElement: restaurants.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Restaurant",
        name: r.name,
        servesCuisine: r.category,
        priceRange: r.price_range,
        address: {
          "@type": "PostalAddress",
          addressLocality: r.address ?? "",
          addressCountry: "KR",
        },
        ...(r.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: r.rating, bestRating: 5 } } : {}),
      },
    })),
  };

  let ldScript = document.querySelector('script[type="application/ld+json"][data-seo-page]');
  if (!ldScript) {
    ldScript = document.createElement("script");
    ldScript.type = "application/ld+json";
    ldScript.dataset.seoPage = "1";
    document.head.appendChild(ldScript);
  }
  ldScript.textContent = JSON.stringify(jsonLd);
}

// ── Price stars ───────────────────────────────────────────────────────────────
function PriceRange({ value }) {
  const levels = { "₩": 1, "₩₩": 2, "₩₩₩": 3, "₩₩₩₩": 4 };
  const n = levels[value] ?? 1;
  return (
    <span className="price-range">
      {"₩".repeat(n)}
      <span className="price-dim">{"₩".repeat(4 - n)}</span>
    </span>
  );
}

// ── Restaurant card ───────────────────────────────────────────────────────────
function RestaurantCard({ r, onView }) {
  return (
    <article className="seo-card" onClick={() => onView(r)}>
      <div className="seo-card__body">
        <span className="seo-card__category">{r.category ?? "음식점"}</span>
        <h3 className="seo-card__name">{r.name}</h3>
        <p className="seo-card__address">📍 {r.address}</p>
        <div className="seo-card__meta">
          <PriceRange value={r.price_range} />
          {r.rating && <span className="seo-card__rating">⭐ {r.rating}</span>}
          {r.is_sponsored && <span className="seo-card__badge">🏆 추천</span>}
        </div>
      </div>
      <button className="seo-card__cta">지도 보기</button>
    </article>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="seo-card seo-card--skeleton">
      <div className="skeleton-line w60" />
      <div className="skeleton-line w90" />
      <div className="skeleton-line w45" />
    </div>
  );
}

// ── Breadcrumbs ───────────────────────────────────────────────────────────────
function Breadcrumb({ slug }) {
  const parts = (slug ?? "").split("-");
  // simple heuristic: split slug back into readable breadcrumb
  return (
    <nav className="breadcrumb" aria-label="breadcrumb">
      <a href="/#/">홈</a>
      <span>›</span>
      <a href="/#/region">지역별</a>
      <span>›</span>
      <span>{slug}</span>
    </nav>
  );
}

// ── Nearby pages (related links) ─────────────────────────────────────────────
function RelatedPages({ currentSlug }) {
  const [pages, setPages] = useState([]);

  useEffect(() => {
    // fetch pages with same geohash prefix (nearby)
    const prefix = currentSlug?.split("-").slice(0, 3).join("-") ?? "";
    supabase
      .from("seo_pages")
      .select("slug, title")
      .like("slug", `${prefix}%`)
      .neq("slug", currentSlug)
      .limit(6)
      .then(({ data }) => setPages(data ?? []));
  }, [currentSlug]);

  if (!pages.length) return null;

  return (
    <section className="related-pages">
      <h4>🗺️ 인근 지역 맛집도 찾아보세요</h4>
      <ul>
        {pages.map((p) => (
          <li key={p.slug}>
            <a href={`/#/r/${p.slug}`}>{p.title}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Main RegionPage ───────────────────────────────────────────────────────────
export default function RegionPage({ slug }) {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    supabase
      .from("seo_pages")
      .select("*")
      .eq("slug", slug)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError("페이지를 찾을 수 없습니다.");
          setLoading(false);
          return;
        }
        setPage(data);
        setLoading(false);

        // Inject SEO meta tags
        injectSeoTags(data);

        // Increment view count (fire-and-forget)
        supabase.rpc("increment_seo_view", { p_slug: slug }).catch(() => {});
      });
  }, [slug]);

  // Restore original title on unmount
  useEffect(() => {
    return () => {
      document.title = "도시락탈출 — 내 주변 가성비 식당";
    };
  }, []);

  function handleViewOnMap(r) {
    // Navigate to home map with coordinates
    if (r.lat && r.lng) {
      window.location.hash = `/?lat=${r.lat}&lng=${r.lng}&zoom=17`;
    } else {
      window.location.hash = "/";
    }
  }

  if (loading) {
    return (
      <div className="region-page">
        <div className="region-page__header skeleton-header">
          <div className="skeleton-line w50" style={{ height: 40, marginBottom: 12 }} />
          <div className="skeleton-line w80" />
        </div>
        <div className="region-page__list">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="region-page region-page--error">
        <h2>😢 {error}</h2>
        <p>잘못된 주소이거나 데이터가 아직 생성되지 않았습니다.</p>
        <a href="/#/" className="btn-primary">홈으로 돌아가기</a>
      </div>
    );
  }

  const restaurants = page?.restaurant_snapshot ?? [];
  const themeEmoji = { "점심특가": "🍜", "가성비": "💰", "혼밥": "🧑‍🍳" };
  const emoji = Object.entries(themeEmoji).find(([k]) => (page?.title ?? "").includes(k))?.[1] ?? "🍽️";

  return (
    <main className="region-page">
      {/* Hero */}
      <header className="region-page__header">
        <Breadcrumb slug={slug} />
        <h1 className="region-page__title">
          {emoji} {page.title}
        </h1>
        <p className="region-page__desc">{page.description}</p>
        <div className="region-page__stats">
          <span>👁️ {(page.view_count ?? 0).toLocaleString()}회 조회</span>
          <span>🏪 {restaurants.length}개 식당</span>
          <span>🕒 {new Date(page.updated_at).toLocaleDateString("ko-KR")} 기준</span>
        </div>
      </header>

      {/* Restaurant list */}
      <section className="region-page__list">
        {restaurants.length === 0 ? (
          <div className="region-page__empty">
            <p>아직 등록된 식당이 없습니다.</p>
            <a href="/#/submit" className="btn-secondary">첫 번째로 제보하기</a>
          </div>
        ) : (
          restaurants.map((r) => (
            <RestaurantCard key={r.id ?? r.name} r={r} onView={handleViewOnMap} />
          ))
        )}
      </section>

      {/* CTA banner */}
      <section className="region-page__cta-banner">
        <div>
          <h3>📍 {page.title} 식당이신가요?</h3>
          <p>무료로 등록하고 주변 손님들에게 알려보세요.</p>
        </div>
        <a href="/#/dashboard" className="btn-primary">내 식당 등록 →</a>
      </section>

      {/* User report CTA */}
      <section className="region-page__report-cta">
        <p>🙋 이 동네 맛집 정보를 더 알고 계신가요?</p>
        <a href={`/#/submit?area=${encodeURIComponent(page.title)}`} className="btn-secondary">
          직접 제보하기
        </a>
      </section>

      {/* Related pages */}
      <RelatedPages currentSlug={slug} />

      {/* SEO footer text (hidden visually but crawlable) */}
      <footer className="region-page__seo-footer">
        <p>
          {page.description} 도시락탈출 앱에서 {page.title} 주변 모든 식당의 실시간
          정보와 특가 메뉴를 한눈에 확인할 수 있습니다. 지도 기반으로 거리 순
          정렬, 가격대 필터, 시간대별 특가를 제공합니다.
        </p>
        {(page.keywords ?? []).length > 0 && (
          <ul className="seo-tags">
            {(page.keywords ?? []).map((kw) => (
              <li key={kw}>
                <span>{kw}</span>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </main>
  );
}
