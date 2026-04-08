-- ============================================================
-- 001_init.sql  |  기본 테이블 + PostGIS 확장
-- 실행 위치: Supabase SQL Editor (순서대로 실행)
-- ============================================================

-- PostGIS 확장 활성화 (Supabase에서 기본 제공)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- ── 식당 기본 테이블 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  category      TEXT,                          -- 한식, 중식, 분식 등
  address       TEXT NOT NULL,
  phone         TEXT,
  avg_price     INTEGER,                        -- 평균 가격 (원)
  price_range   TEXT DEFAULT '₩',              -- ₩ / ₩₩ / ₩₩₩ / ₩₩₩₩
  main_menu     TEXT,                           -- 대표 메뉴명
  image_url     TEXT,                           -- 외부 이미지 URL만 저장 (스토리지 비용 0)
  menu_summary  JSONB DEFAULT '[]',             -- [{"name":"김치찌개","price":7000}]
  tags          TEXT[] DEFAULT '{}',            -- ["착한가격","점심특가"]
  geohash6      TEXT,                           -- 동 단위 캐싱 키 (예: wydm6h)
  lat           DOUBLE PRECISION,               -- 위도 (스크립트 직접 삽입)
  lng           DOUBLE PRECISION,               -- 경도 (스크립트 직접 삽입)
  location      GEOGRAPHY(POINT, 4326),          -- PostGIS 좌표 (트리거 자동 생성)
  source        TEXT DEFAULT 'manual',          -- 'manual' | 'good_price_csv' | 'good_price_api'
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  -- upsert 충돌 키: 이름+주소가 같으면 업데이트
  UNIQUE (name, address)
);

-- 공간 인덱스 (반경 검색 성능 핵심)
CREATE INDEX IF NOT EXISTS restaurants_location_idx
  ON restaurants USING GIST(location);

-- lat/lng 인덱스 (bounds 기반 필터링)
CREATE INDEX IF NOT EXISTS restaurants_lat_lng_idx
  ON restaurants(lat, lng);

-- geohash 인덱스 (캐시 조회 성능)
CREATE INDEX IF NOT EXISTS restaurants_geohash_idx
  ON restaurants(geohash6);

