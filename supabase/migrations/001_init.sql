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
