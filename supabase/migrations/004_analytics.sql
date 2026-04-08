-- ============================================================
-- 004_analytics.sql  |  배치 통계, 업주 프로필, 구독 상태
-- ============================================================

-- ── 1. 업주 프로필 (Supabase Auth 연동) ──────────────────
-- auth.users 와 1:1 매핑 (Supabase Auth가 이메일/패스워드 관리)
CREATE TABLE IF NOT EXISTS advertiser_profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name  TEXT,
  contact_phone  TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 업주 → 식당 N:M (한 업주가 여러 식당 등록 가능)
CREATE TABLE IF NOT EXISTS advertiser_restaurants (
  advertiser_id  UUID REFERENCES advertiser_profiles(id) ON DELETE CASCADE,
  restaurant_id  UUID REFERENCES restaurants(id)         ON DELETE CASCADE,
  PRIMARY KEY (advertiser_id, restaurant_id)
);

ALTER TABLE advertiser_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertiser_restaurants ENABLE ROW LEVEL SECURITY;

-- 본인 프로필만 조회/수정
CREATE POLICY "own_profile"
  ON advertiser_profiles
  FOR ALL USING (auth.uid() = id);

-- 본인 식당만 조회
CREATE POLICY "own_restaurants"
  ON advertiser_restaurants
  FOR ALL USING (auth.uid() = advertiser_id);

-- ── 2. 구독 결제 기록 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id   UUID REFERENCES advertiser_profiles(id) ON DELETE CASCADE,
  restaurant_id   UUID REFERENCES restaurants(id),
  plan_type       TEXT NOT NULL,         -- 'pinned' | 'timesale' | 'playlist'
  amount_krw      INTEGER NOT NULL,      -- 결제 금액 (원)
  toss_order_id   TEXT UNIQUE,           -- 토스페이먼츠 주문번호
  toss_payment_key TEXT,                 -- 토스페이먼츠 paymentKey
  status          TEXT DEFAULT 'pending',-- pending | done | canceled | failed
  paid_at         TIMESTAMPTZ,
  period_start    DATE,
  period_end      DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_advertiser_idx ON subscription_payments(advertiser_id);
CREATE INDEX IF NOT EXISTS payments_status_idx     ON subscription_payments(status, paid_at);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- 본인 결제 내역만 조회
CREATE POLICY "own_payments"
  ON subscription_payments
  FOR SELECT USING (auth.uid() = advertiser_id);

-- ── 3. 일별 통계 집계 테이블 (배치 결과 저장) ────────────
-- user_events 를 하루 1회 새벽에 집계 → 이 테이블에 저장
CREATE TABLE IF NOT EXISTS daily_stats (
  id             BIGSERIAL PRIMARY KEY,
  stat_date      DATE NOT NULL,
  restaurant_id  UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  geohash6       TEXT,
  category       TEXT,
  impressions    INTEGER DEFAULT 0,   -- 노출 수
  clicks         INTEGER DEFAULT 0,   -- 클릭 수
  ctr            NUMERIC(5,4),        -- 클릭률 = clicks / impressions
  ad_slot_1      INTEGER DEFAULT 0,   -- 슬롯 1 노출 수
  ad_slot_2      INTEGER DEFAULT 0,
  ad_slot_3      INTEGER DEFAULT 0,
  UNIQUE(stat_date, restaurant_id)
);

CREATE INDEX IF NOT EXISTS daily_stats_date_idx    ON daily_stats(stat_date DESC);
CREATE INDEX IF NOT EXISTS daily_stats_rest_idx    ON daily_stats(restaurant_id, stat_date DESC);
CREATE INDEX IF NOT EXISTS daily_stats_geo_idx     ON daily_stats(geohash6, stat_date DESC);

-- ── 4. 지역별 메뉴 반응도 (핫플레이스 리포트 재료) ─────────
CREATE TABLE IF NOT EXISTS geo_menu_stats (
  id             BIGSERIAL PRIMARY KEY,
  stat_month     DATE NOT NULL,           -- 월 단위 (매월 1일로 정규화)
  geohash6       TEXT NOT NULL,
  category       TEXT NOT NULL,           -- 음식 카테고리
  total_clicks   INTEGER DEFAULT 0,
  top_item_name  TEXT,                    -- 클릭 1위 메뉴/카테고리
  UNIQUE(stat_month, geohash6, category)
);

CREATE INDEX IF NOT EXISTS geo_menu_stats_month_geo ON geo_menu_stats(stat_month DESC, geohash6);

-- ── 5. 업주용 뷰: 내 식당 최근 7일 성과 ───────────────────
CREATE OR REPLACE VIEW my_restaurant_stats AS
SELECT
  ds.stat_date,
  ds.restaurant_id,
  r.name       AS restaurant_name,
  ar.advertiser_id,
  ds.impressions,
  ds.clicks,
  ds.ctr,
  ds.ad_slot_1,
  ds.ad_slot_2,
  ds.ad_slot_3
FROM daily_stats ds
JOIN restaurants r             ON r.id = ds.restaurant_id
JOIN advertiser_restaurants ar ON ar.restaurant_id = ds.restaurant_id
WHERE ds.stat_date >= CURRENT_DATE - INTERVAL '7 days';

-- ── 6. 무료 인사이트 뷰 (영업 미끼 데이터) ────────────────
-- 업주가 로그인 전에도 "내 동네 검색량"을 미리보기로 볼 수 있게
CREATE OR REPLACE VIEW public_geo_insight AS
SELECT
  geohash6,
  stat_date,
  SUM(impressions) AS total_search,    -- 해당 geohash 전체 검색량
  COUNT(DISTINCT restaurant_id) AS restaurant_count,
  ROUND(AVG(ctr)::NUMERIC, 4) AS avg_ctr
FROM daily_stats
WHERE stat_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY geohash6, stat_date;
