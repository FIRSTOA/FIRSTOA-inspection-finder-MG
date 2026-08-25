/**
 * 점검 체크리스트 — FIELD 점검 양식 옆에 접이식으로. 팀에서 쓰던 "복합기 점검 체크리스트"(카톡 공유 HTML) 항목 그대로.
 * 기본은 접힌 상태이고 펼침 여부는 이 기기에 기억한다 — 익숙한 사람은 접어두면 다시 안 보이고, 필요한 사람만 펼친다.
 * 체크 상태는 양식이 비워질 때(새 일정 불러오기·초기화) 함께 지워진다.
 */
import { useEffect, useState } from "react";

const GENERAL = ["ADF 롤 및 복사 테스트", "평판 지분 확인", "앞커버 토너비산 확인", "측면커버 지분 확인", "정착기 고착토너 확인", "4색패턴 확인", "데모페이지 원본/복사본 확인", "폐토너통 잔량 확인", "토너 잔량 확인", "급지롤 확인", "여분토너 확인"];
const SAMSUNG = ["지분막대 청소", "매수 확인"];
const OPEN_KEY = "field_checklist_open_v1";

export default function InspectionChecklist({ resetToken }: { resetToken: string }) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* 무시 */ } }, [open]);
  useEffect(() => { setChecked(new Set()); }, [resetToken]); // 새 양식이 오면 체크도 새로
  const total = GENERAL.length + SAMSUNG.length;
  const toggle = (item: string) => setChecked((cur) => { const next = new Set(cur); next.has(item) ? next.delete(item) : next.add(item); return next; });
  const Item = ({ label }: { label: string }) => {
    const on = checked.has(label);
    return (
      <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition ${on ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(label)} className="h-4 w-4 accent-emerald-600" />
        <span className={on ? "line-through decoration-emerald-400" : ""}>{label}</span>
      </label>
    );
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-[12.5px] font-black text-slate-700">✅ 점검 체크리스트
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${checked.size === total ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{checked.size}/{total}</span>
        </span>
        <span className="text-[11px] font-bold text-slate-400">{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{GENERAL.map((g) => <Item key={g} label={g} />)}</div>
          <div className="text-[11px] font-black text-slate-400">[삼성]</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{SAMSUNG.map((g) => <Item key={g} label={g} />)}</div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400">체크는 이 화면에서만 — 양식·카톡에는 들어가지 않습니다</span>
            <button type="button" onClick={() => setChecked(new Set())} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-500 hover:bg-slate-50">체크 전체 해제</button>
          </div>
        </div>
      )}
    </div>
  );
}
