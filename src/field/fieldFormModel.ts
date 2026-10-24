/**
 * 필드 탭 점검·AS·청정기 양식의 타입·옵션 상수·여분(spare) 순수 함수.
 * App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S1). App 을 import 하지 않는다(순환 금지).
 */

export type PerItemForm = {
  location: string;
  model: string;
  serial: string;
  asset: string;
  content: string;
  processContent: string;
  mailBlack: string;
  mailColor: string;
  mailLargeColor: string;
  mailTotal: string;
  tonerK: string;
  tonerC: string;
  tonerM: string;
  tonerY: string;
  waste: string;
  spareRaw: string;
  hantin: string;
  parking: string;
  notes: string;
};

export type SharedForm = {
  level: string;
  region: string;
  warranty: string;
  cumCount: string;
  expectedCount: string;
  partName: string;
  partQty: string;
  partShipped: string;
  selfItem: string;
  selfQty: string;
  selfShipped: string;
  arrivalHour: string;
  arrivalMinute: string;
  duration: string;
};

export type AirPurifierForm = {
  filterReset: string;
  filterChange: string;
  notes: string;
  arrivalHour: string;
  arrivalMinute: string;
  duration: string;
};

export type SpareToken = "K" | "C" | "M" | "Y" | "폐" | "드럼";
export const SPARE_TOKENS: SpareToken[] = ["K", "C", "M", "Y", "폐", "드럼"];
export function spareTokenRegex(token: SpareToken): RegExp {
  const name = token === "폐" ? "폐(?:통)?" : token;
  // K2C2M2Y2처럼 붙여 쓰는 경우 다음 토큰 앞의 이전 숫자도 경계로 인정한다.
  const prefix = token.length === 1 ? "(^|[\\s\\n,;/]|\\d)" : "(^|[\\s\\n,;/])";
  // K-2는 수량 2, K-처럼 숫자가 없는 하이픈은 미입력으로 구분한다.
  return new RegExp(`${prefix}(${name})\\s*[:=]?\\s*(-\\s*\\d+|\\d+|-)`, token.length === 1 ? "i" : "");
}
export function groupedSpareTokenCount(raw: string, token: SpareToken): number | null {
  if (!(["K", "C", "M", "Y"] as SpareToken[]).includes(token)) return null;
  const tonerSet = raw.match(/(?:컬러\s*)?토너\s*[-:=]?\s*(\d+)\s*(?:세트|set)/i);
  if (tonerSet) return Number(tonerSet[1]);
  const allColor = raw.match(/(?:KCMY|CMYK)\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/i);
  if (allColor) return Number(allColor[1]);
  const cmy = raw.match(/CMY\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/i);
  return token !== "K" && cmy ? Number(cmy[1]) : null;
}
export function expandSpareGroups(raw: string): string {
  return raw
    .replace(/토너\s*(?=[KCMY])/gi, "")
    .replace(/(?:컬러\s*)?토너\s*[-:=]?\s*(\d+)\s*(?:세트|set)/gi, (_all, n: string) => `K${n} C${n} M${n} Y${n}`)
    .replace(/(?:KCMY|CMYK)\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/gi, (_all, n: string) => `K${n} C${n} M${n} Y${n}`)
    .replace(/CMY\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/gi, (_all, n: string) => `C${n} M${n} Y${n}`);
}
export function spareTokenCount(raw: string, token: SpareToken): number | null {
  const normalized = expandSpareGroups(raw);
  const m = normalized.match(spareTokenRegex(token));
  if (m) {
    const value = m[3].replace(/\s/g, "");
    return value === "-" ? null : Number(value.replace(/^-/, ""));
  }
  return groupedSpareTokenCount(raw, token);
}
export function changeSpareToken(raw: string, token: SpareToken, delta: number): string {
  raw = expandSpareGroups(raw);
  const rx = spareTokenRegex(token);
  const current = spareTokenCount(raw, token);
  if (current !== null || rx.test(raw)) {
    const next = Math.max(0, (current || 0) + delta);
    return raw.replace(rx, (_all, prefix: string, name: string) => `${prefix}${name}${next}`);
  }
  if (delta < 0) return raw;
  const value = `${token}1`;
  const newline = raw.indexOf("\n");
  if (!raw.trim()) return value;
  return newline < 0 ? `${raw.trimEnd()} ${value}` : `${raw.slice(0, newline).trimEnd()} ${value}${raw.slice(newline)}`;
}

export function spareStorageLocation(raw: string) {
  // 끝 공백을 여기서 trim하면 입력 중 스페이스가 매 렌더마다 지워져 띄어쓰기가 불가능해진다(실사고) — 표시값은 그대로, 빈값 판정만 trim
  const value = raw.match(/(?:^|\n)(?:보관\s*)?위치\s*[:：] ?(.*)$/im)?.[1] || "";
  return value.trim() ? value : "";
}

export function changeSpareStorageLocation(raw: string, location: string) {
  const withoutLocation = raw
    .split("\n")
    .filter((line) => !/^(?:보관\s*)?위치\s*[:：]/i.test(line.trim()))
    .join("\n")
    .trimEnd();
  return location.trim() ? `${withoutLocation}${withoutLocation ? "\n" : ""}보관 위치: ${location}` : withoutLocation;
}

export const HANTIN_OPTIONS = ["한공", "한조", "모바일한조", "한조해지업체", "보안으로 설치불가", "고객불편으로 설치불가", "무"];
export const PARKING_OPTIONS = ["유", "무"];
export const SHIP_OPTIONS = ["출고부탁드립니다", "선출고완료"];
export const HOUR_OPTIONS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
export const MINUTE_OPTIONS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
export const DURATION_STEPS = [1, 5, 10, 30, 60];
export const LEVEL_OPTIONS = ["1", "2", "3", "4", "5"];
export const YESNO_OPTIONS = ["유", "무"];

export const TONER_COLORS: Record<string, string> = {
  K: "#111827",
  C: "#06B6D4",
  M: "#EC4899",
  Y: "#EAB308",
};

export type DeviceInfo = Pick<PerItemForm, "location" | "model" | "serial" | "asset" | "content">;
export const EMPTY_DEVICE_INFO: DeviceInfo = { location: "", model: "", serial: "", asset: "", content: "" };

/** 필드 단추 줄 [보내기] 글자(S7) — 물류는 "물류방 보내기" */
export function fieldSendLabel(mode: string, sending: boolean): string {
  if (sending) return "보내는 중…";
  return mode === "logistics" ? "물류방 보내기" : "보내기";
}
