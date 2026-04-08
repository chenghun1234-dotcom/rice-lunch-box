/**
 * build-seo-pages.js — scripts/build-seo-pages.js
 *
 * Supabase RPC `build_seo_pages()` 를 호출하여
 * seo_pages 테이블을 최신 restaurant 데이터로 갱신합니다.
 *
 * GitHub Actions: build-seo-pages job 에서 매일 새벽 실행
 * 수동: npm run build-seo
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log("🗺️  SEO 페이지 빌드 시작...");
  const start = Date.now();

  // build_seo_pages() — 007_seo_builder.sql 에 정의된 RPC
  const { data, error } = await supabase.rpc("build_seo_pages");
  if (error) {
    console.error("❌ build_seo_pages 실패:", error.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ SEO 페이지 빌드 완료 (${elapsed}s)`);

  // 생성된 페이지 수 확인
  const { count } = await supabase
    .from("seo_pages")
    .select("*", { count: "exact", head: true });
  console.log(`📄 총 seo_pages: ${count ?? "?"}개`);

  // 최근 생성/업데이트된 페이지 샘플 출력
  const { data: samples } = await supabase
    .from("seo_pages")
    .select("slug, title, view_count, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (samples?.length) {
    console.log("\n최근 업데이트된 페이지:");
    samples.forEach((p) =>
      console.log(`  ${p.slug}  (${p.title}) — 조회 ${p.view_count ?? 0}회`)
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
