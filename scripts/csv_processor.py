"""
csv_processor.py — 착한가격업소 CSV → Supabase restaurants 임포트 (Python)

사용법:
    python csv_processor.py                                  # 기본 경로 사용
    python csv_processor.py ../data/raw/행정안전부_착한가격업소.csv  # 경로 직접 지정

기능:
    - EUC-KR / UTF-8 자동 감지
    - 카카오 REST API 지오코딩 (주소 → 위경도)
    - 지오코딩 캐시 (geocode_cache.json) — 중단 후 재실행 가능
    - 요식업 카테고리 필터 (미용·세탁 등 제외)
    - 가격 검증 (500 ~ 100,000원)
    - Supabase restaurants 테이블 배치 upsert
    - 실시간 진행 상황 출력

환경변수 (.env):
    SUPABASE_URL          Supabase 프로젝트 URL
    SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)
    KAKAO_REST_KEY        카카오 REST API 키

컬럼 형식 (행정안전부_착한가격업소 현황 기준):
    시도, 시군, 업종, 업소명, 연락처, 주소, 메뉴1, 가격1, 메뉴2, 가격2, 메뉴3, 가격3, 메뉴4, 가격4
"""

import csv
import json
import os
import sys
import time
import requests
from pathlib import Path
from supabase import create_client, Client

# ── 경로 설정 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
ENV_FILE     = SCRIPT_DIR / ".env"
CACHE_FILE   = SCRIPT_DIR / "geocode_cache.json"
DEFAULT_CSV  = SCRIPT_DIR.parent / "data" / "raw" / "행정안전부_착한가격업소 현황_20250930.csv"

# ── .env 로드 ──────────────────────────────────────────────────────────────────
def load_env(path: Path):
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

load_env(ENV_FILE)

SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SERVICE_KEY   = os.getenv("SUPABASE_SERVICE_KEY", "")
KAKAO_KEY     = os.getenv("KAKAO_REST_KEY", "")

# ── 설정값 ─────────────────────────────────────────────────────────────────────
BATCH_SIZE  = 200      # Supabase upsert 배치 크기
SLEEP_SEC   = 0.05     # Kakao API 호출 간격 (초)
MIN_PRICE   = 500      # 최소 가격 (원)
MAX_PRICE   = 100_000  # 최대 가격 (원)

# 요식업 관련 업종 키워드
FOOD_KEYWORDS = [
    "한식", "양식", "중식", "일식", "분식", "기타요식업",
    "요식업", "음식", "식당", "카페", "제과", "패스트푸드",
    "뷔페", "도시락", "치킨", "피자", "족발", "국밥",
]

# ── 유틸 함수 ──────────────────────────────────────────────────────────────────
def detect_encoding(path: Path) -> str:
    """EUC-KR vs UTF-8 간단 판별 (앞 2KB 샘플)"""
    with open(path, "rb") as f:
        sample = f.read(2048)
    for i in range(len(sample) - 1):
        b = sample[i]
        if 0xB0 <= b <= 0xC8 and 0xA1 <= sample[i + 1] <= 0xFE:
            return "euc-kr"
    return "utf-8-sig"  # BOM 포함 UTF-8도 처리


def is_food_category(cat: str) -> bool:
    if not cat:
        return True  # 업종 미기재 → 포함
    return any(kw in cat for kw in FOOD_KEYWORDS)


def parse_price(raw: str) -> int | None:
    """'12,000원' → 12000, 숫자가 아니면 None"""
    cleaned = "".join(c for c in raw if c.isdigit())
    if not cleaned:
        return None
    val = int(cleaned)
    return val if MIN_PRICE <= val <= MAX_PRICE else None


def price_range_label(price: int) -> str:
    if price <= 5_000:  return "₩"
    if price <= 10_000: return "₩₩"
    return "₩₩₩"


# ── 지오코딩 캐시 ──────────────────────────────────────────────────────────────
def load_cache() -> dict:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


# ── 카카오 지오코딩 ────────────────────────────────────────────────────────────
_kakao_ok = True  # 403 발생 시 False로 전환

