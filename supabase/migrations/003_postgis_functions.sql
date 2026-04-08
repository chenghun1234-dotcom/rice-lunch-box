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
