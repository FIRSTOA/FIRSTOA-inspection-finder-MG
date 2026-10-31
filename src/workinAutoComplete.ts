/**
 * 점검 양식 전송 → 워킨맵(workin_map_places) 자동 완료에서 "어느 행을 칠할지" 고르는 순수 규칙.
 *
 * 2026-10-31 사용자 결정: 양식에 적힌 기기 수만큼만 칠한다(9대 업체에서 1대 점검 → 1행, 4대 → 4행).
 * 예전에는 같은 업체·같은 범위 후보가 2곳 이상이면 "후보 N곳 · 자동 반영 제외"로 아예 막았다
 * (범건축 9행 중 1행만 G5 된 실측). 장소 행에는 기기 번호 열이 없고 name(층·부서)·comment("D470/809150710260")·memos 뿐이다.
 *
 * 기기 하나당 행 하나:
 *  ① 장소 comment/name/memos 에 그 기기의 시리얼(5자 이상) 또는 자산기번(4자 이상)이 들어 있는 행
 *  ①-2 없으면 같은 업체·같은 범위 미완료 행 중 comment/name 에 그 기기의 모델명(또는 핵심 토큰 D470·HP-9010·C2060)이 든 행
 *  ② 없으면 같은 업체(이름 키 일치)·같은 범위·아직 미완료인 행 중 이번 양식에서 아직 안 고른 것 하나(번호 순)
 * 기기 수 > 남은 미완료 행이면 있는 만큼만 칠하고 나머지 기기는 "이미 반영"(업체 행이 전부 완료) 또는 "없음".
 * 기기 0대면 1대로 본다(예전처럼 1행).
 */

export function matchToken(value: string): string {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

export function matchVendor(value: string): string {
  return matchToken(value
    .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, ""));
}

export type WorkinPickRow = {
  id: number;
  quarter: number;
  kind: string;
  label: string;
  name: string;
  comment: string;
  memos?: string[] | null;
};

/** serial·asset 은 matchToken 으로 정규화된 값 */
export type WorkinPickDevice = {
  index: number;
  serial: string;
  asset: string;
  /** 양식의 모델명 원문(정규화 전) — ①-2 에 쓴다 */
  model?: string;
};

export type WorkinPickScope = {
  kind: "quarter" | "monthly";
  quarter: number;
  /** matchVendor(양식 업체명) */
  vendorKey: string;
  /** 이번에 칠할 라벨 — 분기점검 G5, 매월점검 G2/G3/G5 */
  targetLabel: string;
};

export type WorkinPickBasis = "시리얼" | "자산기번" | "모델명" | "업체 순번";

export type WorkinDevicePick<R extends WorkinPickRow> = {
  deviceIndex: number;
  /** pick: 칠할 미완료 행 · done: 이미 완료(G5 등)·이관(G12) 행 · none: 행 없음 */
  state: "pick" | "done" | "none";
  row: R | null;
  basis: WorkinPickBasis | null;
  /** 시리얼·기번이 가리킨 행을 이번 양식의 다른 기기가 이미 골랐다(한 행에 기기 2대가 적힌 경우) */
  shared: boolean;
};

export type WorkinPickResult<R extends WorkinPickRow> = {
  picks: WorkinDevicePick<R>[];
  /** 범위 안 같은 업체 행 수 */
  vendorRows: number;
  /** 그중 미완료 행 수(고르기 전) */
  openRows: number;
  /** 칠할 행 수(서로 다른 행) */
  pickedRows: number;
};

const MONTHLY_RANK: Record<string, number> = { G1: 0, G2: 1, G3: 2, G5: 3 };

/** 이 범위에서 이미 끝난 행인가 — G12(이관)는 늘 끝, 분기점검은 G5, 매월점검은 이번 달 단계 이상 */
export function isWorkinRowDone(row: Pick<WorkinPickRow, "kind" | "label">, targetLabel: string): boolean {
  if (row.label === "G12") return true;
  if (row.kind === "monthly") return (MONTHLY_RANK[row.label] ?? 0) >= (MONTHLY_RANK[targetLabel] ?? 3);
  return row.label === "G5";
}

/**
 * 양식 업체 키와 장소 이름 키가 같은 업체인가 — 같으면 일치.
 * 길이가 다르면 짧은 쪽(3자 이상)이 긴 쪽의 **접두**일 때만("범건축" ↔ "범건축3층설계팀").
 * 가운데 포함은 다른 업체로 본다("범건축" ↔ "대범건축사사무소").
 */
export function sameWorkinVendor(vendorKey: string, rowVendor: string): boolean {
  if (vendorKey.length < 2 || rowVendor.length < 2) return false;
  if (vendorKey === rowVendor) return true;
  const [shorter, longer] = vendorKey.length <= rowVendor.length ? [vendorKey, rowVendor] : [rowVendor, vendorKey];
  return shorter.length >= 3 && longer.startsWith(shorter);
}

