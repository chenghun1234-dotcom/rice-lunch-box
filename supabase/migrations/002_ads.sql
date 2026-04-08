-- ============================================================
-- 002_ads.sql  |  광고/입점 테이블 + 타임세일 로직
-- ============================================================

-- ── 광고주(식당 업주) 테이블 ──────────────────────────────
CREATE TABLE IF NOT EXISTS advertisers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  contact_email TEXT,
  contact_phone TEXT,
  plan_type     TEXT NOT NULL DEFAULT 'pinned',
  -- 'pinned'        : 상단 고정 노출 (월 5,000원)
  -- 'playlist'      : 큐레이션 테마 입점 (건당 3,000원)
  -- 'timesale'      : 시간제 점심 특가 (일 1,000원)
  plan_start    DATE NOT NULL,
  plan_end      DATE NOT NULL,
  budget_krw    INTEGER DEFAULT 0,             -- 납부 금액 (원)
  is_paid       BOOLEAN DEFAULT false,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advertisers_restaurant_idx ON advertisers(restaurant_id);
CREATE INDEX IF NOT EXISTS advertisers_active_idx     ON advertisers(is_active, plan_end);

-- ── 플레이리스트 (큐레이션 테마) ─────────────────────────
CREATE TABLE IF NOT EXISTS playlists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,          -- URL 경로 (예: lunch-special-top5)
  title         TEXT NOT NULL,                 -- "이번 주 직장인 점심 특가 TOP 5"
  description   TEXT,
  theme_tag     TEXT,                          -- 필터용 태그 (예: 점심특가, 가성비)
  valid_from    TIMESTAMPTZ,
  valid_until   TIMESTAMPTZ,
  is_sponsored  BOOLEAN DEFAULT true,
  sort_order    INTEGER DEFAULT 0,             -- 낮을수록 상단 노출
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 플레이리스트 ↔ 식당 N:M
CREATE TABLE IF NOT EXISTS playlist_restaurants (
  playlist_id   UUID REFERENCES playlists(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  rank_position SMALLINT DEFAULT 1,            -- 플레이리스트 내 순서
  PRIMARY KEY (playlist_id, restaurant_id)
);

-- ── 타임세일 (점심 특가) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS timesales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  discount_label TEXT NOT NULL,                -- "오늘만 15% 할인"
  original_price INTEGER,
  sale_price     INTEGER,
  active_days    TEXT[] DEFAULT '{"mon","tue","wed","thu","fri"}',
  start_hour     SMALLINT DEFAULT 11,          -- 11시
  end_hour       SMALLINT DEFAULT 13,          -- 13시
  valid_until    DATE NOT NULL,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timesales_active_idx ON timesales(is_active, valid_until);

-- ── 핵심 뷰: 광고 노출 대상 식당 (반경 검색용) ───────────
-- 이 뷰를 PostGIS 함수와 조합하여 1쿼리로 주변 광고 식당을 가져옴
CREATE OR REPLACE VIEW active_ad_restaurants AS
SELECT
  r.id,
  r.name,
  r.category,
  r.address,
  r.avg_price,
  r.image_url,
  r.menu_summary,
  r.tags,
  r.geohash6,
  r.location,
  a.plan_type,
  a.plan_end,
  t.discount_label,
  t.sale_price,
  t.start_hour  AS timesale_start,
  t.end_hour    AS timesale_end,
  t.active_days AS timesale_days
FROM restaurants r
JOIN advertisers a ON a.restaurant_id = r.id
LEFT JOIN timesales t ON t.restaurant_id = r.id AND t.is_active = true AND t.valid_until >= CURRENT_DATE
WHERE
  r.is_active    = true
  AND a.is_active = true
  AND a.is_paid   = true
  AND a.plan_end  >= CURRENT_DATE;

-- RLS
ALTER TABLE advertisers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_restaurants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesales              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ads_public_read"        ON advertisers          FOR SELECT USING (is_active = true);
CREATE POLICY "playlists_public_read"  ON playlists            FOR SELECT USING (true);
CREATE POLICY "pl_rest_public_read"    ON playlist_restaurants FOR SELECT USING (true);
CREATE POLICY "timesales_public_read"  ON timesales            FOR SELECT USING (is_active = true);