def geocode(address: str, cache: dict) -> tuple[float | None, float | None]:
    global _kakao_ok
    if not _kakao_ok:
        return None, None

    if address in cache:
        entry = cache[address]
        return entry.get("lat"), entry.get("lng")

    url     = "https://dapi.kakao.com/v2/local/search/address.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_KEY}"}
    params  = {"query": address}

    try:
        r = requests.get(url, headers=headers, params=params, timeout=5)
        if r.status_code == 403:
            print("\n❌ 카카오 API 403 에러!")
            print("   Kakao Developer Console에서 아래를 확인하세요:")
            print("   1) 앱 설정 → 플랫폼 → Web → http://localhost 등록")
            print("   2) 제품 설정 → 카카오맵 → ON 활성화")
            _kakao_ok = False
            return None, None

        if r.status_code == 200:
            docs = r.json().get("documents", [])
            if docs:
                lat = float(docs[0]["y"])
                lng = float(docs[0]["x"])
                cache[address] = {"lat": lat, "lng": lng}
                return lat, lng

    except Exception as e:
        print(f"\n⚠️  API 요청 오류: {e}")

    cache[address] = {"lat": None, "lng": None}
    return None, None


# ── Supabase 클라이언트 (전역, main()에서 초기화) ──────────────────────────────
_sb: Client | None = None


# ── Supabase upsert ────────────────────────────────────────────────────────────
def upsert_batch(rows: list[dict]) -> tuple[int, int]:
    """배치 upsert → (성공 건수, 실패 건수)"""
    if not rows:
        return 0, 0

    # 같은 배치 내 중복 제거 (name+address 기준)
    seen: dict[str, dict] = {}
    for r in rows:
        key = f"{r['name']}||{r['address']}"
        seen[key] = r
    deduped = list(seen.values())

    try:
        res = _sb.table("restaurants").upsert(
            deduped,
            on_conflict="name,address",
        ).execute()
        return len(deduped), 0
    except Exception as e:
        print(f"\n⚠️  Supabase 오류: {e}")
        return 0, len(deduped)


