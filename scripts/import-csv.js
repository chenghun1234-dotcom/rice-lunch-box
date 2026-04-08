/**
 * import-csv.js — scripts/import-csv.js
 *
 * 행정안전부_착한가격업소 CSV → Supabase restaurants 테이블 임포트
 *
 * 사용법:
 *   node import-csv.js                              # 기본 경로 사용
 *   node import-csv.js ../data/raw/파일명.csv       # 경로 직접 지정
 *
 * 환경변수 (.env 또는 터미널에서 export):
 *   SUPABASE_URL          Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)
 *   KAKAO_REST_KEY        카카오 REST API 키 (주소→좌표 변환용)
 *
 * 동작 흐름:
 *   1) CSV 파일 읽기 (EUC-KR / UTF-8 자동 감지)
 *   2) 각 행 파싱 → 주소로 Kakao 지오코딩
 *   3) Supabase restaurants 테이블에 배치 upsert
 *
 * ※ 착한가격업소 CSV의 일반적인 컬럼 형식:
 *   시도명, 시군구명, 업소명, 소재지도로명주소, 소재지지번주소,
 *   업종구분명, 대표메뉴, 가격(원), 선정일자, 전화번호, ...
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

// ── 경로 설정 ─────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 환경변수 로드 (.env 파일 지원)
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k && v.length && !process.env[k.trim()]) {
        process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
} catch {}

const CSV_PATH =
  process.argv[2] ??
  path.join(__dirname, "../data/raw/행정안전부_착한가격업소 현황_20250930.csv");

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const KAKAO_KEY     = process.env.KAKAO_REST_KEY;

// ── Supabase 클라이언트 ───────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── CSV 파싱 (EUC-KR 자동 감지) ───────────────────────────────────────────────
/**
 * EUC-KR 인코딩 여부를 바이트 패턴으로 간단 판별
 * (Buffer 앞 2KB 샘플링)
 */
function detectEncoding(buf) {
  for (let i = 0; i < Math.min(buf.length - 1, 2048); i++) {
    const b = buf[i];
    // EUC-KR 한글은 0xB0–0xC8 첫 바이트 + 0xA1–0xFE 두 번째 바이트
    if (b >= 0xb0 && b <= 0xc8) {
      const b2 = buf[i + 1];
      if (b2 >= 0xa1 && b2 <= 0xfe) return "euc-kr";
    }
  }
  return "utf8";
}

function decodeBuffer(buf) {
  const enc = detectEncoding(buf);
  if (enc === "euc-kr") {
    // Node.js 기본 디코더는 euc-kr를 지원하지 않음
    // → iconv-lite 없이 TextDecoder(WHATWG) 사용 (Node 18+ 내장)
    try {
      return new TextDecoder("euc-kr").decode(buf);
    } catch {
      console.warn("⚠️  EUC-KR 디코딩 실패. iconv-lite 없이 UTF-8로 시도합니다.");
      return buf.toString("utf8");
    }
  }
  // UTF-8 BOM 제거
  const str = buf.toString("utf8");
  return str.startsWith("\uFEFF") ? str.slice(1) : str;
}

/**
 * CSV 한 줄을 셀 배열로 파싱
 * 큰따옴표 quoted field, 쉼표 내 줄바꿈 미지원 (단순 버전)
 */
