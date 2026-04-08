// ============================================================
// apps/web/src/pages/auth/SignupPage.jsx
// 회원가입 페이지 — Supabase Email/Password Auth
// URL: /#/signup
// ============================================================
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

export default function SignupPage() {
  const [nickname, setNickname] = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [done,     setDone]     = useState(false);

  // 이미 로그인된 상태면 홈으로
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.hash = "/";
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setLoading(true);
    const { data: signUpData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname },
        emailRedirectTo: window.location.origin + "/#/",
      },
    });

    if (authError) {
      const m = authError.message;
      const msg =
        m.includes("already registered")      ? "이미 사용 중인 이메일입니다. 로그인 페이지를 이용해 주세요." :
        m.includes("is invalid")              ? "Supabase 대시보드 → Authentication → Email → Confirm email 을 OFF 해주세요." :
        m.includes("Signups not allowed")     ? "Supabase 대시보드에서 회원가입이 비활성화되어 있습니다." :
        (m.includes("rate limit") || m.includes("Rate limit") || m.includes("only request this once") || m.includes("over_email_send_rate_limit"))
          ? "📧 이메일 발송 횟수 초과입니다.\n→ Supabase 대시보드 → Authentication → Providers → Email → 'Confirm email' 을 OFF 로 설정하면 이메일 발송 없이 바로 가입됩니다." :
        m;
      setError(msg);
      setLoading(false);
    } else if (signUpData?.session) {
      // 이메일 인증 OFF → 즉시 세션 발급 → 바로 홈으로
      window.location.hash = "/";
    } else {
      // 이메일 인증 ON → 메일 확인 안내
      setDone(true);
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="auth-page">
        <div className="auth-card auth-card--success">
          <div className="auth-logo">✉️</div>
          <h1 className="auth-title">이메일을 확인하세요</h1>
          <p className="auth-sub">
            <strong>{email}</strong>로 인증 메일을 보냈습니다.<br />
            메일의 링크를 클릭하면 가입이 완료됩니다.
          </p>
          <a href="/#/login" className="auth-btn auth-btn--primary" style={{ textDecoration: "none", display: "block", textAlign: "center" }}>
            로그인 페이지로
          </a>
          <div className="auth-links" style={{ marginTop: 16 }}>
            <a href="/#/" className="auth-link auth-link--muted">← 홈으로 돌아가기</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🍱</div>
        <h1 className="auth-title">회원가입</h1>
        <p className="auth-sub">무료로 가입하고 더 많은 기능을 이용하세요</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label">닉네임</label>
            <input
              className="auth-input"
              type="text"
              placeholder="예) 밥순이"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              disabled={loading}
              minLength={2}
              maxLength={20}
            />
          </div>
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
            <label className="auth-label">비밀번호 (6자 이상)</label>
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={6}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">비밀번호 확인</label>
            <input
              className={`auth-input ${confirm && confirm !== password ? "auth-input--error" : ""}`}
              type="password"
              autoComplete="new-password"
              placeholder="비밀번호 재입력"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={loading}
            />
            {confirm && confirm !== password && (
              <span className="auth-input-hint auth-input-hint--error">비밀번호가 일치하지 않습니다</span>
            )}
          </div>

          {error && <p className="auth-error">⚠ {error}</p>}

          <button
            type="submit"
            className={`auth-btn auth-btn--primary ${loading ? "auth-btn--loading" : ""}`}
            disabled={loading || (confirm && confirm !== password)}
          >
            {loading ? "가입 중…" : "가입하기"}
          </button>
        </form>

        <div className="auth-links">
          <span>이미 계정이 있으신가요?</span>
          <a href="/#/login" className="auth-link">로그인</a>
        </div>
        <div className="auth-links">
          <a href="/#/" className="auth-link auth-link--muted">← 홈으로 돌아가기</a>
        </div>
      </div>
    </main>
  );
}
