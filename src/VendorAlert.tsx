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

export function VendorAlertChip({ flags, onOpen }: { flags: VendorWorkFlags | undefined | null; onOpen: () => void }) {
  const alert = vendorAlertLevel(flags);
  const note = flags?.note || null;
  if (!alert && !note) return null;
  return (
    <>
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
