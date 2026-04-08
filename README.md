# 🍱 도시락탈출 — MVP 아키텍처 & 배포 가이드

> **운영비 0원** · 위치 기반 가성비 식당 발견 + 네이티브 광고 수익 모델

---

## 📁 폴더 구조

```
도시락탈출/
├── .env.example                        # 환경변수 목록 (이 파일 참고)
├── .github/
│   └── workflows/
│       ├── collect-data.yml            # 공공데이터 자동 수집 (하루 2회)
│       └── deploy.yml                  # Cloudflare Pages 자동 배포
│
├── apps/
│   └── web/                            # ── 프론트엔드 (Vite + React) ──
│       ├── index.html
│       ├── vite.config.js
│       ├── package.json
│       └── src/
│           ├── main.jsx
│           ├── App.jsx                 # 메인 화면 (지도 + 광고 슬롯)
│           ├── index.css
│           ├── lib/
│           │   ├── supabase.js         # Supabase 클라이언트 싱글톤
│           │   └── geohash.js          # Geohash 인코딩 (의존성 0)
│           ├── hooks/
│           │   ├── useGeolocation.js   # GPS 위치 취득
│           │   └── useAdPlaylist.js    # 광고 플레이리스트 취득
│           └── components/
│               ├── Map/
│               │   └── KakaoMap.jsx    # 카카오맵 (동적 SDK 로드)
│               └── AdList/
│                   ├── SponsoredItem.jsx   # 상단 고정 광고 카드
│                   └── PlaylistCard.jsx    # 큐레이션 테마 카드
│
├── workers/
│   └── ad-engine/                      # ── Cloudflare Worker ──
│       ├── index.js                    # KV 캐시 + 광고 라우팅
│       └── wrangler.toml               # 배포 설정
│
├── supabase/
│   ├── migrations/                     # ── DB 마이그레이션 (순서대로 실행) ──
│   │   ├── 001_init.sql                # 기본 테이블 + PostGIS
│   │   ├── 002_ads.sql                 # 광고주·플레이리스트·타임세일
│   │   └── 003_postgis_functions.sql   # 반경 검색 함수
│   └── functions/                      # ── Edge Functions (Deno) ──
│       ├── deno.json
│       ├── nearby-ads/index.ts         # 위치→광고 반환
│       └── log-ad-click/index.ts       # 클릭 이벤트 기록
│
├── scripts/
│   ├── package.json
│   └── collect-public-data.js          # 착한가격업소 API 수집
│
```
    └── ads/
        └── sponsored.json              # 초기 광고 샘플 데이터
```

---

## 🚀 배포 순서 (처음 한 번만)

### STEP 1 · Supabase 설정
```bash
# 1-1. supabase.com 에서 새 프로젝트 생성
# 1-2. SQL Editor에서 마이그레이션 파일을 순서대로 실행
#      001_init.sql → 002_ads.sql → 003_postgis_functions.sql
# 1-3. Edge Functions 배포
npx supabase functions deploy nearby-ads    --project-ref YOUR_PROJECT_REF
npx supabase functions deploy log-ad-click  --project-ref YOUR_PROJECT_REF
```

### STEP 2 · Cloudflare Workers KV 생성
```bash
cd workers/ad-engine
npx wrangler login
npx wrangler kv:namespace create GEO_CACHE
# → 출력된 id를 wrangler.toml 의 id 값에 붙여넣기

# 환경변수 등록 (secrets)
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY

# Workers 배포
npx wrangler deploy
```

### STEP 3 · Cloudflare Pages 연결
```bash
# Cloudflare 대시보드 → Pages → 새 프로젝트 → GitHub 연결
# 빌드 설정:
#   루트 디렉토리:  apps/web
#   빌드 명령:      npm run build
#   출력 디렉토리:  dist
```

### STEP 4 · GitHub Secrets 등록
```
Settings → Secrets and variables → Actions 에 아래 항목 추가:
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  VITE_KAKAO_MAP_KEY
  VITE_CF_WORKER_URL        ← wrangler deploy 후 생성된 URL
  SUPABASE_SERVICE_ROLE_KEY
  PUBLIC_DATA_API_KEY
  CF_API_TOKEN
  CF_ACCOUNT_ID
```

### STEP 5 · main 브랜치 push → 자동 배포 시작

---

## 🔑 환경변수 목록 전체

| 변수명 | 설명 | 어디서 얻나 |
|--------|------|------------|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | Supabase > Settings > API |
| `VITE_SUPABASE_ANON_KEY` | Supabase 공개 키 | Supabase > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 비밀 키 | Supabase > Settings > API |
| `VITE_KAKAO_MAP_KEY` | 카카오맵 JS 키 | developers.kakao.com |
| `VITE_CF_WORKER_URL` | Workers 엔드포인트 | wrangler deploy 결과 |
| `CF_ACCOUNT_ID` | Cloudflare 계정 ID | Cloudflare 대시보드 |
| `CF_API_TOKEN` | Cloudflare API 토큰 | Cloudflare > My Profile > API Tokens |
| `PUBLIC_DATA_API_KEY` | 공공데이터포털 인증키 | data.go.kr |
| `VITE_AD_RADIUS_METERS` | 광고 반경 (기본 1000m) | 직접 설정 |
| `VITE_PINNED_AD_SLOTS` | 상단 고정 슬롯 수 (기본 3) | 직접 설정 |
| `VITE_LUNCH_START_HOUR` | 점심 타임세일 시작 (기본 11) | 직접 설정 |
| `VITE_LUNCH_END_HOUR` | 점심 타임세일 종료 (기본 13) | 직접 설정 |

---

## 💰 광고 수익 모델 요약

| 플랜 | 노출 방식 | 가격 예시 |
|------|----------|---------|
| **Pinned** | 검색 결과 상단 1~3위 고정 | 월 5,000원 |
| **TimeSale** | 점심(11~13시) 타임세일 배너 | 일 1,000원 |
| **Playlist** | 큐레이션 테마 TOP 5 입점 | 건당 3,000원 |

---

## 💸 무료 티어 사용량 기준

| 서비스 | 무료 한도 | 실제 사용 추정 |
|--------|----------|---------------|
| Cloudflare Pages | 트래픽 무제한 | ✅ 여유 |
| Cloudflare Workers | 일 10만 건 | KV 캐시로 실제 10분의 1 사용 |
| Workers KV | 일 읽기 10만 / 쓰기 1천 | ✅ 여유 |
| Supabase DB | 500MB | ✅ 여유 |
| Supabase Edge Functions | 50만 호출/월 | KV 캐시로 실제 사용 최소화 |
| 카카오맵 API | 일 5만 건 | ✅ 여유 |
| GitHub Actions | 월 2,000분 | 하루 2회 수집, 약 5분 → 월 300분 |
>>>>>>> 6a96284 (프로젝트 최초 커밋)
