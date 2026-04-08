// ============================================================
// apps/web/src/pages/auth/LoginPage.jsx
// 로그인 페이지 — Supabase Email/Password Auth
// URL: /#/login
// ============================================================
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  // 이미 로그인된 상태면 홈으로
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.hash = "/";
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      const m = authError.message;
      const msg =
        m.includes("Invalid login credentials") ? "이메일 또는 비밀번호가 올바르지 않습니다." :
        m.includes("Email not confirmed")        ? "이메일 인증을 완료해주세요. 메일실을 확인해주세요." :
        m.includes("is invalid")                ? "Supabase 대시보드 → Authentication → Providers → Email을 활성화해주세요." :
        m.includes("rate limit")                ? "잠시 후 다시 시도해주세요." :
        m;
      setError(msg);
      setLoading(false);
    } else {
      window.location.hash = "/";
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🍱</div>
        <h1 className="auth-title">도시락탈출 로그인</h1>
        <p className="auth-sub">맛집 제보 · 찜하기 · 알림 등 더 많은 기능을 이용하세요</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label">이메일</label>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="example@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">비밀번호</label>
            <input
              className="auth-input"
              type="password"
              autoComplete="current-password"
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          {error && <p className="auth-error">⚠ {error}</p>}

          <button
            type="submit"
            className={`auth-btn auth-btn--primary ${loading ? "auth-btn--loading" : ""}`}
            disabled={loading}
          >
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <div className="auth-links">
          <span>계정이 없으신가요?</span>
          <a href="/#/signup" className="auth-link">회원가입</a>
        </div>
        <div className="auth-links">
          <a href="/#/" className="auth-link auth-link--muted">← 홈으로 돌아가기</a>
        </div>
      </div>
    </main>
  );
}
