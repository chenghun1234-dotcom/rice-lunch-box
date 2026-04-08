// ============================================================
// apps/web/src/App.jsx
// 메인 앱: 지도 + 광고 슬롯 + 플레이리스트 조합
// 라우팅 (hash 기반):
//   #/          메인
//   #/dashboard 업주 대시보드
//   #/report    트렌드 리포트
//   #/r/:slug   Programmatic SEO 지역 페이지
//   #/submit    유저 제보
//   #/dashboard/payment-success|payment-fail  결제 결과
// ============================================================
import React, { useState, useMemo, useRef, lazy, Suspense, useEffect, useCallback } from "react";
import KakaoMap           from "./components/Map/KakaoMap";
import BottomSheet         from "./components/BottomSheet/BottomSheet";
import SponsoredItem      from "./components/AdList/SponsoredItem";
import PlaylistCard       from "./components/AdList/PlaylistCard";
import SalesEvidence      from "./components/Dashboard/SalesEvidence";
import { useGeolocation }  from "./hooks/useGeolocation";
import { useAdPlaylist }   from "./hooks/useAdPlaylist";
import { useNearbyStores } from "./hooks/useNearbyStores";
import { supabase }        from "./lib/supabase";
import { confirmPayment }  from "./lib/payment";

// 코드 스플리팅
const AdDashboard = lazy(() => import("./pages/dashboard/AdDashboard"));
const TrendReport = lazy(() => import("./pages/report/TrendReport"));
const RegionPage  = lazy(() => import("./pages/seo/RegionPage"));
const ReportPage  = lazy(() => import("./pages/submit/ReportPage"));
const LoginPage   = lazy(() => import("./pages/auth/LoginPage"));
const SignupPage  = lazy(() => import("./pages/auth/SignupPage"));