/**
 * 모델명에서 행 글자와 맞춰 볼 토큰 — 전체(정규화)와, 공백·괄호·슬래시로 나눈 조각 중 숫자가 든 3자 이상.
 * "D470 (신도)" → d470 · "HP-9010" → hp9010 · "Sindoh D450/C2060" → c2060, d450 …
 */
export function modelTokens(model: string): string[] {
  const tokens = new Set<string>();
  const full = matchToken(model);
  if (full.length >= 3 && /\d/.test(full)) tokens.add(full);
  for (const chunk of model.split(/[\s()[\]/,·]+/)) {
    const token = matchToken(chunk);
    if (token.length >= 3 && /\d/.test(token)) tokens.add(token);
  }
  return [...tokens];
}

export function pickRowsForDevices<R extends WorkinPickRow>(
  devices: WorkinPickDevice[],
  candidates: R[],
  scope: WorkinPickScope,
): WorkinPickResult<R> {
  const list = devices.length ? devices : [{ index: 0, serial: "", asset: "" }];
  const inScope = candidates
    .filter((row) => row.kind === scope.kind && row.quarter === scope.quarter)
    .sort((a, b) => a.id - b.id)
    .map((row) => ({ row, text: matchToken([row.name, row.comment, ...(row.memos || [])].join(" ")) }));
  const vendorRows = inScope.filter(({ row }) => sameWorkinVendor(scope.vendorKey, matchVendor(row.name)));
  const isDone = (row: R) => isWorkinRowDone(row, scope.targetLabel);
  const openRows = vendorRows.filter(({ row }) => !isDone(row)).length;

  const used = new Set<number>();
  const picks = new Map<number, WorkinDevicePick<R>>();

  // ① 시리얼·자산기번 일치 — 모든 기기를 먼저 본다(②가 그 행을 먼저 가져가지 않게)
  for (const device of list) {
    const bySerial = device.serial.length >= 5 ? inScope.filter(({ text }) => text.includes(device.serial)) : [];
    const byAsset = !bySerial.length && device.asset.length >= 4 ? inScope.filter(({ text }) => text.includes(device.asset)) : [];
    const matches = bySerial.length ? bySerial : byAsset;
    if (!matches.length) continue;
    const basis: WorkinPickBasis = bySerial.length ? "시리얼" : "자산기번";
    // 미완료·아직 안 고른 행 → 미완료 → 아무거나 순으로
    const chosen = matches.find(({ row }) => !used.has(row.id) && !isDone(row))
      || matches.find(({ row }) => !used.has(row.id))
      || matches[0];
    const shared = used.has(chosen.row.id);
    used.add(chosen.row.id);
    picks.set(device.index, { deviceIndex: device.index, state: isDone(chosen.row) ? "done" : "pick", row: chosen.row, basis, shared });
  }

  // ①-2 같은 업체·같은 범위 미완료 행 중 그 기기의 모델(핵심 토큰)이 comment/name 에 든 행(번호 순)
  for (const device of list) {
    if (picks.has(device.index)) continue;
    const tokens = modelTokens(device.model || "");
    if (!tokens.length) continue;
    const byModel = vendorRows.find(({ row }) => {
      if (used.has(row.id) || isDone(row)) return false;
      const text = matchToken(`${row.name} ${row.comment}`);
      return tokens.some((token) => text.includes(token));
    });
    if (!byModel) continue;
    used.add(byModel.row.id);
    picks.set(device.index, { deviceIndex: device.index, state: "pick", row: byModel.row, basis: "모델명", shared: false });
  }

  // ② 같은 업체·같은 범위 미완료 행 중 안 고른 것(번호 순). 다 떨어지면 완료 행으로 "이미 반영" 보고
  const doneQueue = vendorRows.filter(({ row }) => isDone(row) && !used.has(row.id));
  for (const device of list) {
    if (picks.has(device.index)) continue;
    const open = vendorRows.find(({ row }) => !used.has(row.id) && !isDone(row));
    if (open) {
      used.add(open.row.id);
      picks.set(device.index, { deviceIndex: device.index, state: "pick", row: open.row, basis: "업체 순번", shared: false });
      continue;
    }
    const done = doneQueue.shift() || vendorRows.find(({ row }) => isDone(row));
    picks.set(device.index, done
      ? { deviceIndex: device.index, state: "done", row: done.row, basis: "업체 순번", shared: false }
      : { deviceIndex: device.index, state: "none", row: null, basis: null, shared: false });
  }

  const ordered = list.map((device) => picks.get(device.index)!);
  const pickedRows = new Set(ordered.filter((p) => p.state === "pick" && p.row).map((p) => p.row!.id)).size;
  return { picks: ordered, vendorRows: vendorRows.length, openRows, pickedRows };
}
