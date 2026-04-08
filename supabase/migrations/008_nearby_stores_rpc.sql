-- ============================================================
-- 008_nearby_stores_rpc.sql
-- 일반 식당 반경 검색 RPC (CF Worker 없이 프론트엔드 직접 호출용)
-- 테이블: restaurants (good_price_csv 데이터 포함)
-- ============================================================

-- ── 1. 반경 내 일반 식당 검색 (거리순) ───────────────────
-- PostGIS ST_DWithin 기반 (공간 인덱스 활용 → 빠름)
CREATE OR REPLACE FUNCTION get_nearby_stores(
  user_lat  DOUBLE PRECISION,
  user_lng  DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 2.0,
  max_count INTEGER          DEFAULT 50
)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  category     TEXT,
  address      TEXT,
  phone        TEXT,
  avg_price    INTEGER,
  price_range  TEXT,
  main_menu    TEXT,
  image_url    TEXT,
  tags         TEXT[],
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  distance_m   DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
  SELECT
    r.id,
    r.name,
    r.category,
    r.address,
    r.phone,
    r.avg_price,
    r.price_range,
    r.main_menu,
    r.image_url,
    r.tags,
    r.lat,
    r.lng,
    ST_Distance(
      r.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY
    ) AS distance_m
  FROM restaurants r
  WHERE
    r.is_active = true
    AND r.location IS NOT NULL
    AND ST_DWithin(
      r.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY,
      radius_km * 1000   -- km → m 변환
    )
  ORDER BY distance_m ASC
  LIMIT max_count;
$$;

-- ── 2. 지도 bounds 내 식당 검색 (뷰포트 필터링) ──────────
-- 지도를 드래그할 때 화면에 보이는 식당만 가져오는 함수
CREATE OR REPLACE FUNCTION get_stores_in_bounds(
  sw_lat    DOUBLE PRECISION,
  sw_lng    DOUBLE PRECISION,
  ne_lat    DOUBLE PRECISION,
  ne_lng    DOUBLE PRECISION,
  max_count INTEGER DEFAULT 200
)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  category    TEXT,
  address     TEXT,
  avg_price   INTEGER,
  price_range TEXT,
  main_menu   TEXT,
  image_url   TEXT,
  tags        TEXT[],
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION
) LANGUAGE sql STABLE AS $$
  SELECT
    r.id, r.name, r.category, r.address,
    r.avg_price, r.price_range, r.main_menu,
    r.image_url, r.tags, r.lat, r.lng
  FROM restaurants r
  WHERE
    r.is_active = true
    AND r.lat BETWEEN sw_lat AND ne_lat
    AND r.lng BETWEEN sw_lng AND ne_lng
  ORDER BY r.avg_price ASC NULLS LAST
  LIMIT max_count;
$$;

-- ── RPC 접근 권한 부여 ────────────────────────────────────
GRANT EXECUTE ON FUNCTION get_nearby_stores  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_stores_in_bounds TO anon, authenticated;