function parseLine(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * CSV 전체 파싱 → 객체 배열 반환
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV 행이 너무 적습니다.");

  const headers = parseLine(lines[0]);
  console.log("📋 CSV 컬럼:", headers.join(" | "));

  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

// ── 컬럼 매핑 (행안부_착한가격업소 현황 실제 컬럼 기준) ────────────────────
// 실제 컬럼: 시도, 시군, 업종, 업소명, 연락처, 주소, 메뉴1, 가격1, 메뉴2, 가격2, 메뉴3, 가격3, 메뉴4, 가격4

// 요식업 관련 업종만 필터 (미용업, 세탁업 등 제외)
const FOOD_CATEGORIES = [
  "한식", "양식", "중식", "일식", "분식", "기타요식업",
  "요식업", "음식", "식당", "카페", "제과", "패스트푸드",
  "뷔페", "도시락", "치킨", "피자", "족발", "국밥",
];
function isFoodCategory(cat) {
  if (!cat) return true; // 업종 미기재는 포함
  return FOOD_CATEGORIES.some((f) => cat.includes(f));
}

function mapRow(row) {
  const name     = row["업소명"]?.trim();
  const address  = row["주소"]?.trim();
  const category = row["업종"]?.trim();
  const sido     = row["시도"]?.trim();
  const sigun    = row["시군"]?.trim();

  if (!name || !address) return null;

  // 요식업만 필터 (미용업·세탁소 등 제외)
  if (!isFoodCategory(category)) return null;

  // 메뉴 1~4 → 대표메뉴 선택 (가격 낮은 것 기준)
  // 착한가격업소 최대 기준: 100,000원 초과 or 500 미만은 데이터 오류로 제거
  const MAX_PRICE = 100_000;
  const MIN_PRICE = 500;
  const menus = [1, 2, 3, 4]
    .map((i) => ({
      name:  row[`메뉴${i}`]?.trim() || null,
      price: parseInt((row[`가격${i}`] ?? "").replace(/[^0-9]/g, ""), 10) || null,
    }))
    .filter((m) => m.name && m.price && m.price >= MIN_PRICE && m.price <= MAX_PRICE);

  // 대표 메뉴: 가격 가장 낮은 것 (= 착한가격 기준)
  const mainMenu = menus.sort((a, b) => a.price - b.price)[0] ?? null;

  // 가격 범위
  const minPrice = mainMenu?.price ?? null;
  let price_range = "₩";
  if (minPrice) {
    if (minPrice <= 5000)       price_range = "₩";
    else if (minPrice <= 10000) price_range = "₩₩";
    else if (minPrice <= 20000) price_range = "₩₩₩";
    else                        price_range = "₩₩₩₩";
  }

  // 카테고리 정규화
  const catMap = {
    "한식_일반": "한식", "한식_분식": "분식", "한식_면류": "한식",
    "한식_구이": "한식", "한식_탕류": "한식",
    "기타요식업": "카페·기타", "제과점": "카페·디저트",
  };
  const normalCat = catMap[category] ?? category ?? "음식점";

  return {
    name,
    address,
    category: normalCat,
    price_range,
    avg_price: minPrice,
    main_menu: mainMenu?.name ?? null,
    // 메뉴 전체를 JSON으로 저장 (schema에 menu_data jsonb 컬럼 있으면 활용)
    source: "good_price_csv",
    is_active: true,
    _geocode_address: address,
    _area: sido && sigun ? `${sido} ${sigun}` : null,
    _all_menus: menus, // 내부용, DB 저장 안 함
  };
}

// ── Kakao 지오코딩 ────────────────────────────────────────────────────────────
const geocodeCache = new Map();
let geocodeCount = 0;
let geocodeFail  = 0;

async function geocode(address) {
  if (geocodeCache.has(address)) return geocodeCache.get(address);
  if (!KAKAO_KEY) return null;

  // 요청 간 50ms 딜레이 (카카오 초당 10회 제한)
  await new Promise((r) => setTimeout(r, 50));

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&size=1`;
    const resp = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });

    // 403: 앱에서 로컬 API 서비스 미활성화
    if (resp.status === 403) {
      let msg = "";
      try { msg = (await resp.json()).message ?? ""; } catch {}
      if (msg.includes("disabled") || msg.includes("NotAuthorized")) {
        console.error("");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ 카카오 로컬 API 권한 오류: " + msg);
        console.error("");
        console.error("  📌 해결 방법:");
        console.error("  1. https://developers.kakao.com 접속");
        console.error("  2. 내 애플리케이션 → [도시락탈출 앱] 선택");
        console.error("  3. 왼쪽 메뉴 → [제품 설정] → [카카오맵]");
        console.error("  4. 상태를 [ON] 으로 활성화");
        console.error("  ※ 또는 [앱 설정] → [플랫폼] 에서 Web 플랫폼 등록 필요");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        process.exit(1);  // 전부 실패하기 전에 즉시 중단
      }
      geocodeFail++;
      return null;
    }

    if (!resp.ok) { geocodeFail++; return null; }
    const data = await resp.json();
    const doc  = data.documents?.[0];
    if (!doc) { geocodeFail++; geocodeCache.set(address, null); return null; }
    const result = { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
    geocodeCache.set(address, result);
    geocodeCount++;
    return result;
  } catch {
    geocodeFail++;
    return null;
  }
}

// ── Supabase upsert ───────────────────────────────────────────────────────────
const BATCH_SIZE = 100;

async function upsertBatch(rows) {
  // 배치 내 name+address 중복 제거 (마지막 항목 유지)
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.name}||${r.address}`;
    seen.set(key, r);
  }
  const deduped = [...seen.values()];

  const { error } = await supabase
    .from("restaurants")
    .upsert(deduped, {
      onConflict: "name,address",
      ignoreDuplicates: false,
    });
  if (error) throw new Error(`Supabase upsert 실패: ${error.message}`);
}

