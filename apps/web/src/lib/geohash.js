// ============================================================
// apps/web/src/lib/geohash.js
// 클라이언트 사이드 Geohash 인코딩 (라이브러리 의존성 0)
// ============================================================

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * 위도/경도를 geohash 문자열로 변환
 * @param {number} lat - 위도 (예: 37.5665)
 * @param {number} lng - 경도 (예: 126.9780)
 * @param {number} precision - 자릿수 (6 = 동 단위, 약 1.2km × 0.6km)
 * @returns {string}
 */
export function encodeGeohash(lat, lng, precision = 6) {
  let idx = 0, bit = 0, evenBit = true;
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  let hash = "";

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lngMin = mid; }
      else             { idx = idx * 2;     lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; }
      else            { idx = idx * 2;     latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

/**
 * 이웃한 geohash 8개 반환 (광고 경계 지역 대응)
 * @param {string} hash
 * @returns {string[]}
 */
export function getNeighbors(hash) {
  // 간단 구현: 중심 + N/S/E/W/NE/NW/SE/SW
  const { lat, lng } = decodeGeohash(hash);
  const delta = 0.008; // 약 1km
  return [
    encodeGeohash(lat + delta, lng, 6),
    encodeGeohash(lat - delta, lng, 6),
    encodeGeohash(lat, lng + delta, 6),
    encodeGeohash(lat, lng - delta, 6),
  ].filter((h, i, arr) => arr.indexOf(h) === i && h !== hash);
}

/**
 * geohash를 중심 좌표로 디코딩
 * @param {string} hash
 * @returns {{ lat: number, lng: number }}
 */
export function decodeGeohash(hash) {
  let evenBit = true;
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    for (let bits = 4; bits >= 0; bits--) {
      const bitN = (idx >> bits) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        bitN === 1 ? (lngMin = mid) : (lngMax = mid);
      } else {
        const mid = (latMin + latMax) / 2;
        bitN === 1 ? (latMin = mid) : (latMax = mid);
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
}
