// ============================================================
// scripts/collect-public-data.js
// 공공데이터포털 '착한가격업소' API 수집 → Supabase upsert
// GitHub Actions에서 하루 2회 실행
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const API_KEY       = process.env.PUBLIC_DATA_API_KEY;

// 착한가격업소 API (공공데이터포털)
// https://www.data.go.kr/data/15013117/openapi.do
const PUBLIC_API_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius";

const SEOUL_DISTRICTS = [
  // 주요 직장인 밀집 지역 우선 수집
  { name: "강남구 역삼동",   lat: 37.5008, lng: 127.0366 },
  { name: "마포구 합정동",   lat: 37.5490, lng: 126.9131 },
  { name: "영등포구 여의도", lat: 37.5219, lng: 126.9246 },
  { name: "송파구 잠실동",   lat: 37.5133, lng: 127.1028 },
  { name: "종로구 종로3가",  lat: 37.5706, lng: 126.9921 },
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchDistrict({ name, lat, lng }) {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo:     "1",
    numOfRows:  "100",
    indsLclsCd: "Q",     // Q = 음식업
    radius:     "1000",
    cx:         String(lng),
    cy:         String(lat),
    type:       "json",
  });

  const url = `${PUBLIC_API_BASE}?${params}`;
  const res  = await fetch(url);

  if (!res.ok) {
    console.error(`[${name}] API 오류:`, res.status);
    return [];
  }

  const json = await res.json();
  const items = json?.body?.items ?? [];
  console.log(`[${name}] ${items.length}건 수집`);
  return items;
}

function toRestaurantRow(item) {
  const lat = parseFloat(item.lat ?? item.cy ?? 0);
  const lng = parseFloat(item.lon ?? item.cx ?? 0);
  if (!lat || !lng) return null;

  return {
    name:         item.bizesNm ?? item.cmpnmNm ?? "이름 없음",
    category:     item.indsSmclsNm ?? "음식",
    address:      item.rdnmadr ?? item.lnmadr ?? "",
    phone:        item.telno ?? null,
    avg_price:    null,          // 착한가격업소는 가격 정보 없음 → 추후 수동 입력
    image_url:    null,
    tags:         ["착한가격", "공공인증"],
    // PostGIS POINT 포맷: ST_MakePoint(lng, lat)
    location:     `SRID=4326;POINT(${lng} ${lat})`,
    geohash6:     encodeGeohash6(lat, lng),
    source:       "public_api",
    is_active:    true,
  };
}

// ── 간단 Geohash 인코딩 (Node.js 용) ─────────────────────
function encodeGeohash6(lat, lng) {
  const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let idx = 0, bit = 0, even = true;
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = "";
  while (hash.length < 6) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      lng >= mid ? (idx = idx * 2 + 1, lngMin = mid) : (idx = idx * 2, lngMax = mid);
    } else {
      const mid = (latMin + latMax) / 2;
      lat >= mid ? (idx = idx * 2 + 1, latMin = mid) : (idx = idx * 2, latMax = mid);
    }
    even = !even;
    if (++bit === 5) { hash += B32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

async function main() {
  console.log("🍱 착한가격업소 수집 시작:", new Date().toISOString());

  const allItems = [];
  for (const district of SEOUL_DISTRICTS) {
    const items = await fetchDistrict(district);
    allItems.push(...items);
    // API 과부하 방지 (1초 간격)
    await new Promise((r) => setTimeout(r, 1000));
  }

  const rows = allItems.map(toRestaurantRow).filter(Boolean);
  console.log(`총 ${rows.length}건 Supabase upsert 시작...`);

  // 배치 upsert (100건씩)
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("restaurants")
      .upsert(batch, {
        onConflict:        "name,address",  // 중복 식당 업데이트
        ignoreDuplicates:  false,
      });

    if (error) {
      console.error("Upsert 오류:", error.message);
    } else {
      upserted += batch.length;
    }
  }

  console.log(`✅ 완료: ${upserted}건 저장됨`);
}

main().catch((e) => { console.error(e); process.exit(1); });
