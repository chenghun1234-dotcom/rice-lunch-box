-- ============================================================
-- 007_seo_builder.sql  |  SEO 페이지 자동 빌드 함수
-- GitHub Actions에서 매일 새벽 호출
-- ============================================================

-- ── 지역 × 테마 조합으로 SEO 페이지 자동 생성 ───────────
CREATE OR REPLACE FUNCTION build_seo_pages()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_region   RECORD;
  v_theme    RECORD;
  v_slug     TEXT;
  v_title    TEXT;
  v_desc     TEXT;
  v_rests    JSONB;
  v_count    INTEGER := 0;
BEGIN
  -- 지역 × 테마 조합 순회 (지역 테이블은 seo_regions 뷰에서 동적 생성)
  FOR v_region IN
    SELECT DISTINCT
      -- geohash6 기준으로 실제 데이터가 있는 지역만 추출
      geohash6,
      -- 주소에서 구/동 이름 추출 (첫 3개 단어)
      SPLIT_PART(address, ' ', 2) AS district,
      SPLIT_PART(address, ' ', 3) AS dong
    FROM restaurants
    WHERE is_active = true
      AND geohash6 IS NOT NULL
      AND address IS NOT NULL
    GROUP BY geohash6, district, dong
    HAVING COUNT(*) >= 3   -- 식당 3개 이상 있는 지역만
  LOOP
    -- 테마별 페이지 생성
    FOR v_theme IN
      SELECT * FROM (VALUES
        ('점심특가', '8000원 이하',  8000,  '점심'),
        ('가성비',   '1만원 이하',   10000, 'gaseongbi'),
        ('혼밥',     '혼밥 가성비',  12000, 'honbap')
      ) AS t(theme_name, price_label, max_price, slug_suffix)
    LOOP
      -- 해당 지역 식당 집계
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',        id,
          'name',      name,
          'category',  category,
          'avg_price', avg_price,
          'image_url', image_url,
          'tags',      tags,
          'address',   address
        ) ORDER BY avg_price ASC NULLS LAST
      )
      INTO v_rests
      FROM (
        SELECT id, name, category, avg_price, image_url, tags, address
        FROM restaurants
        WHERE geohash6 = v_region.geohash6
          AND is_active = true
          AND (v_theme.max_price IS NULL OR avg_price <= v_theme.max_price)
        LIMIT 10
      ) sub;

      -- 식당이 5개 미만이면 페이지 생성 건너뜀
      IF v_rests IS NULL OR jsonb_array_length(v_rests) < 3 THEN
        CONTINUE;
      END IF;

      v_slug  := LOWER(REGEXP_REPLACE(
        v_region.dong || '-' || v_theme.slug_suffix,
        '[^a-z0-9가-힣]', '-', 'g'
      ));
      v_title := v_region.dong || ' ' || v_theme.theme_name
                 || ' 가성비 맛집 TOP ' || jsonb_array_length(v_rests)::TEXT;
      v_desc  := v_region.district || ' ' || v_region.dong || '에서 '
                 || v_theme.price_label || ' 먹을 수 있는 진짜 가성비 식당 '
                 || jsonb_array_length(v_rests)::TEXT || '곳. '
                 || '도시락탈출이 공공데이터와 유저 제보로 검증했습니다.';

      INSERT INTO seo_pages (slug, region_name, district, theme, max_price, title, description, restaurants, last_built)
      VALUES (
        v_slug, v_region.dong, v_region.district,
        v_theme.theme_name, v_theme.max_price,
        v_title, v_desc, v_rests, now()
      )
      ON CONFLICT (slug) DO UPDATE SET
        restaurants = EXCLUDED.restaurants,
        title       = EXCLUDED.title,
        description = EXCLUDED.description,
        last_built  = now();

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── SEO 페이지 검색 함수 (광역 검색) ────────────────────
CREATE OR REPLACE FUNCTION search_seo_pages(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  slug         TEXT,
  title        TEXT,
  description  TEXT,
  region_name  TEXT,
  district     TEXT,
  theme        TEXT,
  rest_count   INTEGER
) LANGUAGE sql STABLE AS $$
  SELECT
    slug, title, description,
    region_name, district, theme,
    jsonb_array_length(restaurants) AS rest_count
  FROM seo_pages
  WHERE
    title ILIKE '%' || p_query || '%'
    OR region_name ILIKE '%' || p_query || '%'
    OR district ILIKE '%' || p_query || '%'
  ORDER BY view_count DESC
  LIMIT p_limit;
$$;
