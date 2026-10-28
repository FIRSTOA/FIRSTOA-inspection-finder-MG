// 부서 접수(경영·운영·영업) 사진 첨부 칸 — 2026-10-28 사용자 "CS 접수처럼 사진 첨부, 한조 캡처를 넣어 달라는 문구(필수 아님)".
// 업로드 경로·크기 기준·붙여넣기는 ServiceReception 증상 사진 칸(handlePhotoPick)과 같다. 그 화면 파일은 건드리지 않으려고 같은 규칙을 이 파일에 옮겼다.
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { askConfirm } from "./confirmModal";
import { prepareImageForUpload, type PreparedImage } from "./imageUpload";
import { uploadPhoto } from "./supabase";
import { notify } from "./toast";

export type DeptPhoto = { url: string; name: string; width?: number; height?: number };

export const DEPT_PHOTO_MAX = 6;
/** 안내 문구(라벨 아래 회색 한 줄) */
export const DEPT_PHOTO_HINT = "한조(카운터·소모품 수명) 화면 캡처가 있으면 같이 넣어 주세요 — 없어도 됩니다";

// CS 증상 사진과 같은 크기 기준(ServiceReception PHOTO_* 와 같은 값)
const PHOTO_LOW_RES = 600; // 긴 변이 이보다 작으면 썸네일 수준 — 확인 받고 올린다
const PHOTO_SMALL = 1200;  // 이보다 작으면 "작음" 표시만
const PHOTO_BLOCK = 400;   // 이보다 작으면 올리지 않는다(카톡 말풍선 미리보기 복사)
const longSide = (p: { width?: number; height?: number }) => Math.max(p.width || 0, p.height || 0);

export default function DeptPhotoField({ photos, onChange }: { photos: DeptPhoto[]; onChange: (next: DeptPhoto[]) => void }) {
  const [busy, setBusy] = useState(false);

  const pick = async (files: FileList | File[] | null) => {
    if (!files || !files.length || busy) return;
    setBusy(true);
    try {
      const prepared: Array<{ file: File; image: PreparedImage }> = [];
      for (const file of Array.from(files).slice(0, DEPT_PHOTO_MAX - photos.length)) {
        prepared.push({ file, image: await prepareImageForUpload(file, 3000, { quality: 0.92, keepOriginalUnderBytes: 6_000_000 }) });
      }
      const blocked = prepared.filter((p) => p.image.width && longSide(p.image) < PHOTO_BLOCK);
      if (blocked.length) {
        notify(`사진 ${blocked.length}장이 너무 작아(${blocked.map((p) => `${p.image.width}×${p.image.height}`).join(", ")}) 올리지 않았습니다 — 카톡에서 사진을 눌러 크게 연 창에서 복사(Ctrl+C)한 뒤 다시 붙여 넣으세요`, "error");
      }
      const usable = prepared.filter((p) => !blocked.includes(p));
      const low = usable.filter((p) => p.image.width && longSide(p.image) < PHOTO_LOW_RES);
      let toUpload = usable;
      if (low.length) {
        const sizes = low.map((p) => `${p.image.width}×${p.image.height}`).join(", ");
        const ok = await askConfirm(
          `사진 ${low.length}장이 썸네일 크기(${sizes})라 카톡방 링크로 열면 글자가 안 보입니다.\n\n카톡 PC에서는 사진을 눌러 크게 연 창에서 복사(Ctrl+C)하거나, 파일로 저장해서 첨부하세요.\n\n그래도 이대로 올릴까요?`,
          { okLabel: "그래도 올리기", danger: true },
        );
        if (!ok) toUpload = usable.filter((p) => !low.includes(p));
      }
      const uploaded: DeptPhoto[] = [];
      for (const { file, image } of toUpload) {
        const url = await uploadPhoto(`reception/${crypto.randomUUID()}.${image.ext}`, image.blob, image.contentType);
        uploaded.push({ url, name: file.name, width: image.width, height: image.height });
      }
      if (uploaded.length) onChange([...photos, ...uploaded]);
      else if (low.length && !blocked.length) notify("작은 사진은 올리지 않았습니다. 크게 연 뒤 다시 복사해 주세요.", "error");
    } catch (e) {
      notify(`사진 업로드 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-slate-500">사진 (선택, 최대 {DEPT_PHOTO_MAX}장)</div>
      <div className="mt-0.5 text-[11px] font-medium text-slate-400">{DEPT_PHOTO_HINT}</div>
      <div tabIndex={0} onPaste={(e) => { const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); void pick(files); } }}
        className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-200">
        {photos.map((photo, index) => {
          const long = longSide(photo);
          const grade = !long ? "" : long < PHOTO_LOW_RES ? "low" : long < PHOTO_SMALL ? "small" : "";
          return (
            <span key={photo.url} className="relative" title={long ? `${photo.width}×${photo.height}` : undefined}>
              <a href={photo.url} target="_blank" rel="noreferrer"><img loading="lazy" src={photo.url} alt={photo.name} className={`h-16 w-16 rounded-lg border object-cover ${grade === "low" ? "border-rose-400" : grade === "small" ? "border-amber-300" : "border-slate-200"}`} /></a>
              {grade && <span className={`absolute inset-x-0 bottom-0 rounded-b-lg px-0.5 text-center text-[9px] font-black leading-4 text-white ${grade === "low" ? "bg-rose-600" : "bg-amber-500"}`}>{grade === "low" ? "저화질" : "작음"}</span>}
              <button type="button" aria-label="사진 빼기" onClick={() => onChange(photos.filter((_, i) => i !== index))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">×</button>
            </span>
          );
        })}
        {photos.length < DEPT_PHOTO_MAX && <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-400">
          {busy ? "…" : <ImagePlus size={21} aria-hidden />}
          <span className="sr-only">사진 추가</span>
          <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} className="hidden" />
        </label>}
        <span className="basis-full text-[10px] font-bold text-slate-400">클릭 후 Ctrl+V 붙여넣기 가능 · 카톡 PC 사진은 눌러 크게 연 뒤 복사하세요</span>
      </div>
    </div>
  );
}