-- ── 유저 행동 로그 (클릭/노출 분석용) ─────────────────────
CREATE TABLE IF NOT EXISTS user_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL,                 -- 'impression' | 'click' | 'detail_view'
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  ad_slot       SMALLINT,                      -- 1~3 (상단 고정 슬롯 번호)
  geohash6      TEXT,                          -- 유저 위치 geohash
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 파티션 대신 인덱스로 분석 성능 확보 (무료 티어 대응)
CREATE INDEX IF NOT EXISTS user_events_type_idx   ON user_events(event_type);
CREATE INDEX IF NOT EXISTS user_events_date_idx   ON user_events(created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_rest_idx   ON user_events(restaurant_id);

-- ── Row Level Security (RLS) ──────────────────────────────
ALTER TABLE restaurants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events  ENABLE ROW LEVEL SECURITY;

-- 누구나 식당 조회 가능
CREATE POLICY "restaurants_public_read"
  ON restaurants FOR SELECT USING (is_active = true);

-- 이벤트 로그는 삽입만 허용 (anon key로도 가능)
CREATE POLICY "events_insert_only"
  ON user_events FOR INSERT WITH CHECK (true);

-- ── 자동 updated_at 트리거 ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_restaurants_updated_at
  BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── lat/lng → location 자동 동기화 트리거 ─────────────────
CREATE OR REPLACE FUNCTION sync_restaurant_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::GEOGRAPHY;
  ELSE
    NEW.location = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_restaurant_location
  BEFORE INSERT OR UPDATE OF lat, lng
  ON restaurants
  FOR EACH ROW EXECUTE FUNCTION sync_restaurant_location();

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

-- ============================================================
-- 003_postgis_functions.sql  |  반경 검색 + geohash 캐시 함수
-- ============================================================

-- ── 1. 주변 광고 식당 검색 함수 ───────────────────────────
-- 입력: 위도, 경도, 반경(m), 슬롯 수
-- 출력: 거리 포함 광고 식당 목록 (plan_type별 우선순위 정렬)
CREATE OR REPLACE FUNCTION nearby_ad_restaurants(
  user_lat    DOUBLE PRECISION,
  user_lng    DOUBLE PRECISION,
  radius_m    INTEGER DEFAULT 1000,
  slot_limit  INTEGER DEFAULT 3
)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  category       TEXT,
  address        TEXT,
  avg_price      INTEGER,
  image_url      TEXT,
  menu_summary   JSONB,
  tags           TEXT[],
  plan_type      TEXT,
  discount_label TEXT,
  sale_price     INTEGER,
  timesale_start SMALLINT,
  timesale_end   SMALLINT,
  timesale_days  TEXT[],
  distance_m     DOUBLE PRECISION,
  is_timesale_now BOOLEAN
) LANGUAGE sql STABLE AS $$
  SELECT
    a.id,
    a.name,
    a.category,
    a.address,
    a.avg_price,
    a.image_url,
    a.menu_summary,
    a.tags,
    a.plan_type,
    a.discount_label,
    a.sale_price,
    a.timesale_start,
    a.timesale_end,
    a.timesale_days,
    ST_Distance(
      a.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY
    ) AS distance_m,
    -- 현재 시간이 타임세일 시간대인지 판단
    (
      a.timesale_start IS NOT NULL
      AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Seoul') >= a.timesale_start
      AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Seoul') <  a.timesale_end
      AND TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'dy') = ANY(a.timesale_days)
    ) AS is_timesale_now
  FROM active_ad_restaurants a
  WHERE
    ST_DWithin(
      a.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY,
      radius_m
    )
  ORDER BY
    -- 타임세일 진행 중인 식당 최우선
    is_timesale_now DESC,
    -- 그 다음 plan_type 우선순위 (pinned > timesale > playlist)
    CASE a.plan_type
      WHEN 'pinned'    THEN 1
      WHEN 'timesale'  THEN 2
      WHEN 'playlist'  THEN 3
      ELSE 4
    END ASC,
    -- 마지막은 거리순
    distance_m ASC
  LIMIT slot_limit;
$$;

-- ── 2. geohash 기반 일반 식당 검색 (캐시용) ──────────────
-- Workers KV 캐시 미스 시 DB에서 직접 조회하는 폴백 함수
CREATE OR REPLACE FUNCTION restaurants_by_geohash(
  gh6       TEXT,       -- 6자리 geohash (동 단위)
  max_price INTEGER DEFAULT 15000
)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  category     TEXT,
  avg_price    INTEGER,
  image_url    TEXT,
  tags         TEXT[],
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
  SELECT
    id,
    name,
    category,
    avg_price,
    image_url,
    tags,
    ST_Y(location::GEOMETRY) AS lat,
    ST_X(location::GEOMETRY) AS lng
  FROM restaurants
  WHERE
    geohash6 = gh6
    AND (max_price IS NULL OR avg_price <= max_price)
    AND is_active = true
  ORDER BY avg_price ASC
  LIMIT 50;
$$;

-- ── 3. 핫플레이스 리포트 뷰 (데이터 수익화용) ─────────────
CREATE OR REPLACE VIEW hotplace_report AS
SELECT
  e.geohash6,
  e.event_type,
  r.category,
  DATE_TRUNC('day', e.created_at) AS event_date,
  COUNT(*) AS event_count
FROM user_events e
JOIN restaurants r ON r.id = e.restaurant_id
WHERE e.created_at >= NOW() - INTERVAL '30 days'
GROUP BY e.geohash6, e.event_type, r.category, DATE_TRUNC('day', e.created_at)
ORDER BY event_count DESC;

