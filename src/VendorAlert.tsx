/**
 * 거래처 알림 칩 — 아이콘 나열 대신 "⚠ N" 하나로 줄이고, 누르면 통합이력 팝업으로 보낸다.
 * 심각도: 빨강(미수 잔액·최근 불만) > 주황(초과료) > 파랑(이번 분기 점검·재계약 남음).
 * 완료된 것(점검 G5·미수 완납)은 개수에 넣지 않는다 — 팝업에서만 회색으로 보인다.
 */
import type { VendorWorkFlags } from "./vendorFlags";

export function vendorAlertLevel(flags: VendorWorkFlags | undefined | null): { count: number; level: "red" | "amber" | "blue" } | null {
  if (!flags) return null;
  let red = 0;
  let amber = 0;
  let blue = 0;
  if (flags.misu && !flags.misu.cleared) red += 1;
  if (flags.bulman) red += 1;
  if (flags.overage) amber += 1;
  if (flags.inspection && !flags.inspection.done && !flags.inspection.carried) blue += 1;
  if (flags.renewal && !flags.renewal.done) blue += 1;
  const count = red + amber + blue;
  if (!count) return null;
  return { count, level: red ? "red" : amber ? "amber" : "blue" };
}

const CHIP_STYLE = {
  red: "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100",
  amber: "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100",
  blue: "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
} as const;

/**
 * 키맨·담당자 변경 배지 표시 여부.
 * 최근 90일 변경은 무조건 보여주고, 사람이 바뀐 건인데 인사가 안 됐으면 90일이 지나도 계속 보여준다
 * (놓친 인사를 상기시키는 게 이 기능의 취지 — 대표님, 2026-08-27). D+숫자로 오래된 건임을 알 수 있게 한다.
 */
export function keymanBadge(flags: VendorWorkFlags | undefined | null): { label: string; tone: "amber" | "slate"; title: string } | null {
  const k = flags?.keyman;
  if (!k) return null;
  // 인사는 "최근 것부터"가 현실적이다(사용자 결정 2026-08-28) — 30일 안쪽만 주황으로 상기시키고
  // 그보다 오래된 건은 이미 인사했다고 본다. 오래된 건까지 계속 경고하면 배지가 무뎌진다.
  const pendingGreeting = k.isPerson && !k.greeted && k.days <= 30;
  if (!k.count90 && !pendingGreeting) return null;
  const label = `${k.isPerson ? "🤝 키맨" : "📍 변경"} D+${k.days}`;
  const title = [
    `${k.date} ${k.category} 변경${k.isPerson ? (k.greeted ? " · 인사 완료" : " · 인사 필요") : ""}`,
    k.before ? `이전: ${k.before}` : "",
    k.after ? `현재: ${k.after}` : "",
    k.count90 > 1 ? `최근 90일 ${k.count90}건` : "",
    "누르면 통합이력에서 전체 변경 이력을 봅니다",
  ].filter(Boolean).join("\n");
  return { label, tone: pendingGreeting ? "amber" : "slate", title };
}

export function VendorAlertChip({ flags, onOpen }: { flags: VendorWorkFlags | undefined | null; onOpen: () => void }) {
  const alert = vendorAlertLevel(flags);
  const note = flags?.note || null;
  const keyman = keymanBadge(flags);
  if (!alert && !note && !keyman) return null;
  return (
    <>
      {/* 키맨이 바뀐 걸 모르고 방문하면 이전 담당자 이름을 부르게 된다 — 분기체크 개수와 섞지 않고 따로 세운다 */}
      {keyman && (
        <button type="button" title={keyman.title}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
          className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-black transition ${keyman.tone === "amber" ? "border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200" : "border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {keyman.label}
        </button>
      )}
      {/* 거래처 특이사항은 방문 전에 반드시 봐야 하는 층이라 분기체크 개수에 섞지 않고 따로 세운다 */}
      {note && (
        <button type="button" title={note.text.slice(0, 300)}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
          className="shrink-0 cursor-pointer rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-700 transition hover:bg-violet-100">
          📌 특이사항
        </button>
      )}
      {alert && (
        <button type="button" title="이번 분기 체크 항목 — 누르면 통합이력이 열립니다"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
          className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-black transition ${CHIP_STYLE[alert.level]}`}>
          ⚠ {alert.count}
        </button>
      )}
    </>
  );
}