// ── 최소 Hash SPA 라우터 (react-router 없이, 의존성 0) ─────────────────────
function parseHash() {
  // window.location.hash 예: "#/r/mapo-gu-hapjeong-dong-jomshik"
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathname, search] = raw.split("?");
  return { pathname: pathname || "/", search: search ? `?${search}` : "" };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  React.useEffect(() => {
    const handler = () => setRoute(parseHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}

// 네비게이션 헬퍼
function navigate(to) {
  window.location.hash = to;
}

export default function App() {
  const { pathname } = useRoute();
  const geo     = useGeolocation();
  const adData  = useAdPlaylist({ lat: geo.lat, lng: geo.lng, geohash6: geo.geohash6 });
  const nearby  = useNearbyStores({ lat: geo.lat, lng: geo.lng });
  const [selected, setSelected]   = useState(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [bounds, setBounds]       = useState(null);
  const [user, setUser]           = useState(null);
  const mapRef  = useRef(null);

  // 로그인 상태 구독
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  // 광고 식당 id 집합 (중복 마커 방지)
  const adIds = useMemo(() => new Set(adData.pinnedAds.map((a) => a.id)), [adData.pinnedAds]);

  // 일반 식당 (광고와 중복 제거)
  const regularStores = useMemo(
    () => nearby.stores.filter((s) => !adIds.has(s.id)),
    [nearby.stores, adIds]
  );

  // 현재 지도 뷰포트에 보이는 식당만 필터링 (BottomSheet 용)
  const visibleRestaurants = useMemo(() => {
    const all = [
      ...adData.pinnedAds.map((a) => ({ ...a, is_ad: true })),
      ...regularStores.map((s) => ({ ...s, is_ad: false })),
    ];
    if (!bounds) return all;
    return all.filter(
      (r) =>
        r.lat >= bounds.swLat && r.lat <= bounds.neLat &&
        r.lng >= bounds.swLng && r.lng <= bounds.neLng
    );
  }, [adData.pinnedAds, regularStores, bounds]);

  // 지도 마커: 광고(is_ad=true) + 일반 식당 합산 (훅은 조건부 return 전에 호출해야 함)
  const mapMarkers = useMemo(() => [
    ...adData.pinnedAds.map((ad) => ({
      id:        ad.id,
      name:      ad.name,
      lat:       ad.lat,
      lng:       ad.lng,
      avg_price: ad.avg_price,
      is_ad:     true,
    })),
    ...regularStores.map((s) => ({
      id:        s.id,
      name:      s.name,
      lat:       s.lat,
      lng:       s.lng,
      avg_price: s.avg_price,
      is_ad:     false,
    })),
  ], [adData.pinnedAds, regularStores]);

  // ── 라우팅 ───────────────────────────────────────────────

  // Programmatic SEO: #/r/{slug}
  const regionMatch = pathname.match(/^\/r\/(.+)$/);
  if (regionMatch) {
    return (
      <Suspense fallback={<div className="loading">페이지 로딩 중...</div>}>
        <NavBar current="" onNavigate={navigate} user={user} onLogout={handleLogout} />
        <RegionPage slug={regionMatch[1]} />
      </Suspense>
    );
  }

  if (pathname.startsWith("/login")) {
    return (
      <Suspense fallback={<div className="loading">로딩 중...</div>}>
        <LoginPage />
      </Suspense>
    );
  }
  if (pathname.startsWith("/signup")) {
    return (
      <Suspense fallback={<div className="loading">로딩 중...</div>}>
        <SignupPage />
      </Suspense>
    );
  }

  if (pathname.startsWith("/dashboard/payment-success")) {
    return <PaymentResult success />;
  }
  if (pathname.startsWith("/dashboard/payment-fail")) {
    return <PaymentResult success={false} />;
  }

  if (pathname.startsWith("/dashboard")) {
    return (
      <Suspense fallback={<div className="loading">대시보드 로딩 중...</div>}>
        <NavBar current="dashboard" onNavigate={navigate} user={user} onLogout={handleLogout} />
        <AdDashboard />
      </Suspense>
    );
  }
  if (pathname.startsWith("/report")) {
    return (
      <Suspense fallback={<div className="loading">리포트 생성 중...</div>}>
        <NavBar current="report" onNavigate={navigate} user={user} onLogout={handleLogout} />
        <TrendReport />
      </Suspense>
    );
  }
  if (pathname.startsWith("/submit")) {
    return (
      <Suspense fallback={<div className="loading">로딩 중...</div>}>
        <NavBar current="submit" onNavigate={navigate} user={user} onLogout={handleLogout} />
        <ReportPage />
      </Suspense>
    );
  }

  // ── 메인 화면 ────────────────────────────────────────────
  return (
    <div className="app">
      <NavBar current="home" onNavigate={navigate} user={user} onLogout={handleLogout} />
      <header className="app-header">
        <h1>🍱 도시락탈출</h1>
        {adData.isLunchTime && (
          <div className="lunch-banner">
            🔥 지금 점심 특가 시간! 할인 식당이 상단에 표시됩니다.
          </div>
        )}
        {geo.error && <p className="geo-error">📍 {geo.error} · 기본 위치(서울 시청)로 표시합니다.</p>}
      </header>

      {/* 지도 */}
      <KakaoMap
        ref={mapRef}
        lat={geo.lat}
        lng={geo.lng}
        restaurants={mapMarkers}
        onMarkerClick={setSelected}
        onBoundsChange={setBounds}
      />

      {/* 하단 식당 리스트 시트 */}
      <BottomSheet
        restaurants={visibleRestaurants}
        myLat={geo.lat}
        myLng={geo.lng}
        onSelect={(r) => {
          setSelected(r);
          adData.logClick(r.id, 0);
          // 리스트 클릭 → 지도 이동 + 인포윈도우 오픈
          mapRef.current?.panToStore(r);
        }}
        selected={selected}
      />

      <main className="main-content">
        {/* ── 광고 영업 증거 토글 (대시보드 진입 전 훅) ── */}
        {!showEvidence && (
          <div className="evidence-tease" onClick={() => setShowEvidence(true)}>
            <span>📊 이 동네 이번 달 앱 사용자 수 보기</span>
            <span className="tease-arrow">▼</span>
          </div>
        )}
        {showEvidence && (
          <SalesEvidence
            geohash6={geo.geohash6}
            onCta={() => navigate("/dashboard")}
          />
        )}

        {/* ── 상단 고정 광고 슬롯 1~3위 ── */}
        {(adData.loading || nearby.loading) && (
          <p className="loading">
            {nearby.loading
              ? `🗺️ 주변 식당 ${nearby.stores.length}건 로딩 중...`
              : "광고 슬롯 로딩 중..."}
          </p>
        )}

        {adData.pinnedAds.length > 0 && (
          <section className="pinned-ads">
            <h2 className="section-title">📌 내 주변 추천 ({adData.pinnedAds.length})</h2>
            <ul>
              {adData.pinnedAds.map((ad, idx) => (
                <SponsoredItem
                  key={ad.id}
                  ad={ad}
                  slot={idx + 1}
                  onAdClick={(id, slot) => {
                    adData.logClick(id, slot);
                    setSelected(ad);
                  }}
                />
              ))}
            </ul>
          </section>
        )}

        {/* ── 큐레이션 플레이리스트 ── */}
        {adData.playlists.length > 0 && (
          <section className="playlists">
            <h2 className="section-title">🎯 이번 주 특선</h2>
            {adData.playlists.map((pl) => (
              <PlaylistCard
                key={pl.id}
                playlist={pl}
                onRestaurantClick={(id) => adData.logClick(id)}
              />
            ))}
          </section>
        )}

        {/* ── 유저 제보 CTA ── */}
        <div className="report-cta-banner">
          <span>🙋 새 식당을 알고 계신가요?</span>
          <button className="btn-report-cta" onClick={() => navigate("/submit")}>
            직접 제보하기
          </button>
        </div>
      </main>

      {/* 식당 상세 모달 (간단 구현) */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close" onClick={() => setSelected(null)}>✕</button>
            <h2>{selected.name}</h2>
            <p>{selected.address}</p>
            <p>평균 {selected.avg_price?.toLocaleString()}원</p>
            {selected.discount_label && <p>🔥 {selected.discount_label}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 공통 네비게이션 바 ────────────────────────────────────
function NavBar({ current, onNavigate, user, onLogout }) {
  return (
    <nav className="nav-bar">
      <button
        className={current === "home" ? "active" : ""}
        onClick={() => onNavigate("/")}
      >🍱 홈</button>
      <button
        className={current === "dashboard" ? "active" : ""}
        onClick={() => onNavigate("/dashboard")}
      >📢 광고 등록</button>
      <button
        className={current === "report" ? "active" : ""}
        onClick={() => onNavigate("/report")}
      >📊 트렌드</button>
      <button
        className={current === "submit" ? "active" : ""}
        onClick={() => onNavigate("/submit")}
      >🙋 제보</button>
      {user ? (
        <button className="nav-btn-auth nav-btn-auth--out" onClick={onLogout}>
          {user.user_metadata?.nickname ?? user.email?.split("@")[0] ?? "나"} 로그아웃
        </button>
      ) : (
        <button className="nav-btn-auth" onClick={() => onNavigate("/login")}>
          로그인
        </button>
      )}
    </nav>
  );
}

// ── 결제 결과 페이지 ─────────────────────────────────────
function PaymentResult({ success }) {
  const [status, setStatus] = useState("confirming"); // confirming | done | error
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    if (!success) { setStatus("done"); return; }

    // Toss가 리다이렉트할 때 hash 뒤 쿼리스트링에 paymentKey, orderId, amount 포함
    // 예: /#/dashboard/payment-success?paymentKey=xxx&orderId=yyy&amount=5000
    const hashQuery = window.location.hash.split("?")[1] ?? "";
    const params    = new URLSearchParams(hashQuery);
    const paymentKey = params.get("paymentKey");
    const orderId    = params.get("orderId");
    const amount     = Number(params.get("amount"));

    if (!paymentKey || !orderId || !amount) {
      // 파라미터 없으면 이미 처리됐거나 직접 접근한 경우
      setStatus("done");
      return;
    }

    confirmPayment(paymentKey, orderId, amount)
      .then(() => setStatus("done"))
      .catch((e) => { setErrMsg(e.message); setStatus("error"); });
  }, [success]);

  if (status === "confirming") {
    return (
      <div className="payment-result">
        <div className="result-icon">⏳</div>
        <h2>결제 확인 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="payment-result">
        <div className="result-icon">⚠️</div>
        <h2>결제 확인 오류</h2>
        <p>{errMsg}</p>
        <button className="btn btn--primary" onClick={() => navigate("/dashboard")}>
          대시보드로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="payment-result">
      {success ? (
        <>
          <div className="result-icon">✅</div>
          <h2>결제가 완료되었습니다!</h2>
          <p>광고가 활성화되기까지 최대 10분이 소요됩니다.</p>
          <button className="btn btn--primary" onClick={() => navigate("/dashboard")}>
            대시보드로 돌아가기
          </button>
        </>
      ) : (
        <>
          <div className="result-icon">❌</div>
          <h2>결제가 취소되었습니다</h2>
          <p>다시 시도하거나 다른 결제 수단을 이용해 주세요.</p>
          <button className="btn btn--primary" onClick={() => navigate("/dashboard")}>
            다시 시도하기
          </button>
        </>
      )}
    </div>
  );
}
