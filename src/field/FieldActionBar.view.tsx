/**
 * 필드 탭 미리보기 아래 단추 줄(로직 없음) — 보조 줄(초기화·복사·사진) + 경고 + 주 줄(전송·보내기·시트).
 * PC 오른쪽 미리보기(variant="side")와 폰 아래 고정 패널(variant="bottom")이 같은 부품을 쓴다.
 * 2026-10-24 docs/tasks/field-form-tidy.md S7(감사 A4): 단추를 UI.btn(주)·UI.btnGhost(보조) 2종으로 통일.
 * 동작은 App 에서 받은 콜백 그대로다 — 미수 탭은 App 이 이 줄을 아예 그리지 않는다.
 */
import type { ChangeEvent } from "react";
import { UI } from "../ui/card";
import { fieldSendLabel } from "./fieldFormModel";

export type FieldActionBarProps = {
  variant: "side" | "bottom";
  mode: string;
  hasOutput: boolean;
  sending: boolean;
  photoCount: number;
  onReset: () => void;
  onCopy: () => void;
  onPhotoSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  /** 비어 있으면 경고 없음. region 이면 PC 에서 A~E 바로 고르기 단추를 함께 보인다 */
  issue: "" | "region" | "vendor";
  onFillRegion: (r: string) => void;
  onOpenSendPicker: () => void;
  onSend: () => void;
  praiseReady: boolean;
  onPraiseSubmit: () => void;
  sheetUrl: string;
};

export function FieldActionBar(p: FieldActionBarProps) {
  const side = p.variant === "side";
  const isInspection = p.mode === "inspection" || p.mode === "blank-report";
  const isPraise = p.mode === "praise";
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={p.onReset} className={`${UI.btnGhost} w-full px-2`}>초기화</button>
        <button type="button" onClick={p.onCopy} disabled={!p.hasOutput} className={`${UI.btnGhost} w-full px-2`}>복사</button>
        <label className={`${UI.btnGhost} w-full cursor-pointer px-2`}>
          {side ? "사진" : "📷 사진/영상"}{p.photoCount > 0 ? ` ${p.photoCount}` : ""}
          <input type="file" accept="image/*,video/*" multiple onChange={p.onPhotoSelect} className="hidden" />
        </label>
      </div>
      {p.issue && (
        <div className={UI.note("bad")}>
          {side
            ? (p.issue === "vendor" ? "⚠ 업체명을 읽지 못했습니다 — 양식의 업체명을 확인해 주세요 (전송 안 됨)" : "⚠ 양식에 지역이 없습니다 — 아래에서 바로 고르면 채워집니다 (없으면 전송 안 됨)")
            : (p.issue === "vendor" ? "⚠ 업체명을 읽지 못했습니다 — 양식의 업체명을 확인해 주세요" : "⚠ 양식에 지역이 없습니다 — 지역이 있어야 팀 점검·AS방으로 보낼 수 있어요")}
          {side && p.issue === "region" && (
            <span className="ml-2 inline-flex gap-1 align-middle">
              {(["A", "B", "C", "D", "E"] as const).map((r) => (
                <button key={r} type="button" onClick={() => p.onFillRegion(r)}
                  className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-black text-slate-700 ring-1 ring-rose-200 transition hover:bg-rose-100">{r}</button>
              ))}
            </span>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {isInspection ? (
          /* 통합 전송 팝업(방 선택·자가/부품 자동 감지) — 일정리스트에서 왔든 필드탭에서 직접 붙여넣었든 같은 버튼.
             전송 성공 뒤 일정리스트에 같은 업체 미완료 일정이 있으면 완료/익일 팝업 → 팀 완료 캘린더 이동까지 이어진다. */
          <button type="button" onClick={p.onOpenSendPicker} disabled={!p.hasOutput || p.sending} className={`${UI.btn} flex-1 whitespace-nowrap`}>{p.sending ? "전송 중…" : "📨 카톡방 전송"}</button>
        ) : p.mode === "replacement" ? (
          <button type="button" disabled className={`${UI.btnGhost} flex-1 whitespace-nowrap`}>전송 불가 · 복사 전용</button>
        ) : (
          <>
            <button type="button" onClick={() => isPraise ? p.onPraiseSubmit() : p.onSend()} disabled={isPraise ? !p.praiseReady : (!p.hasOutput || p.sending)} className={`${UI.btn} flex-[1.5] whitespace-nowrap`}>{fieldSendLabel(p.mode, p.sending)}</button>
            {p.sheetUrl && <a href={p.sheetUrl} target="_blank" rel="noreferrer" className={`${UI.btnGhost} flex-1 whitespace-nowrap`}>📄 {side ? "시트 열기" : "시트"}</a>}
          </>
        )}
      </div>
    </>
  );
}
