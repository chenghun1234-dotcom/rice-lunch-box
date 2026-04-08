// ============================================================
// scripts/check-closed-restaurants.js
// 지방행정인허가데이터(LOCALDATA) API로 폐업 식당 비활성화
// 매일 새벽 배치: is_active = false 처리하여 DB 최신성 유지
// API: https://www.localdata.go.kr/devcenter/apiGuide.do
// ============================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LOCALDATA_API_KEY = process.env.LOCALDATA_API_KEY;
const LOCALDATA_BASE    = "https://www.localdata.go.kr/platform/rest/TO0/openDataApi";

// 서울 주요 구청 코드 (행정구역 코드)
// 전체 목록: https://www.localdata.go.kr/devcenter/dataDown.do
const DISTRICT_CODES = [
  { code: "3620000", name: "강남구" },
  { code: "3630000", name: "마포구" },
  { code: "3590000", name: "종로구" },
  { code: "3600000", name: "중구"   },
  { code: "3610000", name: "용산구" },
  { code: "3640000", name: "성동구" },
  { code: "3650000", name: "광진구" },
  { code: "3660000", name: "동대문구" },
  { code: "3670000", name: "중랑구"  },
  { code: "3680000", name: "성북구"  },
  { code: "3690000", name: "강북구"  },
  { code: "3700000", name: "도봉구"  },
  { code: "3710000", name: "노원구"  },
  { code: "3720000", name: "은평구"  },
  { code: "3730000", name: "서대문구" },
  { code: "3740000", name: "양천구"  },
  { code: "3750000", name: "강서구"  },
  { code: "3760000", name: "구로구"  },
  { code: "3770000", name: "금천구"  },
  { code: "3780000", name: "영등포구" },
  { code: "3790000", name: "동작구"  },
  { code: "3800000", name: "관악구"  },
  { code: "3810000", name: "서초구"  },
  { code: "3820000", name: "송파구"  },
  { code: "3830000", name: "강동구"  },
];

// LOCALDATA 업태코드: 한식, 중식, 일식, 경양식, 분식 등
const FOOD_UPTE_CODES = ["한식", "중식", "분식", "경양식", "일식"];

let totalClosed = 0;
let totalChecked = 0;

async function checkDistrict({ code, name }) {
  console.log(`\n[${name}] 폐업 확인 중...`);

  for (const upteNm of FOOD_UPTE_CODES) {
    try {
      const params = new URLSearchParams({
        authKey:    LOCALDATA_API_KEY,
        opnSvcId:   "07_24_04_P",       // 일반음식점 서비스 ID
        pageIndex:  "1",
        pageSize:   "1000",
        localCode:  code,
        uptaeNm:    upteNm,
        bsnStateCode: "03",             // 03 = 폐업
        resultType: "json",
      });

      const res  = await fetch(`${LOCALDATA_BASE}?${params}`);
      const json = await res.json();
      const rows = json?.result?.body?.rows ?? [];

      if (rows.length === 0) continue;

      const closedNames = rows
        .map((r) => r.bplcNm?.trim())
        .filter(Boolean);

      totalChecked += closedNames.length;

      // 폐업 식당과 이름이 같고 같은 구 주소를 가진 식당 비활성화
      // (주소 LIKE 검색으로 구 이름 포함 여부 확인)
      const { count, error } = await supabase
        .from("restaurants")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("name", closedNames)
        .ilike("address", `%${name}%`)
        .eq("is_active", true)
        .select("id", { count: "exact", head: true });

      if (error) {
        console.error(`  [${name}/${upteNm}] 업데이트 오류:`, error.message);
      } else if (count > 0) {
        console.log(`  ✓ ${name}/${upteNm}: ${count}건 폐업 처리`);
        totalClosed += count;
      }

    } catch (err) {
      console.error(`  [${name}/${upteNm}] 오류:`, err.message);
    }
  }

  // API 과부하 방지
  await new Promise((r) => setTimeout(r, 500));
}

// ── LOCALDATA에서 새 식당 정보도 수집 (신규 개업) ──────────
async function fetchNewOpenings({ code, name }) {
  // 지난 30일 이내 개업한 식당만 수집
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
    .toISOString().slice(0, 8).replace(/-/g, ""); // YYYYMMDD

  try {
    const params = new URLSearchParams({
      authKey:    LOCALDATA_API_KEY,
      opnSvcId:   "07_24_04_P",
      pageIndex:  "1",
      pageSize:   "500",
      localCode:  code,
      bsnStateCode: "01",              // 01 = 영업중
      lastModTsBgn: thirtyDaysAgo,
      resultType: "json",
    });

    const res  = await fetch(`${LOCALDATA_BASE}?${params}`);
    const json = await res.json();
    return json?.result?.body?.rows ?? [];
  } catch {
    return [];
  }
}

function toNewRestaurantRow(item, name) {
  const lat = parseFloat(item.y ?? 0);
  const lng = parseFloat(item.x ?? 0);
  if (!lat || !lng) return null;

  return {
    name:      (item.bplcNm ?? "").trim(),
    category:  item.uptaeNm ?? "음식",
    address:   item.rdnWhlAddr ?? item.sitewhlAddr ?? "",
    phone:     item.siteTel ?? null,
    tags:      ["최근개업"],
    location:  `SRID=4326;POINT(${lng} ${lat})`,
    geohash6:  encodeGeohash6(lat, lng),
    source:    "localdata",
    is_active: true,
  };
}

// ── Geohash 인코딩 ────────────────────────────────────────
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
  console.log("🔍 LOCALDATA 폐업 체크 + 신규 개업 수집 시작:", new Date().toISOString());

  let newRows = [];

  for (const district of DISTRICT_CODES) {
    await checkDistrict(district);
    const openings = await fetchNewOpenings(district);
    newRows.push(...openings.map((r) => toNewRestaurantRow(r, district.name)).filter(Boolean));
  }

  // 신규 개업 식당 upsert
  if (newRows.length > 0) {
    const BATCH = 100;
    let upserted = 0;
    for (let i = 0; i < newRows.length; i += BATCH) {
      const { error } = await supabase
        .from("restaurants")
        .upsert(newRows.slice(i, i + BATCH), { onConflict: "name,address", ignoreDuplicates: false });
      if (!error) upserted += Math.min(BATCH, newRows.length - i);
    }
    console.log(`\n✅ 신규 개업: ${upserted}건 저장`);
  }

  console.log(`\n📊 최종 결과:`);
  console.log(`   폐업 확인 대상: ${totalChecked}건`);
  console.log(`   실제 비활성화:  ${totalClosed}건`);
  console.log(`   신규 개업 수집: ${newRows.length}건`);
}

main().catch((e) => { console.error(e); process.exit(1); });
