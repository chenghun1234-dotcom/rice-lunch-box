"""
scripts/test_local.py

로컬 테스트용 — 착한가격업소 API 10건만 수집 → Supabase 저장
(GitHub Actions용 collect_data.py 의 미니 버전)

실행 전 준비:
    1. scripts/.env 파일에 4개 키 입력 (아래 참고)
    2. python -m pip install requests supabase python-dotenv

실행:
    cd scripts
    python test_local.py
"""

import os
import time
import requests
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# ── .env 로드 (scripts/.env 또는 프로젝트 루트 .env) ─────────────────────────
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
    print(f"✅ .env 로드: {_env_path}")
else:
    print(f"⚠️  {_env_path} 파일이 없습니다.")
    print("   .env.example 을 복사해서 .env 로 만들고 키를 입력하세요.")
    raise SystemExit(1)

# ── 환경변수 읽기 ────────────────────────────────────────────────────────────
PUBLIC_DATA_API_KEY = os.getenv("PUBLIC_DATA_API_KEY", "")
KAKAO_REST_KEY      = os.getenv("KAKAO_REST_KEY", "")
SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY        = os.getenv("SUPABASE_SERVICE_KEY", "")

REQUIRED = {
    "SUPABASE_URL":         (SUPABASE_URL,
        "Supabase 대시보드 → 프로젝트 선택 → Settings → API → Project URL\n"
        "   형식: https://xxxxxxxxxxxxxxxxxxxx.supabase.co"),
    "SUPABASE_SERVICE_KEY": (SUPABASE_KEY,
        "Supabase 대시보드 → Settings → API → service_role (Secret) 키"),
    "KAKAO_REST_KEY":       (KAKAO_REST_KEY,
        "developers.kakao.com → 내 애플리케이션 → 앱 키 → REST API 키"),
    "PUBLIC_DATA_API_KEY":  (PUBLIC_DATA_API_KEY,
        "data.go.kr → 마이페이지 → 일반 인증키 (URL 인코딩 키)"),
}
has_error = False
for var, (val, hint) in REQUIRED.items():
    if not val:
        print(f"❌ 누락: {var}")
        print(f"   → {hint}\n")
        has_error = True
if has_error:
    raise SystemExit(1)

# ── Supabase 클라이언트 ───────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── 공공데이터 API 설정 ───────────────────────────────────────────────────────
API_URL = (
    "https://apis.data.go.kr/1741000/"
    "GoodPriceStoreService02/getGoodPriceStoreModelList02"
)
TEST_ROWS = 10  # 테스트: 10건만


# ── 카카오 주소 → 좌표 변환 ───────────────────────────────────────────────────
_kakao_service_ok = True  # 403 발생 시 False 로 전환해 이후 호출 스킵

def get_coordinates(address: str) -> tuple[float, float] | tuple[None, None]:
    """
    카카오 로컬 REST API: 주소 → (위도 lat, 경도 lng)
    응답의 x = 경도(lng), y = 위도(lat) 임에 주의
    """
    global _kakao_service_ok
    if not _kakao_service_ok:
        return None, None

    url = "https://dapi.kakao.com/v2/local/search/address.json"
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
            params={"query": address, "size": 1},
            timeout=5,
        )

        if resp.status_code == 403:
            msg = resp.json().get("message", "")
            _kakao_service_ok = False
            print("\n" + "━" * 55)
            print(f"❌ 카카오 로컬 API 권한 오류: {msg}")
            print()
            print("  📌 해결 방법:")
            print("  1. https://developers.kakao.com 접속")
            print("  2. 내 애플리케이션 → [도시락탈출 앱] 선택")
            print("  3. 왼쪽 메뉴 → [제품 설정] → [카카오맵]")
            print("  4. 상태를 [ON] 으로 활성화")
            print("  ※ 또는 [앱 설정] → [플랫폼] 에서 Web 등록 필요")
            print("━" * 55 + "\n")
            raise SystemExit(1)

        docs = resp.json().get("documents", [])
        if docs:
            return float(docs[0]["y"]), float(docs[0]["x"])  # lat, lng
    except SystemExit:
        raise
    except Exception as e:
        print(f"   ⚠️  좌표 변환 에러 ({address}): {e}")
    return None, None