# ── 메인 ───────────────────────────────────────────────────────────────────────
def main():
    # ── 환경변수 체크 ──────────────────────────────────────────────────────────
    missing = []
    if not SUPABASE_URL:   missing.append("SUPABASE_URL")
    if not SERVICE_KEY:    missing.append("SUPABASE_SERVICE_KEY")
    if not KAKAO_KEY:      missing.append("KAKAO_REST_KEY")
    if missing:
        print(f"❌ .env에 다음 키가 없습니다: {', '.join(missing)}")
        print(f"   파일 위치: {ENV_FILE}")
        sys.exit(1)

    # ── Supabase 클라이언트 초기화 ─────────────────────────────────────────────
    global _sb
    _sb = create_client(SUPABASE_URL, SERVICE_KEY)

    # ── CSV 경로 ───────────────────────────────────────────────────────────────
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not csv_path.exists():
        print(f"❌ CSV 파일을 찾을 수 없습니다: {csv_path}")
        print(f"   파일을 {csv_path} 경로에 저장하거나")
        print(f"   python csv_processor.py <파일경로> 로 직접 지정하세요.")
        sys.exit(1)

    # ── CSV 읽기 ───────────────────────────────────────────────────────────────
    encoding = detect_encoding(csv_path)
    print(f"📂 파일: {csv_path.name}")
    print(f"🔤 인코딩: {encoding}")

    with open(csv_path, encoding=encoding, errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        all_rows = list(reader)
        headers  = reader.fieldnames or []

    print(f"📋 컬럼: {' | '.join(headers)}")
    print(f"📊 전체 행: {len(all_rows):,}건\n")

    # ── 지오코딩 캐시 로드 ─────────────────────────────────────────────────────
    cache = load_cache()
    print(f"💾 지오코딩 캐시: {len(cache):,}건 로드됨")

    # ── 행 처리 ────────────────────────────────────────────────────────────────
    batch:          list[dict] = []
    total_ok        = 0
    total_skip      = 0
    total_no_geo    = 0
    total_upserted  = 0
    total_fail      = 0
    cache_save_count = 0

    for i, row in enumerate(all_rows, 1):
        name     = (row.get("업소명") or "").strip()
        address  = (row.get("주소") or "").strip()
        category = (row.get("업종") or "").strip()
        sido     = (row.get("시도") or "").strip()
        sigun    = (row.get("시군") or "").strip()
        phone    = (row.get("연락처") or "").strip()

        # 필수값 체크
        if not name or not address:
            total_skip += 1
            continue

        # 요식업 필터
        if not is_food_category(category):
            total_skip += 1
            continue

        # 메뉴 1~4 파싱
        menus = []
        for idx in range(1, 5):
            mname  = (row.get(f"메뉴{idx}") or "").strip()
            mprice = parse_price(row.get(f"가격{idx}") or "")
            if mname and mprice:
                menus.append({"name": mname, "price": mprice})

        # 대표메뉴: 가격 가장 낮은 것
        menus.sort(key=lambda m: m["price"])
        main_menu = menus[0] if menus else None
        min_price = main_menu["price"] if main_menu else None

        # 지오코딩
        lat, lng = geocode(address, cache)
        if not lat or not lng:
            total_no_geo += 1
            if not _kakao_ok:
                # 403이면 지금까지 배치 flush하고 종료
                if batch:
                    ok, fail = upsert_batch(batch)
                    total_upserted += ok; total_fail += fail
                    batch.clear()
                break
            continue

        total_ok += 1

        batch.append({
            "name":        name,
            "address":     address,
            "category":    category or "기타요식업",
            "phone":       phone or None,
            "main_menu":   main_menu["name"]  if main_menu else None,
            "avg_price":   min_price,           # DB 컬럼명: avg_price (not price)
            "price_range": price_range_label(min_price) if min_price else "₩",
            "lat":         lat,
            "lng":         lng,
            "source":      "good_price_csv",
            "is_active":   True,
            # sido/sigun 은 DB 스키마에 없음 → 생략
            # is_ad 는 DB DEFAULT FALSE 이므로 생략
        })

        # 배치 upsert
        if len(batch) >= BATCH_SIZE:
            ok, fail = upsert_batch(batch)
            total_upserted += ok; total_fail += fail
            batch.clear()
            save_cache(cache)
            cache_save_count += 1

        # 진행 상황 출력
        if i % 100 == 0:
            print(f"  [{i:>6}/{len(all_rows):>6}] ✅{total_ok} ⏭️{total_skip} 🗺️실패:{total_no_geo} 💾DB:{total_upserted}")

        time.sleep(SLEEP_SEC)

    # ── 남은 배치 flush ────────────────────────────────────────────────────────
    if batch:
        ok, fail = upsert_batch(batch)
        total_upserted += ok; total_fail += fail

    # ── 캐시 최종 저장 ─────────────────────────────────────────────────────────
    save_cache(cache)

    # ── 최종 결과 ──────────────────────────────────────────────────────────────
    print("\n" + "─" * 50)
    print("🎉 완료!")
    print(f"   전체 읽은 행:      {len(all_rows):>7,}건")
    print(f"   건너뜀 (업종 등):  {total_skip:>7,}건")
    print(f"   지오코딩 실패:     {total_no_geo:>7,}건")
    print(f"   지오코딩 성공:     {total_ok:>7,}건")
    print(f"   DB 삽입/업데이트:  {total_upserted:>7,}건")
    if total_fail:
        print(f"   DB 실패:          {total_fail:>7,}건")
    print(f"   캐시 저장 위치:   {CACHE_FILE}")
    if not _kakao_ok:
        print("\n⚠️  카카오 API 403 오류로 중단됨. API 설정 후 재실행하세요.")
        print("   (캐시 덕분에 이미 조회한 주소는 재호출되지 않습니다)")


if __name__ == "__main__":
    main()
