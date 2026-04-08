"""
scripts/collect_data.py

행안부 착한가격업소 공공데이터 API → Supabase 자동 수집
GitHub Actions 'daily_update' 워크플로우에서 매일 실행

필요 패키지:
    pip install requests supabase

환경변수 (GitHub Secrets 또는 .env):
    PUBLIC_DATA_API_KEY  공공데이터포털 인증키 (URL 인코딩된 키)
    SUPABASE_URL         Supabase 프로젝트 URL
    SUPABASE_SERVICE_KEY service_role 키 (RLS 우회)
    KAKAO_REST_KEY       카카오 REST API 키 (좌표 없는 항목 지오코딩용)
"""

import os
import time
import requests
from supabase import create_client, Client

# ── 환경변수 ──────────────────────────────────────────────────────────────────
PUBLIC_DATA_API_KEY = os.environ["PUBLIC_DATA_API_KEY"]
SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_KEY        = os.environ["SUPABASE_SERVICE_KEY"]
KAKAO_REST_KEY      = os.environ.get("KAKAO_REST_KEY", "")

# ── Supabase 클라이언트 ───────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── 공공데이터 API 설정 ───────────────────────────────────────────────────────
API_URL      = "https://apis.data.go.kr/1741000/GoodPriceStoreService02/getGoodPriceStoreModelList02"
PAGE_SIZE    = 1000
MAX_PAGES    = 30   # 최대 30,000건

# 요식업 업종 필터 (미용·세탁 등 제외)
FOOD_TYPES = {
    "한식_일반", "한식_육류", "한식_면류", "한식_기타", "한식_찌개류",
    "한식_분식", "한식_구이", "한식_한정식", "한식_해산물", "한식-일반",
    "한식", "중식", "일식", "양식", "기타요식업", "분식", "제과점",
    "한식_탕류",
}

# ── Kakao 지오코딩 (좌표 없는 항목 처리) ─────────────────────────────────────
_geocode_cache: dict = {}

def geocode(address: str) -> tuple[float, float] | None:
    """주소 → (lat, lng). 실패 시 None."""
    if not KAKAO_REST_KEY or not address:
        return None
    if address in _geocode_cache:
        return _geocode_cache[address]

    time.sleep(0.05)  # 카카오 초당 10회 제한
    try:
        resp = requests.get(
            "https://dapi.kakao.com/v2/local/search/address.json",
            params={"query": address, "size": 1},
            headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
            timeout=5,
        )
        docs = resp.json().get("documents", [])
        if not docs:
            _geocode_cache[address] = None
            return None
        result = (float(docs[0]["y"]), float(docs[0]["x"]))
        _geocode_cache[address] = result
        return result
    except Exception:
        return None


# ── 가격 범위 변환 ────────────────────────────────────────────────────────────
def to_price_range(price: int | None) -> str:
    if not price:    return "₩"
    if price <= 5000:  return "₩"
    if price <= 10000: return "₩₩"
    if price <= 20000: return "₩₩₩"
    return "₩₩₩₩"


# ── 한 페이지 데이터 요청 ─────────────────────────────────────────────────────
def fetch_page(page_no: int) -> list[dict]:
    resp = requests.get(
        API_URL,
        params={
            "serviceKey": PUBLIC_DATA_API_KEY,
            "type":       "json",
            "numOfRows":  str(PAGE_SIZE),
            "pageNo":     str(page_no),
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json().get("body", {})
    items = body.get("items", [])
    # 단일 항목이 dict로 오는 경우 처리
    if isinstance(items, dict):
        items = [items]
    return items or []


# ── 항목 → DB 행 변환 ─────────────────────────────────────────────────────────
def map_item(item: dict) -> dict | None:
    name    = (item.get("sh_name") or "").strip()
    address = (item.get("sh_addr") or "").strip()
    biz_type = (item.get("sh_stdr_indst_cl_nm") or item.get("sh_type") or "").strip()

    if not name or not address:
        return None
    if biz_type and biz_type not in FOOD_TYPES:
        return None  # 비요식업 제외

    # 가격: "7,000" 또는 "7000"
    raw_price = item.get("sh_rcmn_price") or item.get("sh_pride_price") or ""
    price = None
    try:
        price = int(str(raw_price).replace(",", "").strip()) or None
    except ValueError:
        pass

    # 좌표: API가 직접 제공하는 경우 사용, 없으면 지오코딩
    lat = _safe_float(item.get("la") or item.get("lat") or item.get("latitude"))
    lng = _safe_float(item.get("lo") or item.get("lng") or item.get("longitude"))

    if not lat or not lng:
        coord = geocode(address)
        if not coord:
            return None  # 좌표 없으면 지도에 표시 불가 → 스킵
        lat, lng = coord

    return {
        "name":        name,
        "address":     address,
        "category":    _normalize_category(biz_type),
        "price_range": to_price_range(price),
        "avg_price":   price,
        "main_menu":   (item.get("sh_pride") or "").strip() or None,
        "source":      "good_price_api",
        "is_active":   True,
        "lat":         lat,
        "lng":         lng,
    }


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return f if f != 0 else None
    except (TypeError, ValueError):
        return None


def _normalize_category(raw: str) -> str:
    mapping = {
        "한식_일반": "한식", "한식_육류": "한식", "한식_면류": "한식",
        "한식_기타": "한식", "한식_찌개류": "한식", "한식_분식": "분식",
        "한식_구이": "한식", "한식_한정식": "한식", "한식_해산물": "한식",
        "한식_탕류": "한식", "한식-일반": "한식",
        "기타요식업": "카페·기타", "제과점": "카페·디저트",
    }
    return mapping.get(raw, raw) if raw else "음식점"


# ── 배치 upsert ───────────────────────────────────────────────────────────────
BATCH = 200

def upsert_rows(rows: list[dict]) -> None:
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        result = (
            supabase.table("restaurants")
            .upsert(chunk, on_conflict="name,address")
            .execute()
        )
        # supabase-py v2 에서는 result.data 로 응답 확인
        if not result.data and hasattr(result, "error") and result.error:
            raise RuntimeError(f"Supabase upsert 오류: {result.error}")


# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    print("📡 착한가격업소 API 수집 시작...")
    total_fetched  = 0
    total_inserted = 0
    total_skipped  = 0

    for page in range(1, MAX_PAGES + 1):
        items = fetch_page(page)
        if not items:
            print(f"   페이지 {page}: 데이터 없음 → 완료")
            break

        rows = []
        for item in items:
            mapped = map_item(item)
            if mapped:
                rows.append(mapped)
            else:
                total_skipped += 1

        if rows:
            upsert_rows(rows)
            total_inserted += len(rows)

        total_fetched += len(items)
        print(f"   페이지 {page:3d}: {len(items)}건 수신 / {len(rows)}건 저장 / 누적 {total_inserted}건")

        if len(items) < PAGE_SIZE:
            print("   마지막 페이지 도달")
            break

        time.sleep(0.2)  # API 부하 방지

    print(f"\n✅ 완료: 총 {total_fetched}건 수신 / {total_inserted}건 저장 / {total_skipped}건 제외")


if __name__ == "__main__":
    main()
