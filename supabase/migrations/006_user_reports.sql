-- ============================================================
-- 006_user_reports.sql  |  유저 제보 + SEO 페이지 캐시
-- ============================================================

-- ── 1. 유저 제보 테이블 ───────────────────────────────────
-- 공공데이터에 없는 숨은 맛집 정보를 유저가 직접 제보
CREATE TABLE IF NOT EXISTS user_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  -- restaurant_id가 NULL이면 신규 식당 제보
  report_type     TEXT NOT NULL DEFAULT 'new_menu',
  -- 'new_menu'    : 메뉴/가격 정보 제보
  -- 'photo'       : 음식 사진 제보
  -- 'new_place'   : 새 식당 제보 (공공데이터 미수록)
  -- 'wrong_info'  : 잘못된 정보 신고

  -- 제보 내용
  restaurant_name TEXT,                        -- 신규 식당일 때
  address         TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  menu_items      JSONB DEFAULT '[]',          -- [{"name":"된장찌개","price":7000}]
  photo_url       TEXT,                        -- Cloudflare R2 업로드 후 URL 저장
  description     TEXT,                        -- 자유 설명

  -- 검수 상태
  status          TEXT DEFAULT 'pending',      -- pending | approved | rejected
  reviewed_at     TIMESTAMPTZ,
  reviewer_note   TEXT,

  -- 제보자 정보 (선택)
  reporter_ip     TEXT,                        -- 어뷰징 방지용 (익명)
  user_agent      TEXT,

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_reports_rest_idx    ON user_reports(restaurant_id);
CREATE INDEX IF NOT EXISTS user_reports_status_idx  ON user_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_type_idx    ON user_reports(report_type);

ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

-- 누구나 제보 가능 (익명)
CREATE POLICY "reports_insert_open"
  ON user_reports FOR INSERT WITH CHECK (true);

-- 조회는 approved 만 공개
CREATE POLICY "reports_select_approved"
  ON user_reports FOR SELECT USING (status = 'approved');

-- ── 2. 검수 완료 시 restaurants 테이블 자동 반영 트리거 ──
CREATE OR REPLACE FUNCTION apply_approved_report()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 신규 식당 제보가 승인되면 restaurants에 자동 insert
  IF NEW.status = 'approved' AND OLD.status = 'pending'
     AND NEW.report_type = 'new_place'
     AND NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL
  THEN
    INSERT INTO restaurants (
      name, address, location, geohash6, source, tags, is_active
    )
    VALUES (
      NEW.restaurant_name,
      NEW.address,
      ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::GEOGRAPHY,
      -- geohash6 는 DB 트리거에서 계산하기 복잡하므로 NULL 허용 후 배치가 채움
      NULL,
      'user_report',
      ARRAY['유저제보'],
      true
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 메뉴 정보 제보가 승인되면 restaurant.menu_summary 업데이트
  IF NEW.status = 'approved' AND OLD.status = 'pending'
     AND NEW.report_type = 'new_menu'
     AND NEW.restaurant_id IS NOT NULL
     AND jsonb_array_length(NEW.menu_items) > 0
  THEN
    UPDATE restaurants
    SET menu_summary = NEW.menu_items,
        updated_at   = now()
    WHERE id = NEW.restaurant_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_report_approved
  AFTER UPDATE OF status ON user_reports
  FOR EACH ROW EXECUTE FUNCTION apply_approved_report();

-- ── 3. SEO 페이지 캐시 테이블 ────────────────────────────
-- 지역별 랜딩 페이지 데이터를 미리 집계해 저장 (실시간 쿼리 없이 서빙)
CREATE TABLE IF NOT EXISTS seo_pages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,      -- URL 슬러그 (예: gangnam-lunch-8000)
  region_name  TEXT NOT NULL,             -- "강남역" | "성수동"
  district     TEXT NOT NULL,             -- "강남구"
  theme        TEXT NOT NULL,             -- "점심" | "혼밥" | "가성비"
  max_price    INTEGER,                   -- 8000 | 10000 | 15000
  title        TEXT NOT NULL,             -- SEO 타이틀
  description  TEXT NOT NULL,             -- SEO 설명 (160자 이내)
  restaurants  JSONB DEFAULT '[]',        -- 집계된 식당 목록 (스냅샷)
  view_count   INTEGER DEFAULT 0,
  last_built   TIMESTAMPTZ,               -- 마지막 빌드 시각
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_pages_slug_idx     ON seo_pages(slug);
CREATE INDEX IF NOT EXISTS seo_pages_region_idx   ON seo_pages(region_name, theme);
CREATE INDEX IF NOT EXISTS seo_pages_district_idx ON seo_pages(district);

ALTER TABLE seo_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seo_pages_public_read"
  ON seo_pages FOR SELECT USING (true);

-- ── 4. SEO 페이지 조회수 증가 함수 ────────────────────────
CREATE OR REPLACE FUNCTION increment_seo_view(p_slug TEXT)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE seo_pages SET view_count = view_count + 1 WHERE slug = p_slug;
$$;
