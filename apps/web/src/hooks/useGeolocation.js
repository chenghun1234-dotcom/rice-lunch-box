// ============================================================
// apps/web/src/hooks/useGeolocation.js
// 브라우저 GPS 위치 취득 훅
// ============================================================
import { useState, useEffect, useRef } from "react";
import { encodeGeohash } from "../lib/geohash";

const DEFAULT_LOCATION = {
  lat: 37.5665,    // 서울 시청 (GPS 거부 시 기본값)
  lng: 126.9780,
  geohash6: "wydm6h",
};

/**
 * @returns {{
 *   lat: number,
 *   lng: number,
 *   geohash6: string,
 *   accuracy: number|null,
 *   loading: boolean,
 *   error: string|null
 * }}
 */
export function useGeolocation() {
  const [state, setState] = useState({
    ...DEFAULT_LOCATION,
    accuracy: null,
    loading: true,
    error: null,
  });
  const watchId = useRef(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "이 브라우저는 위치 정보를 지원하지 않습니다.",
      }));
      return;
    }

    const onSuccess = ({ coords }) => {
      const { latitude: lat, longitude: lng, accuracy } = coords;
      setState({
        lat,
        lng,
        geohash6: encodeGeohash(lat, lng, 6),
        accuracy,
        loading: false,
        error: null,
      });
    };

    const onError = (err) => {
      setState((s) => ({
        ...s,
        loading: false,
        error: err.code === 1 ? "위치 권한이 거부되었습니다." : "위치를 가져오는 중 오류가 발생했습니다.",
      }));
    };

    const options = {
      enableHighAccuracy: false, // 배터리 절약 (지도 서비스 수준으로 충분)
      timeout: 8000,
      maximumAge: 30000,         // 30초 내 캐시 허용 (API 절약)
    };

    // 최초 1회 고속 취득
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);

    // 이동 감지 (60초마다 업데이트)
    watchId.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      ...options,
      maximumAge: 60000,
    });

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  return state;
}
