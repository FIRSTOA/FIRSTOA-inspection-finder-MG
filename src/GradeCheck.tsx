/**
 * FIELD 양식의 등급 ↔ 임대리스트(워킨맵과 같은 원본) 등급 대조 (2026-10-14)
 * 왜: 지난 분기엔 S 였는데 이번 분기에 NN 으로 내려간 업체가 있다. 지난 양식을 불러오면 옛 등급이 그대로 따라온다.
 * 다르면 한 줄로 알리고 [NN 으로 바꾸기]로 양식의 "등급 :" 줄을 고친다.
 */
import { useEffect, useState } from "react";
import { selectRows } from "./supabase";
import { pickLabelValue } from "./vendorLine";
import { vendorMatchKey, vendorSearchName } from "./ids";

const norm = (g: string) => String(g || "").toUpperCase().replace(/[^A-Z]/g, "");

export default function GradeCheck({ vendor, text, onFix }: { vendor: string; text: string; onFix: (grade: string) => void }) {
  const [lease, setLease] = useState<{ grades: string[]; name: string } | null>(null);
  const formGrade = norm(pickLabelValue(text, "등급"));
  useEffect(() => {
    const q = vendorSearchName(vendor);
    if (q.length < 2) { setLease(null); return; }
    let alive = true;
    const enc = encodeURIComponent;
    void selectRows<{ _업체명: string; 등급: string; 임대여부: string }>("vendor_info", `select=${enc("_업체명,등급,임대여부")}&${enc("_업체명")}=ilike.*${enc(q.slice(0, 12))}*&_hidden=not.is.true&limit=60`)
      .then((rows) => {
        if (!alive) return;
        const key = vendorMatchKey(q);
        const same = rows.filter((r) => { const k = vendorMatchKey(r._업체명); return k && (k.startsWith(key) || key.startsWith(k)); });
        const live = same.filter((r) => !/종료|소송/.test(r.임대여부 || ""));
        const grades = Array.from(new Set((live.length ? live : same).map((r) => norm(r.등급)).filter(Boolean)));
        setLease(grades.length ? { grades, name: (live[0] || same[0])._업체명 } : null);
      })
      .catch(() => { if (alive) setLease(null); });
    return () => { alive = false; };
  }, [vendor]);
  if (!lease || !formGrade || lease.grades.includes(formGrade)) return null;
  const target = lease.grades[0];
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">
      <span>⚠ 등급이 다릅니다 — 양식 <b>{formGrade}</b> · 임대리스트(워킨맵) <b>{lease.grades.join("/")}</b></span>
      <span className="text-[11px] font-semibold text-amber-700">이번 분기에 등급이 바뀌었을 수 있습니다</span>
      {lease.grades.length === 1 && <button type="button" onClick={() => onFix(target)} className="ml-auto rounded-full bg-amber-600 px-3 py-1 text-[11px] font-black text-white hover:bg-amber-700">{target}로 바꾸기</button>}
    </div>
  );
}