// ── 진행상황 출력 헬퍼 ────────────────────────────────────────────────────────
function progress(current, total, label = "") {
  const pct = Math.round((current / total) * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r[${bar}] ${pct}% (${current}/${total}) ${label}   `);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  // 사전 검증
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`\n❌ CSV 파일을 찾을 수 없습니다: ${CSV_PATH}`);
    console.error(`\n📁 파일을 아래 경로에 놓아주세요:`);
    console.error(`   data/raw/행정안전부_착한가격업소 현황_20250930.csv\n`);
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("❌ SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수가 필요합니다.");
    console.error("   scripts/.env 파일에 추가하거나 터미널에서 export 하세요.");
    process.exit(1);
  }
  if (!KAKAO_KEY) {
    console.warn("⚠️  KAKAO_REST_KEY 없음 → 지오코딩 건너뜀 (lat/lng = null)");
    console.warn("   lat/lng가 null인 행은 지도에 표시되지 않습니다.\n");
  }

  // 1. CSV 읽기
  console.log(`\n📂 CSV 읽는 중: ${path.basename(CSV_PATH)}`);
  const buf  = fs.readFileSync(CSV_PATH);
  const text = decodeBuffer(buf);
  const rawRows = parseCsv(text);
  console.log(`   총 ${rawRows.length.toLocaleString()}행 읽음\n`);

  // 2. 행 변환
  const mapped = rawRows
    .map(mapRow)
    .filter(Boolean);
  console.log(`✅ 변환 가능: ${mapped.length.toLocaleString()}행 (필수 컬럼 부족으로 ${rawRows.length - mapped.length}행 제외)\n`);

  // 3. 지오코딩 + DB 행 준비
  console.log(`🗺️  지오코딩 시작 (Kakao REST)…`);
  const dbRows = [];
  let skipped = 0;

  for (let i = 0; i < mapped.length; i++) {
    const row = mapped[i];
    progress(i + 1, mapped.length, row.name?.substring(0, 12) ?? "");

    let lat = null;
    let lng = null;

    if (KAKAO_KEY) {
      const coord = await geocode(row._geocode_address);
      if (coord) { lat = coord.lat; lng = coord.lng; }
      else { skipped++; continue; } // 좌표 없으면 지도 핀 불가 → 스킵
    }

    // 내부 헬퍼 필드 제거
    const { _geocode_address, _area, _all_menus, ...rest } = row;

    dbRows.push({
      ...rest,
      lat,
      lng,
      // location 은 트리거(sync_restaurant_location)가 자동 계산 → 직접 삽입 안 함
    });
  }

  console.log(`\n\n📊 지오코딩 결과:`);
  console.log(`   성공: ${geocodeCount}건`);
  console.log(`   실패/건너뜀: ${skipped + geocodeFail}건`);
  console.log(`   DB 삽입 대상: ${dbRows.length}건\n`);

  if (dbRows.length === 0) {
    console.warn("⚠️  삽입할 행이 없습니다. KAKAO_REST_KEY를 확인하세요.");
    process.exit(0);
  }

  // 4. Supabase 배치 upsert
  console.log(`💾 Supabase에 업서트 중…`);
  let inserted = 0;
  for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
    const chunk = dbRows.slice(i, i + BATCH_SIZE);
    await upsertBatch(chunk);
    inserted += chunk.length;
    progress(inserted, dbRows.length, "업서트");
  }

  console.log(`\n\n🎉 완료!`);
  console.log(`   삽입/업데이트: ${inserted.toLocaleString()}건`);
  console.log(`   건너뜀: ${(mapped.length - inserted - skipped).toLocaleString()}건`);
  console.log(`\n카카오맵에서 확인: https://your-app.pages.dev\n`);
}

main().catch((e) => {
  console.error("\n❌ 오류:", e.message);
  process.exit(1);
});
