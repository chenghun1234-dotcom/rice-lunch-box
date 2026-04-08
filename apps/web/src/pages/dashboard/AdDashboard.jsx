// ============================================================
// apps/web/src/pages/dashboard/AdDashboard.jsx
// 업주 셀프 서비스 대시보드
// 식당 등록 → 플랜 선택 → 결제 → 광고 활성화 원스톱
// ============================================================
import React, { useState } from "react";
import { supabase }               from "../../lib/supabase";
import { useAdvertiserAuth }      from "../../hooks/useAdvertiserAuth";
import { AD_PLANS, requestTossPayment } from "../../lib/payment";
import MyStats                    from "./MyStats";

export default function AdDashboard() {
  const { user, profile, loading, signUp, signIn, signOut, error: authError } = useAdvertiserAuth();
  const [step,         setStep]         = useState("auth");   // auth | register | plan | done
  const [authMode,     setAuthMode]     = useState("login");  // login | signup
  const [form,         setForm]         = useState({ email: "", password: "", businessName: "" });
  const [restaurant,   setRestaurant]   = useState(null);
  const [restForm,     setRestForm]     = useState({
    name: "", category: "", address: "", avg_price: "", phone: "", image_url: "",
  });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [paying,       setPaying]       = useState(false);
  const [formError,    setFormError]    = useState(null);

  // ── 로딩 ─────────────────────────────────────────────────
  if (loading) return <div className="loading">불러오는 중...</div>;

  // ── 인증 전 화면 ─────────────────────────────────────────
  if (!user) {
    return (
      <div className="auth-page">
        <h1>🍱 사장님, 환영합니다</h1>
        <p className="auth-subtitle">
          내 가게 주변 가성비 고객에게 1순위로 노출되세요.
        </p>

        <div className="auth-tabs">
          <button
            className={authMode === "login" ? "active" : ""}
            onClick={() => setAuthMode("login")}
          >로그인</button>
          <button
            className={authMode === "signup" ? "active" : ""}
            onClick={() => setAuthMode("signup")}
          >회원가입</button>
        </div>

        {authError && <p className="error">{authError}</p>}

        <form className="auth-form" onSubmit={async (e) => {
          e.preventDefault();
          setFormError(null);
          try {
            if (authMode === "login") {
              await signIn(form.email, form.password);
            } else {
              await signUp(form.email, form.password, form.businessName);
            }
          } catch (err) {
            setFormError(err.message);
          }
        }}>
          {authMode === "signup" && (
            <input
              placeholder="상호명 (예: 역삼 순대국밥)"
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              required
            />
          )}
          <input
            type="email"
            placeholder="이메일"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={6}
          />
          {formError && <p className="error">{formError}</p>}
          <button type="submit" className="btn btn--primary">
            {authMode === "login" ? "로그인" : "가입 후 광고 등록 →"}
          </button>
        </form>
      </div>
    );
  }

  // ── 내 광고 성과 (이미 광고 등록된 경우) ─────────────────
  const myRestaurants = profile?.advertiser_restaurants ?? [];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>📊 사장님 대시보드</h1>
        <div className="dashboard-header__right">
          <span>{profile?.business_name ?? user.email}</span>
          <button className="btn btn--ghost" onClick={signOut}>로그아웃</button>
        </div>
      </header>

      {/* ── STEP 1: 식당 정보 등록 ── */}
      <section className="dashboard-section">
        <h2>① 식당 정보 등록</h2>
        {myRestaurants.length > 0 ? (
          <ul className="restaurant-list">
            {myRestaurants.map(({ restaurants: r }) => (
              <li
                key={r.id}
                className={`restaurant-item ${restaurant?.id === r.id ? "selected" : ""}`}
                onClick={() => setRestaurant(r)}
              >
                <strong>{r.name}</strong>
                <span>{r.address}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <form className="rest-form" onSubmit={async (e) => {
          e.preventDefault();
          setFormError(null);
          try {
            // 식당 주소 → 카카오 지오코딩 API로 좌표 변환
            const coords = await geocodeAddress(restForm.address);
            const { data, error } = await supabase.from("restaurants").insert({
              ...restForm,
              avg_price: Number(restForm.avg_price) || null,
              location:  `SRID=4326;POINT(${coords.lng} ${coords.lat})`,
              geohash6:  coords.geohash6,
              source:    "manual",
            }).select().single();
            if (error) throw error;

            // 업주 ↔ 식당 연결
            await supabase.from("advertiser_restaurants").insert({
              advertiser_id: user.id,
              restaurant_id: data.id,
            });
            setRestaurant(data);
            setStep("plan");
          } catch (err) {
            setFormError(err.message);
          }
        }}>
          <input placeholder="식당 이름" value={restForm.name}
            onChange={(e) => setRestForm({ ...restForm, name: e.target.value })} required />
          <input placeholder="카테고리 (한식, 중식 등)" value={restForm.category}
            onChange={(e) => setRestForm({ ...restForm, category: e.target.value })} />
          <input placeholder="주소 (예: 서울 강남구 역삼동 123-4)" value={restForm.address}
            onChange={(e) => setRestForm({ ...restForm, address: e.target.value })} required />
          <input type="number" placeholder="평균 가격 (원)" value={restForm.avg_price}
            onChange={(e) => setRestForm({ ...restForm, avg_price: e.target.value })} />
          <input placeholder="전화번호" value={restForm.phone}
            onChange={(e) => setRestForm({ ...restForm, phone: e.target.value })} />
          <input placeholder="대표 사진 URL (직접 링크)" value={restForm.image_url}
            onChange={(e) => setRestForm({ ...restForm, image_url: e.target.value })} />
          {formError && <p className="error">{formError}</p>}
          <button type="submit" className="btn btn--primary">식당 등록 →</button>
        </form>
      </section>

      {/* ── STEP 2: 플랜 선택 ── */}
      {restaurant && (
        <section className="dashboard-section">
          <h2>② 광고 플랜 선택</h2>
          <p className="section-hint">
            선택한 식당: <strong>{restaurant.name}</strong>
          </p>
          <div className="plan-grid">
            {AD_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`plan-card ${plan.highlight ? "featured" : ""} ${selectedPlan?.id === plan.id ? "selected" : ""}`}
                onClick={() => setSelectedPlan(plan)}
              >
                <span className="plan-badge">{plan.badge}</span>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <div className="plan-price">
                  <strong>{plan.price.toLocaleString()}원</strong>
                  <span>/{plan.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {selectedPlan && (
            <button
              className="btn btn--primary btn--full"
              disabled={paying}
              onClick={async () => {
                setPaying(true);
                try {
                  await requestTossPayment({
                    plan:           selectedPlan,
                    restaurantId:   restaurant.id,
                    advertiserId:   user.id,
                    restaurantName: restaurant.name,
                  });
                } catch (err) {
                  setFormError(err.message);
                  setPaying(false);
                }
              }}
            >
              {paying ? "결제창 이동 중..." : `${selectedPlan.name} 결제하기 (${selectedPlan.price.toLocaleString()}원)`}
            </button>
          )}
        </section>
      )}

      {/* ── STEP 3: 광고 성과 (내 식당이 있을 때) ── */}
      {myRestaurants.length > 0 && (
        <section className="dashboard-section">
          <h2>③ 광고 성과</h2>
          <MyStats advertiserId={user.id} />
        </section>
      )}
    </div>
  );
}

// ── 카카오 REST API 지오코딩 ─────────────────────────────
async function geocodeAddress(address) {
  const kakaoKey = import.meta.env.VITE_KAKAO_REST_KEY;
  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
    { headers: { Authorization: `KakaoAK ${kakaoKey}` } }
  );
  const data = await res.json();
  const doc  = data.documents?.[0];
  if (!doc) throw new Error("주소를 찾을 수 없습니다. 정확한 주소를 입력하세요.");

  const lat = parseFloat(doc.y);
  const lng = parseFloat(doc.x);

  // geohash6 계산
  const { encodeGeohash } = await import("../../lib/geohash");
  return { lat, lng, geohash6: encodeGeohash(lat, lng, 6) };
}
