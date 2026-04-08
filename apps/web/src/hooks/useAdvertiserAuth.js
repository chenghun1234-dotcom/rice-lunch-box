// ============================================================
// apps/web/src/hooks/useAdvertiserAuth.js
// 업주 인증 훅 (Supabase Auth 이메일/패스워드)
// ============================================================
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

/**
 * @returns {{
 *   user: object|null,
 *   profile: object|null,
 *   loading: boolean,
 *   signUp: (email, password, businessName) => Promise,
 *   signIn: (email, password) => Promise,
 *   signOut: () => Promise,
 *   error: string|null
 * }}
 */
export function useAdvertiserAuth() {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    // 현재 세션 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setLoading(false);
    });

    // 인증 상태 변화 구독
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) await loadProfile(session.user.id);
        else { setProfile(null); setLoading(false); }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from("advertiser_profiles")
      .select("*, advertiser_restaurants(restaurant_id, restaurants(*))")
      .eq("id", userId)
      .single();
    setProfile(data);
    setLoading(false);
  }

  async function signUp(email, password, businessName) {
    setError(null);
    const { data, error: authError } = await supabase.auth.signUp({
      email, password,
      options: { data: { business_name: businessName } },
    });
    if (authError) {
      const m = authError.message;
      const msg =
        m.includes("signups not allowed") || m.includes("Signups not allowed") || m.includes("disabled")
          ? "회원가입이 비활성화되어 있습니다.\n→ Supabase 대시보드 → Authentication → Providers → Email → 'Enable Email Signup' 을 ON 으로 설정해주세요."
        : m.includes("already registered") || m.includes("already been registered")
          ? "이미 사용 중인 이메일입니다. 로그인을 이용해 주세요."
        : m.includes("rate limit") || m.includes("over_email_send_rate_limit")
          ? "잠시 후 다시 시도해주세요. (이메일 발송 한도 초과)"
        : m;
      const mapped = new Error(msg);
      setError(msg);
      throw mapped;
    }

    // 프로필 생성
    await supabase.from("advertiser_profiles").insert({
      id: data.user?.id,
      business_name: businessName,
    });
    return data;
  }

  async function signIn(email, password) {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email, password,
    });
    if (authError) { setError(authError.message); throw authError; }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  return { user, profile, loading, signUp, signIn, signOut, error };
}
