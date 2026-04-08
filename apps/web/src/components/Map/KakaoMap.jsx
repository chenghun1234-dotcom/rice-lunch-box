// ============================================================
// apps/web/src/components/Map/KakaoMap.jsx
// 카카오맵 컴포넌트 v2
//   - 내 위치 파란 원 마커 + "◎ 내 위치로" 버튼
//   - 지도 이동/줌 완료 시 onBoundsChange(bounds) 콜백
//   - 광고 식당: 별 아이콘 / 일반: 기본 핀 + 말풍선
// ============================================================
import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";

const KAKAO_MAP_KEY = (import.meta.env.VITE_KAKAO_MAP_KEY || "").trim();

/**
 * @param {{
 *   lat: number,
 *   lng: number,
 *   restaurants: Array<{id, name, lat, lng, avg_price, is_ad?}>,
 *   onMarkerClick: (restaurant) => void,
 *   onBoundsChange?: (bounds: {swLat,swLng,neLat,neLng}) => void
 * }} props
 * @param ref - forwardRef: ref.current.panToStore(restaurant) 로 외부에서 지도 이동 가능
 */
const KakaoMap = forwardRef(function KakaoMap(
  { lat, lng, restaurants = [], onMarkerClick, onBoundsChange },
  ref
) {
  const mapRef      = useRef(null);
  const mapInstance = useRef(null);
  const markersRef  = useRef([]);
  const iwMapRef    = useRef(new Map()); // id → InfoWindow 인스턴스
  const myOverlayRef = useRef(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [locating, setLocating]   = useState(false);
  const [sdkError, setSdkError]   = useState(null);

  // ── 외부에서 호출 가능: mapRef.current.panToStore(restaurant) ───────────────
  useImperativeHandle(ref, () => ({
    panToStore(r) {
      if (!mapInstance.current || !r.lat || !r.lng) return;
      const { maps } = window.kakao;
      const pos = new maps.LatLng(r.lat, r.lng);
      mapInstance.current.panTo(pos);
      // 해당 식당 인포윈도우 열기
      const existingIw = iwMapRef.current.get(r.id ?? r.name);
      if (existingIw) {
        // 기존 열린 인포윈도우 닫기
        iwMapRef.current.forEach((iw) => iw.close());
        // panTo 애니메이션 후 열기
        setTimeout(() => {
          const marker = markersRef.current.find(
            (m) => m.__restaurantId === (r.id ?? r.name)
          );
          if (marker) existingIw.open(mapInstance.current, marker);
        }, 350);
      }
    },
  }));

  // ── SDK 동적 로드 (최초 1회) ──────────────────────────────
  useEffect(() => {
    if (!KAKAO_MAP_KEY) {
      setSdkError("VITE_KAKAO_MAP_KEY가 비어 있습니다.");
      return;
    }

    let cancelled = false;

    const startMaps = () => {
      if (!cancelled) {
        setSdkLoaded(true);
        setSdkError(null);
      }
    };

    const doLoad = () => {
      if (cancelled) return;
      if (!window.kakao?.maps) {
        setSdkError(
          `kakao.maps 객체가 없습니다. API 키 또는 도메인(${window.location.origin}) 등록을 확인하세요.`
        );
        return;
      }
      // maps.Map 이 이미 있으면 완전 초기화 완료
      if (window.kakao.maps.Map) {
        startMaps();
      } else {
        // autoload=false → load() 명시 호출
        window.kakao.maps.load(startMaps);
      }
    };

    // HMR 재마운트 등 SDK 이미 준비된 경우
    if (window.kakao?.maps) {
      doLoad();
      return () => { cancelled = true; };
    }

    const script = document.getElementById("kakao-maps-sdk")
      || document.querySelector('script[src*="dapi.kakao.com/v2/maps/sdk.js"]');

    if (!script) {
      setSdkError("index.html의 kakao SDK script 태그를 찾지 못했습니다.");
      return () => {
        cancelled = true;
      };
    }

    const handleLoad = () => doLoad();
    const handleError = () => {
      if (!cancelled) {
        const src = script.getAttribute("src") || "(unknown)";
        setSdkError(`SDK 스크립트 로드 실패. src=${src} / origin=${window.location.origin}`);
      }
    };
    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    const poll = setInterval(() => {
      if (window.kakao?.maps) {
        clearInterval(poll);
        doLoad();
      }
    }, 250);

    const timer = setTimeout(() => {
      clearInterval(poll);
      if (!window.kakao?.maps && !cancelled) {
        const src = script.getAttribute("src") || "(unknown)";
        setSdkError(`SDK 초기화 타임아웃. src=${src} / origin=${window.location.origin}`);
      }
    }, 12000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(timer);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, []);

  // ── 지도 초기화 ───────────────────────────────────────────
  useEffect(() => {
    if (!sdkLoaded || !mapRef.current) return;
    const { maps } = window.kakao;
    const center   = new maps.LatLng(lat, lng);

    if (!mapInstance.current) {
      mapInstance.current = new maps.Map(mapRef.current, { center, level: 4 });
      mapInstance.current.addControl(
        new maps.ZoomControl(),
        maps.ControlPosition.RIGHT
      );

      // 지도 이동/줌 완료 → bounds 콜백
      const fireBounds = () => {
        if (!onBoundsChange) return;
        const b = mapInstance.current.getBounds();
        onBoundsChange({
          swLat: b.getSouthWest().getLat(),
          swLng: b.getSouthWest().getLng(),
          neLat: b.getNorthEast().getLat(),
          neLng: b.getNorthEast().getLng(),
        });
      };
      maps.event.addListener(mapInstance.current, "dragend",      fireBounds);
      maps.event.addListener(mapInstance.current, "zoom_changed", fireBounds);
      setTimeout(() => {
        mapInstance.current?.relayout();
        mapInstance.current?.setCenter(center);
      }, 80);
      setTimeout(fireBounds, 400); // 초기 bounds 전달
    } else {
      mapInstance.current.relayout();
      mapInstance.current.setCenter(center);
    }
  }, [sdkLoaded, lat, lng]); // eslint-disable-line

  // ── 내 위치 마커 (파란 원 오버레이) ──────────────────────
  useEffect(() => {
    if (!sdkLoaded || !mapInstance.current) return;
    const { maps } = window.kakao;
    if (myOverlayRef.current) myOverlayRef.current.setMap(null);
    myOverlayRef.current = new maps.CustomOverlay({
      map:      mapInstance.current,
      position: new maps.LatLng(lat, lng),
      content:  `<div style="width:18px;height:18px;border-radius:50%;
                   background:#4A90E2;border:3px solid #fff;
                   box-shadow:0 0 0 4px rgba(74,144,226,.3)"></div>`,
      zIndex:   10,
    });
  }, [sdkLoaded, lat, lng]);

  // ── 식당 마커 동기화 ──────────────────────────────────────
  useEffect(() => {
    if (!sdkLoaded || !mapInstance.current) return;
    const { maps } = window.kakao;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    iwMapRef.current.clear();

    restaurants.forEach((r) => {
      if (!r.lat || !r.lng) return;

      const markerOpts = {
        map:      mapInstance.current,
        position: new maps.LatLng(r.lat, r.lng),
        title:    r.name,
      };
      if (r.is_ad) {
        markerOpts.image = new maps.MarkerImage(
          "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png",
          new maps.Size(24, 35)
        );
      }

      const marker = new maps.Marker(markerOpts);
      marker.__restaurantId = r.id ?? r.name; // panToStore 연결용

      const iw = new maps.InfoWindow({
        content: `<div style="padding:8px 10px;min-width:110px;font-size:13px;font-family:sans-serif;line-height:1.5">
          <strong>${r.name}</strong><br>
          <span style="color:#e94560;font-weight:700">${r.avg_price ? r.avg_price.toLocaleString() + "원" : (r.price_range ?? "")}</span>
          ${r.main_menu ? `<br><small style="color:#666">${r.main_menu}</small>` : ""}
        </div>`,
        removable: true,
      });

      iwMapRef.current.set(r.id ?? r.name, iw); // id로 인포윈도우 검색 가능

      maps.event.addListener(marker, "click", () => {
        iwMapRef.current.forEach((w) => w.close()); // 기존 인포윈도우 전부 닫기
        iw.open(mapInstance.current, marker);
        onMarkerClick(r);
      });
      markersRef.current.push(marker);
    });
  }, [sdkLoaded, restaurants, onMarkerClick]);

  // ── 내 위치로 이동 ────────────────────────────────────────
  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapInstance.current?.setCenter(
          new window.kakao.maps.LatLng(coords.latitude, coords.longitude)
        );
        mapInstance.current?.setLevel(4);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  if (!KAKAO_MAP_KEY) {
    return (
      <div className="map-error">⚠ VITE_KAKAO_MAP_KEY 환경변수를 설정하세요.</div>
    );
  }

  if (sdkError && !sdkLoaded) {
    return (
      <div className="map-error">⚠ {sdkError}</div>
    );
  }

  return (
    <div className="kakao-map-wrap">
      <div
        ref={mapRef}
        className="kakao-map"
        aria-label="주변 가성비 식당 지도"
      />
      <button
        className={`map-myloc-btn${locating ? " map-myloc-btn--spin" : ""}`}
        onClick={handleMyLocation}
        aria-label="내 위치로 이동"
        title="내 위치로"
      >
        {locating ? "⟳" : "◎"}
      </button>
    </div>
  );
});

export default KakaoMap;
