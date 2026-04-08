// ============================================================
// apps/web/src/hooks/useNearbyStores.js
// 내 위치 기반 일반 식당 검색 훅
// Supabase RPC get_nearby_stores 직접 호출 (CF Worker 불필요)
// ============================================================
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const RADIUS_KM   = Number(import.meta.env.VITE_NEARBY_RADIUS_KM   ?? 2.0);
const MAX_STORES  = Number(import.meta.env.VITE_NEARBY_MAX_STORES   ?? 100);

/**
 * 내 위치 기반 반경 내 일반 식당 목록
 * @param {{ lat: number|null, lng: number|null }} position
 * @returns {{
 *   stores:  Array<{id, name, category, address, avg_price, price_range,
 *                   main_menu, lat, lng, distance_m}>,
 *   loading: boolean,
 *   error:   string|null,
 *   refetch: () => void
 * }}
 */
export function useNearbyStores({ lat, lng }) {
  const [stores,  setStores]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const prevKey = useRef(null);

  const fetch = async (userLat, userLng) => {
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("get_nearby_stores", {
      user_lat:  userLat,
      user_lng:  userLng,
      radius_km: RADIUS_KM,
      max_count: MAX_STORES,
    });

    setLoading(false);

    if (rpcError) {
      console.error("[useNearbyStores] RPC 오류:", rpcError.message);
      setError(rpcError.message);
      return;
    }
    setStores(data ?? []);
  };

  useEffect(() => {
    if (!lat || !lng) return;

    // 위치 변화가 ~200m 이상일 때만 재조회 (소수점 3자리 기준)
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (prevKey.current === key) return;
    prevKey.current = key;

    fetch(lat, lng);
  }, [lat, lng]);

  const refetch = () => {
    if (lat && lng) fetch(lat, lng);
  };

  return { stores, loading, error, refetch };
}