# ── 가격 → 가격대 문자열 ─────────────────────────────────────────────────────
def to_price_range(price: int | None) -> str:
    if not price:      return "₩"
    if price <= 5000:  return "₩"
    if price <= 10000: return "₩₩"
    if price <= 20000: return "₩₩₩"
    return "₩₩₩₩"


# ── 업종 → 카테고리 정규화 ───────────────────────────────────────────────────
CATEGORY_MAP = {
    "한식_일반": "한식", "한식_육류": "한식", "한식_면류": "한식",
    "한식_기타": "한식", "한식_찌개류": "한식", "한식_분식": "분식",
    "한식_구이": "한식", "한식_한정식": "한식", "한식_해산물": "한식",
    "한식_탕류": "한식", "한식-일반": "한식",
    "기타요식업": "카페·기타", "제과점": "카페·디저트",
}

def normalize_category(raw: str) -> str:
    return CATEGORY_MAP.get(raw, raw) if raw else "음식점"


# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    print(f"\n📡 착한가격업소 API 테스트 ({TEST_ROWS}건) 시작...\n")

    # 1. API 호출
    resp = requests.get(
        API_URL,
        params={
            "serviceKey": PUBLIC_DATA_API_KEY,
            "type":       "json",
            "numOfRows":  str(TEST_ROWS),
            "pageNo":     "1",
        },
        timeout=30,
    )
    resp.raise_for_status()
    body  = resp.json().get("body", {})
    items = body.get("items", [])
    if isinstance(items, dict):    # 단일 항목이 dict 로 오는 케이스
        items = [items]

    print(f"API 응답: {len(items)}건\n")
    if not items:
        print("❌ 데이터가 없습니다. API 키나 파라미터를 확인하세요.")
        return

    # 2. 항목 변환
    rows: list[dict] = []
    for item in items:
        name    = (item.get("sh_name") or "").strip()
        address = (item.get("sh_addr") or "").strip()
        biz_type = (item.get("sh_stdr_indst_cl_nm") or item.get("sh_type") or "").strip()

        if not name or not address:
            print(f"  - 스킵 (이름/주소 없음)")
            continue

        # 가격 파싱: "7,000" or "7000" or 숫자
        raw_price = item.get("sh_rcmn_price") or item.get("sh_pride_price") or ""
        avg_price = None
        try:
            avg_price = int(str(raw_price).replace(",", "").strip()) or None
        except ValueError:
            pass

        # 좌표: API 직접 제공 우선, 없으면 카카오 지오코딩
        lat = _safe_float(item.get("la") or item.get("lat") or item.get("latitude"))
        lng = _safe_float(item.get("lo") or item.get("lng") or item.get("longitude"))

        if not lat or not lng:
            print(f"  [{name}] 좌표 없음 → 카카오 API 지오코딩 중...")
            time.sleep(0.05)  # 카카오 초당 10회 제한
            lat, lng = get_coordinates(address)

        if not lat or not lng:
            print(f"  [{name}] ❌ 좌표 변환 실패 → 건너뜀")
            continue

        row = {
            # ★ 우리 restaurants 테이블 컬럼명에 맞춤
            "name":        name,
            "address":     address,
            "category":    normalize_category(biz_type),
            "avg_price":   avg_price,
            "price_range": to_price_range(avg_price),
            "main_menu":   (item.get("sh_pride") or "").strip() or None,
            "lat":         lat,
            "lng":         lng,
            "source":      "good_price_api",
            "is_active":   True,
        }
        rows.append(row)
        print(f"  ✅ {name:18s}  {address[:25]:25s}  ({lat:.5f}, {lng:.5f})  {avg_price or '-'}원")

    # 3. Supabase upsert
    if not rows:
        print("\n저장할 데이터가 없습니다.")
        return

    print(f"\n🗄️  Supabase upsert 중 ({len(rows)}건)...")
    result = (
        supabase.table("restaurants")
        .upsert(rows, on_conflict="name,address")
        .execute()
    )
    saved = len(result.data) if result.data else 0
    print(f"✅ 저장 완료: {saved}건\n")

    # 저장된 첫 항목 출력
    if result.data:
        first = result.data[0]
        print("--- 저장 예시 ---")
        for k, v in first.items():
            print(f"  {k:15s}: {v}")


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return f if f != 0 else None
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
