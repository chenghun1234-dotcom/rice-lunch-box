/**
 * ReportPage.jsx — apps/web/src/pages/submit/ReportPage.jsx
 *
 * 유저 제보 페이지 (크라우드소싱)
 * URL: /#/submit
 * URL: /#/submit?area={area_name}  ← 지역 SEO 페이지에서 진입 시
 *
 * 기능:
 *  - 신규 장소 제보 / 잘못된 정보 수정 / 메뉴판 사진 등록 / 새 메뉴 제보
 *  - 사진: R2 presigned URL 업로드 (Supabase Edge Function 경유)
 *  - 주소 자동완성: Kakao REST API
 *  - Supabase user_reports 테이블에 INSERT (anon 허용 — RLS 정책)
 */
import { useState, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";

// ── Kakao address search ───────────────────────────────────────────────────────
async function searchAddress(query) {
  const key = import.meta.env.VITE_KAKAO_REST_KEY;
  if (!key) return [];
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=5`;
  const resp = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.documents ?? []).map((d) => ({
    address: d.address_name,
    road: d.road_address?.address_name ?? d.address_name,
    lat: parseFloat(d.y),
    lng: parseFloat(d.x),
  }));
}

// ── Photo upload via Edge Function ────────────────────────────────────────────
async function uploadPhoto(file) {
  // 1. Request presigned URL from Edge Function
  const resp = await supabase.functions.invoke("upload-report-photo", {
    body: {
      filename: file.name,
      content_type: file.type,
      size: file.size,
    },
  });
  // Edge Function 미배포 시 graceful skip (사진 없이 제보 가능)
  if (resp.error) {
    console.warn("upload-report-photo Edge Function 미배포 — 사진 스킵:", resp.error.message);
    return null;
  }
  const { upload_url, public_url } = resp.data ?? {};
  if (!upload_url) return null;

  // 2. PUT to R2 presigned URL
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("업로드 실패");
  return public_url;
}

// ── Report types ─────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { id: "new_place", label: "🆕 새 식당 등록", desc: "아직 등록 안 된 식당을 알려주세요" },
  { id: "new_menu", label: "🍽️ 메뉴 / 가격 제보", desc: "신메뉴나 가격 변경을 알려주세요" },
  { id: "photo", label: "📸 사진 등록", desc: "매장 사진이나 메뉴판을 공유해 주세요" },
  { id: "wrong_info", label: "✏️ 잘못된 정보 수정", desc: "주소·영업시간 오류를 제보해 주세요" },
];

// ── AddressInput with autocomplete ───────────────────────────────────────────
function AddressInput({ value, onChange, onSelectCoord }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const debounceRef = useRef(null);

  const handleChange = useCallback(
    (e) => {
      const v = e.target.value;
      onChange(v);
      clearTimeout(debounceRef.current);
      if (v.length < 2) { setSuggestions([]); return; }
      debounceRef.current = setTimeout(async () => {
        const results = await searchAddress(v);
        setSuggestions(results);
        setShowSug(true);
      }, 400);
    },
    [onChange]
  );

  return (
    <div className="address-input-wrap">
      <input
        className="form-input"
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setShowSug(false), 200)}
        placeholder="도로명 주소 또는 지번 주소"
      />
      {showSug && suggestions.length > 0 && (
        <ul className="address-suggest">
          {suggestions.map((s) => (
            <li
              key={s.address}
              onMouseDown={() => {
                onChange(s.road);
                onSelectCoord({ lat: s.lat, lng: s.lng });
                setShowSug(false);
              }}
            >
              <span className="suggest-road">{s.road}</span>
              <span className="suggest-jibun">{s.address}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Photo dropzone ─────────────────────────────────────────────────────────────
function PhotoDropzone({ photos, onAdd, onRemove, uploading }) {
  const inputRef = useRef(null);

  function handleFiles(files) {
    const valid = Array.from(files).filter((f) => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > 10 * 1024 * 1024) { alert("10MB 이하 이미지만 첨부 가능합니다."); return false; }
      return true;
    });
    onAdd(valid);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={`photo-dropzone ${uploading ? "photo-dropzone--uploading" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {photos.length === 0 ? (
        <div className="dropzone-placeholder">
          <span className="dropzone-icon">📷</span>
          <p>사진을 끌어다 놓거나 클릭하여 추가</p>
          <small>최대 5장, 각 10MB 이하 (jpg/png/webp)</small>
        </div>
      ) : (
        <div className="photo-preview-grid">
          {photos.map((p, i) => (
            <div key={i} className="photo-thumb">
              <img src={p.preview} alt={`첨부 ${i + 1}`} />
              <button
                type="button"
                className="photo-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(i); }}
              >
                ✕
              </button>
              {p.uploading && <div className="photo-uploading-overlay">업로드 중…</div>}
            </div>
          ))}
          {photos.length < 5 && !uploading && (
            <div className="photo-thumb photo-thumb--add">
              <span>+ 추가</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MenuItemsEditor ───────────────────────────────────────────────────────────
function MenuItemsEditor({ items, onChange }) {
  function addItem() {
    onChange([...items, { name: "", price: "" }]);
  }
  function removeItem(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function updateItem(i, field, value) {
    const next = [...items];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  }

  return (
    <div className="menu-items-editor">
      {items.map((item, i) => (
        <div key={i} className="menu-item-row">
          <input
            className="form-input"
            placeholder="메뉴명"
            value={item.name}
            onChange={(e) => updateItem(i, "name", e.target.value)}
          />
          <input
            className="form-input menu-price"
            placeholder="가격 (원)"
            type="number"
            min={0}
            value={item.price}
            onChange={(e) => updateItem(i, "price", e.target.value)}
          />
          <button type="button" className="btn-icon" onClick={() => removeItem(i)}>🗑️</button>
        </div>
      ))}
      <button type="button" className="btn-add-menu" onClick={addItem}>
        + 메뉴 추가
      </button>
    </div>
  );
}

// ── Main ReportPage ───────────────────────────────────────────────────────────
export default function ReportPage() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const initialArea = params.get("area") ?? "";

  const [reportType, setReportType] = useState("new_place");
  const [form, setForm] = useState({
    restaurant_name: "",
    address: "",
    lat: null,
    lng: null,
    category: "",
    description: "",
    reporter_email: "",
    reporter_nickname: "",
    area_hint: initialArea,
  });
  const [menuItems, setMenuItems] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleAddPhotos(files) {
    const newPhotos = files.slice(0, 5 - photos.length).map((f) => ({
      file: f,
      preview: URL.createObjectURL(f),
      url: null,
      uploading: true,
    }));
    setPhotos((p) => [...p, ...newPhotos]);

    // Upload each
    const uploaded = await Promise.all(
      newPhotos.map(async (p) => {
        try {
          const url = await uploadPhoto(p.file);
          return { ...p, url, uploading: false };
        } catch {
          return { ...p, uploading: false, error: true };
        }
      })
    );
    setPhotos((prev) =>
      prev.map((existing) => {
        const match = uploaded.find((u) => u.preview === existing.preview);
        return match ?? existing;
      })
    );
  }

  function handleRemovePhoto(i) {
    setPhotos((p) => {
      const next = [...p];
      URL.revokeObjectURL(next[i].preview);
      next.splice(i, 1);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const photoUrls = photos.filter((p) => p.url).map((p) => p.url);

    const payload = {
      report_type: reportType,
      restaurant_name: form.restaurant_name || null,
      address: form.address || null,
      lat: form.lat,
      lng: form.lng,
      category: form.category || null,
      description: form.description || null,
      photo_urls: photoUrls.length ? photoUrls : null,
      menu_data: menuItems.filter((m) => m.name).length ? menuItems : null,
      reporter_email: form.reporter_email || null,
      reporter_nickname: form.reporter_nickname || null,
      area_hint: form.area_hint || null,
    };

    const { error: insertError } = await supabase.from("user_reports").insert(payload);

    if (insertError) {
      setError("제출 중 오류가 발생했습니다: " + insertError.message);
    } else {
      setSuccess(true);
    }
    setSubmitting(false);
  }

  if (success) {
    return (
      <div className="report-page report-page--success">
        <div className="success-card">
          <span className="success-icon">🎉</span>
          <h2>제보 감사합니다!</h2>
          <p>검토 후 2~3 영업일 내에 반영됩니다.</p>
          <p className="success-sub">승인되면 포인트가 적립됩니다. (준비 중)</p>
          <div className="success-actions">
            <a href="/#/" className="btn-primary">지도로 돌아가기</a>
            <button
              className="btn-secondary"
              onClick={() => { setSuccess(false); setForm((f) => ({ ...f, restaurant_name: "", description: "" })); setPhotos([]); setMenuItems([]); }}
            >
              또 제보하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  const needsAddress = ["new_place", "wrong_info"].includes(reportType);
  const needsMenu = ["new_menu", "new_place"].includes(reportType);
  const needsPhoto = ["photo", "new_menu", "new_place"].includes(reportType);

  return (
    <main className="report-page">
      <header className="report-page__header">
        <a href="/#/" className="back-link">← 돌아가기</a>
        <h1>📣 맛집 제보하기</h1>
        <p>여러분의 제보로 더 정확한 정보를 만들어요</p>
        {initialArea && (
          <p className="area-badge">📍 {initialArea} 제보</p>
        )}
      </header>

      <form className="report-form" onSubmit={handleSubmit}>
        {/* Report type selector */}
        <section className="form-section">
          <label className="form-label">제보 종류</label>
          <div className="report-type-grid">
            {REPORT_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`report-type-card ${reportType === t.id ? "selected" : ""}`}
                onClick={() => setReportType(t.id)}
              >
                <span className="rtype-label">{t.label}</span>
                <span className="rtype-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Basic info */}
        <section className="form-section">
          <label className="form-label">식당 이름 <span className="required">*</span></label>
          <input
            className="form-input"
            type="text"
            required
            placeholder="예) 홍길동 국밥집"
            value={form.restaurant_name}
            onChange={update("restaurant_name")}
          />
        </section>

        {needsAddress && (
          <section className="form-section">
            <label className="form-label">주소</label>
            <AddressInput
              value={form.address}
              onChange={(v) => setForm((f) => ({ ...f, address: v }))}
              onSelectCoord={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
            />
          </section>
        )}

        <section className="form-section">
          <label className="form-label">카테고리</label>
          <select className="form-input" value={form.category} onChange={update("category")}>
            <option value="">선택 안 함</option>
            {["한식", "중식", "일식", "양식", "분식", "카페·디저트", "패스트푸드", "기타"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </section>

        {/* Menu items */}
        {needsMenu && (
          <section className="form-section">
            <label className="form-label">메뉴 정보</label>
            <MenuItemsEditor items={menuItems} onChange={setMenuItems} />
          </section>
        )}

        {/* Photos */}
        {needsPhoto && (
          <section className="form-section">
            <label className="form-label">사진 첨부 (선택)</label>
            <PhotoDropzone
              photos={photos}
              onAdd={handleAddPhotos}
              onRemove={handleRemovePhoto}
              uploading={photos.some((p) => p.uploading)}
            />
          </section>
        )}

        {/* Description */}
        <section className="form-section">
          <label className="form-label">추가 설명</label>
          <textarea
            className="form-input form-textarea"
            rows={3}
            placeholder="영업시간, 특이사항, 꿀팁 등"
            value={form.description}
            onChange={update("description")}
          />
        </section>

        {/* Reporter info (optional) */}
        <section className="form-section form-section--optional">
          <p className="section-hint">연락처를 남기시면 승인 결과를 알려드려요 (선택)</p>
          <input
            className="form-input"
            type="text"
            placeholder="닉네임"
            value={form.reporter_nickname}
            onChange={update("reporter_nickname")}
          />
          <input
            className="form-input"
            type="email"
            placeholder="이메일 (선택)"
            value={form.reporter_email}
            onChange={update("reporter_email")}
          />
        </section>

        {error && <p className="form-error">❌ {error}</p>}

        <button
          type="submit"
          className={`btn-submit ${submitting ? "btn-submit--loading" : ""}`}
          disabled={submitting || !form.restaurant_name}
        >
          {submitting ? "제출 중…" : "제보 제출하기 →"}
        </button>
      </form>
    </main>
  );
}
