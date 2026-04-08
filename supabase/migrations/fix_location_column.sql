-- ============================================================
-- fix_location_column.sql
-- GENERATED ALWAYS AS 방식 → 트리거 방식으로 교체
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. 의존 뷰 먼저 삭제
DROP VIEW IF EXISTS active_ad_restaurants;
DROP VIEW IF EXISTS hotplace_report;

-- 2. generated 컬럼 제거 + 일반 컬럼으로 재추가
ALTER TABLE restaurants DROP COLUMN IF EXISTS location;
ALTER TABLE restaurants ADD COLUMN location GEOGRAPHY(POINT, 4326);

-- 2. lat/lng 변경 시 location 자동 동기화 트리거 함수
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

-- 3. INSERT / UPDATE 모두 적용
DROP TRIGGER IF EXISTS set_restaurant_location ON restaurants;
CREATE TRIGGER set_restaurant_location
  BEFORE INSERT OR UPDATE OF lat, lng
  ON restaurants
  FOR EACH ROW EXECUTE FUNCTION sync_restaurant_location();

-- 4. 공간 인덱스 재생성
DROP INDEX IF EXISTS restaurants_location_idx;
CREATE INDEX restaurants_location_idx ON restaurants USING GIST(location);

-- 5. 뷰 재생성
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
