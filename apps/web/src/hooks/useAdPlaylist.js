// ============================================================
// apps/web/src/hooks/useAdPlaylist.js
// 위치 기반 광고 플레이리스트 취득 훅
// CF Worker 있으면 → KV 캐시 경유
// CF Worker 없으면 → Supabase RPC 직접 호출 (개발/폴백 모드)
// ============================================================
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const CF_WORKER_URL = import.meta.env.VITE_CF_WORKER_URL ?? "";
const AD_RADIUS     = Number(import.meta.env.VITE_AD_RADIUS_METERS ?? 1000);
const PINNED_SLOTS  = Number(import.meta.env.VITE_PINNED_AD_SLOTS ?? 3);
const LUNCH_START   = Number(import.meta.env.VITE_LUNCH_START_HOUR ?? 11);
const LUNCH_END     = Number(import.meta.env.VITE_LUNCH_END_HOUR ?? 13);

/**
 * @param {{ lat: number, lng: number, geohash6: string }} location
 * @returns {{
 *   pinnedAds:  Array,   // 상단 고정 1~3위
 *   isLunchTime: boolean,
 *   playlists:  Array,   // 큐레이션 테마 목록
 *   loading:    boolean,
 *   error:      string|null,
 *   logClick:   (restaurantId, slot) => void
 * }}
 */
export function useAdPlaylist({ lat, lng, geohash6 }) {
  const [pinnedAds,  setPinnedAds]  = useState([]);
  const [playlists,  setPlaylists]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const prevGh6 = useRef(null);

  // 점심 타임세일 여부 (KST 기준)
  const nowHour    = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", hour: "numeric", hour12: false,
  });
  const isLunchTime = Number(nowHour) >= LUNCH_START && Number(nowHour) < LUNCH_END;

  useEffect(() => {
    if (!lat || !lng) return;
    // geohash 변경 시만 재요청 (동 단위 이동 시에만 API 호출)
    if (prevGh6.current === geohash6) return;
    prevGh6.current = geohash6;

    setLoading(true);
    setError(null);

    Promise.all([
      fetchNearbyAds(lat, lng, geohash6),
      fetchPlaylists(),
    ])
      .then(([ads, lists]) => {
        setPinnedAds(ads);
        setPlaylists(lists);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [lat, lng, geohash6]);

  // 클릭 이벤트 전송 (fire-and-forget)
  const logClick = (restaurantId, slot = null) => {
    if (!CF_WORKER_URL) return;
    fetch(`${CF_WORKER_URL}/api/log-click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant_id: restaurantId, ad_slot: slot, lat, lng, geohash6 }),
    }).catch(() => {}); // 실패해도 UX에 영향 없음
  };

  return { pinnedAds, isLunchTime, playlists, loading, error, logClick };
}

// ── 내부 함수 ─────────────────────────────────────────────
async function fetchNearbyAds(lat, lng, geohash6) {
  // CF Worker가 설정되어 있으면 우선 사용
  if (CF_WORKER_URL) {
    const res = await fetch(`${CF_WORKER_URL}/api/nearby-ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-geohash6": geohash6 },
      body: JSON.stringify({ lat, lng, radius: AD_RADIUS, slots: PINNED_SLOTS }),
    });
    if (!res.ok) throw new Error("광고 데이터를 가져오지 못했습니다.");
    const json = await res.json();
    return json.ads ?? [];
  }

  // CF Worker 없으면 Supabase RPC 직접 호출 (개발 / 폴백)
  const { data, error } = await supabase.rpc("nearby_ad_restaurants", {
    user_lat:   lat,
    user_lng:   lng,
    radius_m:   AD_RADIUS,
    slot_limit: PINNED_SLOTS,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchPlaylists() {
  if (CF_WORKER_URL) {
    const res = await fetch(`${CF_WORKER_URL}/api/playlists`);
    if (!res.ok) return [];
    return res.json();
  }

  // CF Worker 없으면 Supabase에서 직접 조회
  const { data, error } = await supabase
    .from("playlists")
    .select("id, slug, title, description, theme_tag, sort_order")
    .order("sort_order", { ascending: true })
    .limit(10);

  if (error) return [];

  // UI 호환을 위해 theme 필드로 매핑
  return (data ?? []).map((p) => ({
    ...p,
    theme: p.theme_tag ?? null,
    restaurant_ids: [],
  }));
}
