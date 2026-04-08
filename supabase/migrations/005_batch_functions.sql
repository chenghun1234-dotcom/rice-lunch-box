-- ============================================================
-- 005_batch_functions.sql
-- batch-analytics.js 에서 호출하는 집계 RPC 함수
-- ============================================================

-- ── 1. 일별 통계 집계 함수 ────────────────────────────────
CREATE OR REPLACE FUNCTION aggregate_daily_stats(p_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO daily_stats (
    stat_date, restaurant_id, geohash6, category,
    impressions, clicks, ctr,
    ad_slot_1, ad_slot_2, ad_slot_3
  )
  SELECT
    p_date,
    e.restaurant_id,
    e.geohash6,
    r.category,
    COUNT(*) FILTER (WHERE e.event_type = 'impression')       AS impressions,
    COUNT(*) FILTER (WHERE e.event_type = 'click')            AS clicks,
    ROUND(
      COUNT(*) FILTER (WHERE e.event_type = 'click')::NUMERIC
      / NULLIF(COUNT(*) FILTER (WHERE e.event_type = 'impression'), 0),
      4
    )                                                          AS ctr,
    COUNT(*) FILTER (WHERE e.event_type = 'impression' AND e.ad_slot = 1) AS ad_slot_1,
    COUNT(*) FILTER (WHERE e.event_type = 'impression' AND e.ad_slot = 2) AS ad_slot_2,
    COUNT(*) FILTER (WHERE e.event_type = 'impression' AND e.ad_slot = 3) AS ad_slot_3
  FROM user_events e
  JOIN restaurants r ON r.id = e.restaurant_id
  WHERE DATE(e.created_at AT TIME ZONE 'Asia/Seoul') = p_date
    AND e.restaurant_id IS NOT NULL
  GROUP BY e.restaurant_id, e.geohash6, r.category
  ON CONFLICT (stat_date, restaurant_id) DO UPDATE SET
    impressions = EXCLUDED.impressions,
    clicks      = EXCLUDED.clicks,
    ctr         = EXCLUDED.ctr,
    ad_slot_1   = EXCLUDED.ad_slot_1,
    ad_slot_2   = EXCLUDED.ad_slot_2,
    ad_slot_3   = EXCLUDED.ad_slot_3;
END;
$$;

-- ── 2. 월별 지역 메뉴 반응도 집계 ────────────────────────
CREATE OR REPLACE FUNCTION aggregate_geo_menu_stats(p_month DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO geo_menu_stats (
    stat_month, geohash6, category, total_clicks, top_item_name
  )
  SELECT
    p_month,
    ds.geohash6,
    ds.category,
    SUM(ds.clicks) AS total_clicks,
    ds.category    AS top_item_name  -- 추후 메뉴별 집계로 고도화
  FROM daily_stats ds
  WHERE DATE_TRUNC('month', ds.stat_date) = p_month
    AND ds.geohash6 IS NOT NULL
    AND ds.category IS NOT NULL
  GROUP BY ds.geohash6, ds.category
  ON CONFLICT (stat_month, geohash6, category) DO UPDATE SET
    total_clicks   = EXCLUDED.total_clicks,
    top_item_name  = EXCLUDED.top_item_name;
END;
$$;

-- ── 3. 업주용 무료 인사이트 함수 (영업 미끼) ─────────────
-- 특정 geohash6 에서 지난 30일간 검색 건수 반환
-- 로그인 없이도 호출 가능 (인사이트 미리보기)
CREATE OR REPLACE FUNCTION get_free_insight(p_geohash6 TEXT)
RETURNS TABLE (
  total_search      BIGINT,
  top_category      TEXT,
  avg_ctr           NUMERIC,
  rank_among_nearby INTEGER
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH geo_totals AS (
    SELECT
      geohash6,
      SUM(impressions) AS total_search,
      ROUND(AVG(ctr), 4) AS avg_ctr
    FROM daily_stats
    WHERE stat_date >= CURRENT_DATE - 30
    GROUP BY geohash6
  ),
  top_cat AS (
    SELECT
      geohash6,
      category,
      SUM(clicks) AS cat_clicks,
      RANK() OVER (PARTITION BY geohash6 ORDER BY SUM(clicks) DESC) AS rk
    FROM daily_stats
    WHERE stat_date >= CURRENT_DATE - 30
    GROUP BY geohash6, category
  ),
  nearby_rank AS (
    SELECT
      geohash6,
      RANK() OVER (ORDER BY SUM(impressions) DESC) AS rank_pos
    FROM daily_stats
    WHERE stat_date >= CURRENT_DATE - 30
    GROUP BY geohash6
  )
  SELECT
    gt.total_search,
    tc.category   AS top_category,
    gt.avg_ctr,
    nr.rank_pos::INTEGER AS rank_among_nearby
  FROM geo_totals   gt
  LEFT JOIN top_cat tc ON tc.geohash6 = gt.geohash6 AND tc.rk = 1
  LEFT JOIN nearby_rank nr ON nr.geohash6 = gt.geohash6
  WHERE gt.geohash6 = p_geohash6
  LIMIT 1;
$$;
