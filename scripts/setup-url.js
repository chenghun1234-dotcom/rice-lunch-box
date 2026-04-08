/**
 * setup-url.js — Supabase URL 자동 설정 도우미
 *
 * 사용법:
 *   node setup-url.js https://xxxxxxxxxxxxxxxxxxxx.supabase.co
 *
 * .env 파일의 SUPABASE_URL 줄을 자동으로 업데이트합니다.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.join(__dirname, ".env");

const url = process.argv[2]?.trim();

if (!url) {
  console.log("사용법: node setup-url.js https://xxxxxxxxxxxxxxxxxxxx.supabase.co");
  console.log("");
  console.log("Supabase URL 찾는 방법:");
  console.log("  1. https://supabase.com/dashboard 접속 (로그인)");
  console.log("  2. 프로젝트 카드 클릭");
  console.log("  3. 왼쪽 메뉴 → Settings → Data API");
  console.log("  4. 'Project URL' 항목 복사");
  console.log("     형식: https://xxxxxxxxxxxxxxxxxxxx.supabase.co");
  process.exit(0);
}

if (!url.match(/^https:\/\/.+\.supabase\.co\/?$/)) {
  console.error("❌ 올바른 Supabase URL 형식이 아닙니다.");
  console.error("   형식: https://xxxxxxxxxxxxxxxxxxxx.supabase.co");
  process.exit(1);
}

// URL 연결 테스트
console.log("🔍 URL 연결 확인 중...");
try {
  const resp = await fetch(url + "/rest/v1/", { signal: AbortSignal.timeout(5000) });
  if (resp.status === 200 || resp.status === 401) {
    console.log("✅ Supabase 서버 응답 확인 (HTTP " + resp.status + ")");
  } else {
    console.warn("⚠️  예상치 못한 응답: HTTP " + resp.status);
  }
} catch (e) {
  console.error("❌ 연결 실패:", e.message);
  console.error("   URL이 올바른지 다시 확인하세요.");
  process.exit(1);
}

// .env 업데이트
if (!fs.existsSync(ENV_PATH)) {
  console.error("❌ .env 파일이 없습니다. .env.example을 먼저 복사하세요.");
  process.exit(1);
}

let content = fs.readFileSync(ENV_PATH, "utf8");
const normalized = url.replace(/\/$/, ""); // 끝 / 제거

if (content.includes("SUPABASE_URL=")) {
  content = content.replace(/SUPABASE_URL=.*/, `SUPABASE_URL=${normalized}`);
} else {
  content += `\nSUPABASE_URL=${normalized}\n`;
}

fs.writeFileSync(ENV_PATH, content, "utf8");
console.log("✅ .env 업데이트 완료:");
console.log("   SUPABASE_URL=" + normalized);
console.log("");
console.log("이제 실행하세요:");
console.log("   python test_local.py   # 10건 API 테스트");
console.log("   node import-csv.js     # CSV 전체 임포트");
