import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import VendorSearch from "./VendorSearch";
import AirSearch from "./AirSearch";
import PcForm, { EMPTY_PC_FORM, buildPcText, type PcFormState } from "./PcForm";
import CopierExpansionForm, { EMPTY_COPIER_EXPANSION_FORM, buildCopierExpansionText, type CopierExpansionFormState } from "./CopierExpansionForm";
import CategoryForm from "./CategoryForm";
import { buildCatText, emptyCatForm } from "./categoryForms";
import Home from "./Home";
import UnifiedHistory from "./UnifiedHistory";
import WorkDashboard from "./WorkDashboard";
import GrowthHub from "./GrowthHub";
import LogisticsForm from "./LogisticsForm";
import { EMPTY_LOGISTICS_FORM, buildLogisticsText } from "./logistics";
import ReportTypeSelector from "./ReportTypeSelector";
import { kstDate, saveVisit, type VisitDraft, type WorkKind } from "./visits";
import { visionForm, sendForm, sendPcForm, sendCopierExpansionForm, sendCategoryForm, sendLogisticsForm, type LogisticsFormState, type SendDestination } from "./api";
import { uploadPhoto, createAlbum } from "./supabase";

// 이미지 파일을 긴 변 maxDim 이하로 축소해 dataURL(JPEG)로. (전송량·비용 절감)
function fileToDownscaledDataUrl(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas 미지원")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패")); };
    img.src = url;
  });
}
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
import type { AuthorTeam } from "./authors";

type Mode = "inspection" | "blank-report" | "air-purifier" | "samsung-note" | "pc"
  | "logistics" | "bulman" | "misu" | "overage-adjust" | "recontract";

type CopyResult = {
  ok: boolean;
  message: string;
};

type ModelSerial = {
  model: string;
  serial: string;
};

type ResultItem = {
  content: string;
  warning?: string;
};

type TestMode = Mode | "shared";

type TestCase = {
  name: string;
  input: string;
  mode: TestMode;
  expected?: string;
  expectedFunction?: boolean;
};

type TestResult = TestCase & {
  passed: boolean;
  actual: string;
};

type ModeConfig = {
  label: string;
  accent: string;
  bgSoft: string;
  textDark: string;
  placeholder: string;
};

const FIELD_GUIDES: Record<Mode, { icon: string; title: string; description: string }> = {
  inspection: { icon: "🖨️", title: "점검·AS 업무", description: "기존 양식이나 AS 원본을 불러와 현장 처리내용을 작성하고 점검방·AS방으로 전송합니다." },
  "blank-report": { icon: "🖨️", title: "점검·AS 업무", description: "AS 접수 원본을 자동 변환해 현장 처리내용을 작성하고 점검방·AS방으로 전송합니다." },
  "air-purifier": { icon: "🌿", title: "청정기 점검", description: "청정기 양식을 불러오거나 사진으로 생성해 필터 점검내용을 기록합니다." },
  "samsung-note": { icon: "📝", title: "일정 원본 변환", description: "번호가 붙은 현장 일정을 여러 건의 업무 양식으로 변환합니다." },
  pc: { icon: "💻", title: "확장성 업무", description: "거래처의 PC·소프트웨어 현황과 홍보·견적 내용을 기록합니다." },
  logistics: { icon: "📦", title: "물류 업무", description: "납품·교체·철수·이전·셋팅 업무와 물품 상태를 기록합니다." },
  bulman: { icon: "📣", title: "불만 방문", description: "거래처 불만 내용과 방문 처리결과를 정해진 양식으로 기록합니다." },
  misu: { icon: "💳", title: "미수 방문", description: "미수 거래처 방문과 확인 내용을 기록하고 지역별 미수방으로 전송합니다." },
  "overage-adjust": { icon: "📈", title: "초과조정", description: "초과 사용량과 조정 상담·처리내용을 기록합니다." },
  recontract: { icon: "🤝", title: "재계약", description: "계약 종료 예정 거래처의 상담과 재계약 진행내용을 기록합니다." },
};

const MODE_ORDER: Mode[] = ["inspection", "blank-report", "air-purifier"];

// 토스풍 팔레트: 단일 블루 포인트 + 연블루 소프트.
const BW_ACCENT = "#334155";
const BW_SOFT = "#F1F5F9";
const BW_TEXT = "#191F28";
const MODE_CONFIG: Record<Mode, ModeConfig> = {
  inspection: {
    label: "점검",
    accent: BW_ACCENT,
    bgSoft: BW_SOFT,
    textDark: BW_TEXT,
    placeholder: "여기에 -시작- 부터 -끝- 까지의 원본 점검이력을 붙여넣으세요.",
  },
  "blank-report": {
    label: "AS",
    accent: BW_ACCENT,
    bgSoft: BW_SOFT,
    textDark: BW_TEXT,
    placeholder: "여기에 AS 접수내용을 붙여넣으세요.",
  },
  "air-purifier": {
    label: "청정기",
    accent: BW_ACCENT,
    bgSoft: BW_SOFT,
    textDark: BW_TEXT,
    placeholder: "여기에 공기청정기 점검이력 원본을 붙여넣으세요.",
  },
  "samsung-note": {
    label: "삼성노트",
    accent: BW_ACCENT,
    bgSoft: BW_SOFT,
    textDark: BW_TEXT,
    placeholder: "여기에 번호가 붙은 스케줄 원문을 여러 개 붙여넣으세요.",
  },
  pc: {
    label: "확장성",
    accent: BW_ACCENT,
    bgSoft: BW_SOFT,
    textDark: BW_TEXT,
    placeholder: "",
  },
  logistics: { label: "물류", accent: BW_ACCENT, bgSoft: BW_SOFT, textDark: BW_TEXT, placeholder: "" },
  bulman: { label: "불만", accent: BW_ACCENT, bgSoft: BW_SOFT, textDark: BW_TEXT, placeholder: "" },
  misu: { label: "미수", accent: BW_ACCENT, bgSoft: BW_SOFT, textDark: BW_TEXT, placeholder: "" },
  "overage-adjust": { label: "초과조정", accent: BW_ACCENT, bgSoft: BW_SOFT, textDark: BW_TEXT, placeholder: "" },
  recontract: { label: "재계약", accent: BW_ACCENT, bgSoft: BW_SOFT, textDark: BW_TEXT, placeholder: "" },
};

const ITEM_DIVIDER = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";
const SECTION_DIVIDER = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";

// ────────────────────────────────────────────────────────────────────────────
// Shared text utilities
// ────────────────────────────────────────────────────────────────────────────

// Recognizes divider lines made of ASCII `-`/`_`, ㅡ (U+3161, our new default for Samsung Notes safety),
// `═` (U+2550), and common Unicode dashes/box-drawing chars that appear when output is round-tripped
// through apps like Samsung Notes.
const DIVIDER_CHAR_CLASS = "[-_\\u3161\\u2550\\u2500\\u2501\\u23BC\\u2015\\u2014\\u2013]";
const DIVIDER_LINE_REGEX = new RegExp(`^\\s*${DIVIDER_CHAR_CLASS}{3,}\\s*$`);

function isDividerLine(line: string): boolean {
  return DIVIDER_LINE_REGEX.test(line);
}

function findLine(lines: string[], regex: RegExp): string | null {
  return lines.find((line: string) => regex.test(line)) || null;
}

function normalizeLabelSpacing(line: string): string {
  return line.replace(/^([^:]+):\s*/, "$1: ");
}

function collectMultilineField(
  cleaned: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[],
  normalizeFirst = true,
  breakOnNumberedItem = true
): string[] {
  const startIndex = cleaned.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const firstLine = normalizeFirst ? normalizeLabelSpacing(cleaned[startIndex]) : cleaned[startIndex];
  const collected: string[] = [firstLine];

  for (let i = startIndex + 1; i < cleaned.length; i += 1) {
    const nextLine = cleaned[i];
    if (stopRegex.test(nextLine)) break;
    if (breakOnNumberedItem && /^\d+\./.test(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function collectHeaderMultiline(
  lines: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[]
): string[] {
  const startIndex = lines.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const collected: string[] = [normalizeLabelSpacing(lines[startIndex])];

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const nextLine = lines[i];
    if (stopRegex.test(nextLine)) break;
    if (isDividerLine(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function buildItemTitleLine(cleaned: string[], blockIndex: number): string {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  // Location can sit on its own line(s) between the number and 모델명
  // (e.g. "1." then "3층"). Gather those non-field lines into the title.
  const gatherLoc = (startIdx: number): string => {
    if (modelIndex <= startIdx) return "";
    return cleaned
      .slice(startIdx, modelIndex)
      .filter((l: string) => l.trim() && !/:/.test(l))
      .join(" ")
      .trim();
  };

  // Preserve & normalize existing title (all legacy formats → N.)
  const titleMatch = firstLine.match(/^(?:(\d+)\.|\((\d+)\)|【(\d+)】)\s*(.*)$/);
  if (titleMatch) {
    const num = titleMatch[1] || titleMatch[2] || titleMatch[3];
    let rest = (titleMatch[4] || "").trim();
    const loc = gatherLoc(1);
    if (loc) rest = rest ? `${rest} ${loc}` : loc;
    return rest ? `${num}. ${rest}` : `${num}.`;
  }

  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) {
    return `${blockIndex + 1}. ${firstLine.trim()}`;
  }

  return `${blockIndex + 1}.`;
}

function stripConsumedTitleLine(cleaned: string[]): string[] {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  if (/^(?:\d+\.|\(\d+\)|【\d+】)/.test(firstLine)) return cleaned.slice(1);
  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) return cleaned.slice(1);

  return cleaned;
}

function splitItemBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isDividerLine(line)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    // 【N】 or 【N】 텍스트 also marks the start of a new item block
    if (/^【\d+】/.test(line.trim())) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      current.push(line);
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function extractHeader(headerLines: string[]): string[] {
  const gradeLines = collectHeaderMultiline(
    headerLines,
    /^등급\s*:/,
    /^(작성자|구분|레벨|업체명|부서명|지역|키맨\/접수자)\s*:/,
    ["등급:  "]
  );
  const companyLines = collectHeaderMultiline(
    headerLines,
    /^업체명\s*:/,
    /^(작성자|구분|레벨|등급|부서명|지역|키맨\/접수자)\s*:/,
    ["업체명: "]
  );
  const departmentLines = collectHeaderMultiline(
    headerLines,
    /^부서명\s*:/,
    /^(작성자|구분|레벨|등급|업체명|지역|키맨\/접수자)\s*:/,
    ["부서명: "]
  );
  const regionLines = collectHeaderMultiline(
    headerLines,
    /^지역\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|키맨\/접수자)\s*:/,
    ["지역: "]
  );
  const keymanLines = collectHeaderMultiline(
    headerLines,
    /^키맨\/접수자\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|지역)\s*:/,
    ["키맨/접수자:"]
  );

  return [
    "작성자: ",
    "구분: 점검",
    "레벨: 1",
    ...gradeLines,
    ...companyLines,
    ...departmentLines,
    ...regionLines,
    ...keymanLines,
  ];
}

function findPartsSectionEnd(bodyLines: string[]): number {
  const partsIndex = bodyLines.findIndex((line: string) => /^\s*※부품신청※\s*$/.test(line));
  const selfIndex = bodyLines.findIndex((line: string) => /^\s*※자가신청※\s*$/.test(line));
  const arrivalIndex = bodyLines.findIndex((line: string) => /^도착 시간\s*:/.test(line));
  const durationIndex = bodyLines.findIndex((line: string) => /^소요 시간\s*:/.test(line));

  let end = bodyLines.length;
  if (partsIndex >= 0) end = Math.min(end, partsIndex);
  if (selfIndex >= 0) end = Math.min(end, selfIndex);
  if (arrivalIndex >= 0) end = Math.min(end, arrivalIndex);
  if (durationIndex >= 0) end = Math.min(end, durationIndex);
  return end;
}

const STANDARD_PARTS_SECTION: string[] = [
  SECTION_DIVIDER,
  "※부품신청※",
  "보증기간 내 여부 : ",
  "교체 전 카운터 누적 사용매수 : ",
  "사용 부품 예상 사용매수 : ",
  "▶ 신청 부품",
  "물품명:",
  "수량:",
  "출고여부: ",
  SECTION_DIVIDER,
  "※자가신청※",
  "물품:",
  "수량:",
  "출고여부:",
  ITEM_DIVIDER,
  "도착 시간:",
  "소요 시간:",
];

// ────────────────────────────────────────────────────────────────────────────
// Mode 1: Inspection (점검이력 변환)
// ────────────────────────────────────────────────────────────────────────────

function collectExtraLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^여분\s*:/,
    /^(한틴이카유무|주차비지원유무|특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통)\s*:/,
    ["여분: K- C- M- Y- 폐- "]
  );
}

function collectNoteLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^특이사항\s*:/,
    /^(모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무)\s*:/,
    ["특이사항:"]
  );
}

function collectParkingLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^주차비지원유무\s*:/,
    /^(특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무)\s*:/,
    ["주차비지원유무: "]
  );
}

function normalizeInspectionItemBlock(blockLines: string[], blockIndex: number): string[] {
  const cleaned = blockLines
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line !== "" && !isDividerLine(line));

  if (cleaned.length === 0) return [];

  const titleLine = buildItemTitleLine(cleaned, blockIndex);
  const contentLines = stripConsumedTitleLine(cleaned);

  const modelLine = findLine(contentLines, /^모델명\s*:/);
  const serialLine = findLine(contentLines, /^시리얼넘버\s*:/);
  const assetLine = findLine(contentLines, /^자산기번\s*:/);
  const hantinLine = findLine(contentLines, /^한틴이카유무\s*:/) || "한틴이카유무:";
  const extraLines = collectExtraLines(contentLines);
  const parkingLines = collectParkingLines(contentLines);
  const noteLines = collectNoteLines(contentLines);

  return [
    titleLine,
    modelLine || "모델명:",
    serialLine || "시리얼넘버:",
    assetLine || "자산기번: ",
    "내용: 정기점검",
    "처리내용: 정기점검",
    "매수: 흑-    컬-    큰컬-    합-",
    "토너잔량:K-   C-   M-   Y-",
    "폐통:        %",
    ...extraLines,
    hantinLine,
    ...parkingLines,
    ...noteLines,
  ];
}

function transformInspectionText(input: string): string {
  if (!input || !input.trim()) return "";

  const lines = input.split(/\r?\n/);
  const firstDividerIndex = lines.findIndex((line: string) => isDividerLine(line));
  const itemStartIndex = firstDividerIndex >= 0 ? firstDividerIndex : lines.length;
  const headerLines = lines.slice(0, itemStartIndex);
  const bodyLines = lines.slice(itemStartIndex);

  const normalizedHeader = extractHeader(headerLines);
  const itemSectionEnd = findPartsSectionEnd(bodyLines);
  const rawItemSection = bodyLines.slice(0, itemSectionEnd);
  const itemBlocks = splitItemBlocks(rawItemSection);
  const normalizedItemSection: string[] = [];

  itemBlocks.forEach((block: string[], index: number) => {
    const normalizedBlock = normalizeInspectionItemBlock(block, index);
    if (normalizedBlock.length === 0) return;
    normalizedItemSection.push(ITEM_DIVIDER);
    normalizedItemSection.push(...normalizedBlock);
  });

  return [...normalizedHeader, ...normalizedItemSection, ...STANDARD_PARTS_SECTION].join("\n");
}

function collectAirPurifierNoteLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^특이사항\s*:/,
    /^(모델명|시리얼넘버|자산기번|내용|처리내용|필터리셋|필터교체)\s*:/,
    ["특이사항:"]
  );
}

function normalizeAirPurifierItemBlock(blockLines: string[], blockIndex: number): string[] {
  const cleaned = blockLines
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line !== "" && !isDividerLine(line));

  if (cleaned.length === 0) return [];

  const titleLine = buildItemTitleLine(cleaned, blockIndex);
  const contentLines = stripConsumedTitleLine(cleaned);

  const modelLine = findLine(contentLines, /^모델명\s*:/);
  const serialLine = findLine(contentLines, /^시리얼넘버\s*:/);
  const assetLine = findLine(contentLines, /^자산기번\s*:/);
  const filterResetLine = findLine(contentLines, /^필터리셋\s*:/) || "필터리셋:";
  const filterReplaceLine = findLine(contentLines, /^필터교체\s*:/) || "필터교체:";
  const noteLines = collectAirPurifierNoteLines(contentLines);

  return [
    titleLine,
    modelLine || "모델명:",
    serialLine || "시리얼넘버:",
    assetLine || "자산기번: ",
    "내용: 정기점검",
    "처리내용: 정기점검",
    filterResetLine,
    filterReplaceLine,
    ...noteLines,
  ];
}

function transformAirPurifierStructured(input: string): string {
  const lines = input.split(/\r?\n/);
  const firstDividerIndex = lines.findIndex((line: string) => isDividerLine(line));
  const itemStartIndex = firstDividerIndex >= 0 ? firstDividerIndex : lines.length;
  const headerLines = lines.slice(0, itemStartIndex);
  const bodyLines = lines.slice(itemStartIndex);

  const normalizedHeader = extractHeader(headerLines);
  const itemSectionEnd = findPartsSectionEnd(bodyLines);
  const rawItemSection = bodyLines.slice(0, itemSectionEnd);
  const itemBlocks = splitItemBlocks(rawItemSection);
  const normalizedItemSection: string[] = [];

  itemBlocks.forEach((block: string[], index: number) => {
    const normalizedBlock = normalizeAirPurifierItemBlock(block, index);
    if (normalizedBlock.length === 0) return;
    normalizedItemSection.push(ITEM_DIVIDER);
    normalizedItemSection.push(...normalizedBlock);
  });

  return [...normalizedHeader, ...normalizedItemSection, ...STANDARD_PARTS_SECTION].join("\n");
}

function buildAirPurifierFromFields(
  blockIndex: number,
  grade: string,
  company: string,
  department: string,
  keyman: string,
  model: string,
  serial: string,
  assetNumber: string
): string[] {
  const header = [
    "작성자: ",
    "구분: 점검",
    "레벨: 1",
    `등급: ${grade}`,
    `업체명: ${company}`,
    `부서명: ${department}`,
    "지역: C",
    `키맨/접수자:${keyman}`,
  ];

  const item = [
    ITEM_DIVIDER,
    `${blockIndex + 1}.`,
    `모델명: ${model}`,
    `시리얼넘버: ${serial}`,
    `자산기번: ${assetNumber}`,
    "내용: 정기점검",
    "처리내용: 정기점검",
    "필터리셋:",
    "필터교체:",
    "특이사항:",
  ];

  return [...header, ...item];
}

function buildAirPurifierFromCompact(input: string): string {
  const blocks = splitCompactBlocks(input);
  const sections: string[] = [];

  blocks.forEach((block: string[], index: number) => {
    if (block.length === 0) return;

    const gradeCompanyLine = block[0] || "";
    const modelSerialLine = block[1] || "";
    const addressLine = block[2] || "";
    const phoneLines = block.slice(3);

    const grade = extractGrade(gradeCompanyLine);
    const company = extractCompactCompany(gradeCompanyLine);
    const { model, serial } = parseCompactModelSerial(modelSerialLine);
    const department = extractDepartment(addressLine);
    const keymanSegments = phoneLines.flatMap((l: string) => splitPhoneLine(l));
    const keyman = keymanSegments.length > 0 ? keymanSegments.join("\n") : "";

    const out = buildAirPurifierFromFields(
      index,
      grade,
      company,
      department,
      keyman,
      model,
      serial,
      ""
    );

    if (index === 0) {
      sections.push(...out);
    } else {
      // subsequent blocks: repeat only item section (kept minimal — rare case)
      sections.push(...out);
    }
  });

  sections.push(...STANDARD_PARTS_SECTION);
  return sections.join("\n");
}

function buildAirPurifierFromTable(input: string): string {
  const rawText = input;
  const flatText = input.replace(/[\t\r]+/g, " ");

  const grade = extractGrade(flatText);
  const company = extractTableCompany(rawText);
  const department = extractDepartment(flatText);
  const keyman = extractTableKeyman(rawText);
  const tableMs = extractTableModelSerial(rawText);
  const fallbackMs = extractModelAndSerial(flatText);
  const ms: ModelSerial = {
    model: tableMs.model || fallbackMs.model,
    serial: tableMs.serial || fallbackMs.serial,
  };
  const assetNumber = extractAssetNumber(flatText);

  const out = buildAirPurifierFromFields(
    0,
    grade,
    company,
    department,
    keyman,
    ms.model,
    ms.serial,
    assetNumber
  );

  return [...out, ...STANDARD_PARTS_SECTION].join("\n");
}

function transformAirPurifierText(input: string): string {
  if (!input || !input.trim()) return "";

  const format = detectInputFormat(input);
  if (format === "compact") return buildAirPurifierFromCompact(input);
  if (format === "table") return buildAirPurifierFromTable(input);
  return transformAirPurifierStructured(input);
}

// ────────────────────────────────────────────────────────────────────────────
// Shared multi-format extractors (used by Air Purifier and Blank Report)
// ────────────────────────────────────────────────────────────────────────────

type InputFormat = "compact" | "structured" | "table";

function detectInputFormat(input: string): InputFormat {
  if (
    /기번\s+\S/.test(input) ||
    /접수자성함\s+\S/.test(input) ||
    /접수자연락처\s+\S/.test(input) ||
    /★?키맨성함\/번호\s+\S/.test(input) ||
    /자산번호\s+[A-Z]/.test(input)
  ) {
    return "table";
  }

  if (/^\s*구분\s*:/m.test(input) && /^\s*업체명\s*:/m.test(input)) {
    return "structured";
  }

  return "compact";
}

// Company extraction — handles "17S㈜프리즘산업-매월마감" or "31SS주식회사 에이피더핀..."
function extractCompactCompany(line: string): string {
  const match = line.match(
    /^\s*\d+(?:NN|SS|S|N|V)([^\n]*?)(?:분기마감|매월마감|매년마감|오픈\s*\d*시?반?|단순마감마감|단순마감|$)/
  );
  if (!match) return "";
  return match[1]
    .trim()
    .replace(/^㈜\s*/, "")
    .replace(/-\s*$/, "")
    .trim();
}

// Table-format company — preserves newlines inside quoted "19V...매월마감" blocks
function extractTableCompany(rawText: string): string {
  const stripMarks = (s: string): string =>
    s
      .replace(/^㈜\s*/, "")
      .replace(/\s*㈜\s*$/, "")
      .replace(/^\(주\)\s*/, "")
      .replace(/\s*\(주\)\s*$/, "")
      .trim();

  const quotedGradeMatch = rawText.match(
    /"\s*\d+(?:NN|SS|S|N|V)?\s*([\s\S]*?)\s*(?:분기마감|매월마감|매년마감)\s*"/
  );
  if (quotedGradeMatch) {
    return stripMarks(quotedGradeMatch[1].trim());
  }

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const gradeMatch = line.match(
      /^\s*\d+(?:NN|SS|S|N|V)([^\n]*?)(?:분기마감|매월마감|매년마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
    );
    if (gradeMatch) {
      return stripMarks(gradeMatch[1].trim().replace(/-\s*$/, ""));
    }
  }

  return stripMarks(extractCompanyForTemplate(rawText).replace(/-\s*$/, ""));
}

// Table-format model/serial — handles tab-separated "기종\tMODEL\t..." and "기번\t\"SERIAL\n..."
function extractTableModelSerial(rawText: string): ModelSerial {
  // Model: "기종" + tab/whitespace + value + (tab/newline/next-label)
  const modelMatch = rawText.match(
    /기종\s*[\t ]+\s*"?\s*([^\t\n"]+?)\s*(?:"|\t|\n|기기상태|접수분야|$)/
  );
  // Serial: "기번" + tab/whitespace + optional quote + alphanumeric (first line only)
  const serialMatch = rawText.match(/기번\s*[\t ]+\s*"?\s*([A-Z0-9-]+)/i);

  return {
    model: modelMatch ? modelMatch[1].trim() : "",
    serial: serialMatch ? serialMatch[1].trim() : "",
  };
}

// Table-format report type — reads 접수분야 field (handles 샘플전달, 점검, A/S, 여분요청, etc.)
function extractTableReportType(rawText: string): string {
  // Matches at line start OR after tab/space (since "접수유형 X 접수분야 Y" has both on same line)
  const match = rawText.match(/(?:^|[\t ])접수분야[\t ]+([^\t\n]+?)(?=[\t\n]|$)/);
  if (match) {
    const t = match[1].trim();
    if (t) return t;
  }
  return "";
}

// Table-format 상태 field — captures multi-line values, strips outer quotes,
// stops at next known field label at line start
function extractStatusTextFromRaw(rawText: string): string {
  const startMatch = rawText.match(/^\s*상태\s+/m);
  if (!startMatch) return "";

  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  const remaining = rawText.slice(startIdx);

  const boundaryMatch = remaining.match(
    /^\s*(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소|미수개월|한조\/틴텍코드|★?키맨성함\/번호|접수자성함|접수자연락처|일반전화|설치업체|기본임대료|방문주기|납품\/교체일|종료일|계약일|임대리스트순번|접수유형|접수분야|기번|장비소유주|확장성|교체일로부터|교체이력|사용개월|남은개월|평균임대료|유지보수업체)/m
  );

  const endIdx = boundaryMatch ? (boundaryMatch.index ?? remaining.length) : remaining.length;
  let value = remaining.slice(0, endIdx).trim();

  // Strip outer matching quotes (e.g., `" MA2101...\n...함"`)
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

// Table-format 지역 extraction — reads 방문담당자 value (e.g., "수도권A" → "A")
function extractTableRegion(rawText: string): string {
  const match = rawText.match(/방문담당자[\t ]+[^\t\n]*?([A-E])(?=[\t \n]|$)/);
  if (match) return match[1];
  return "";
}

// Compact model/serial: "샤오미 MI-AIR/318115/00036240" → model + (rest as serial)
function parseCompactModelSerial(line: string): ModelSerial {
  const trimmed = line.trim();
  const firstSlash = trimmed.indexOf("/");
  if (firstSlash < 0) return { model: trimmed, serial: "" };
  return {
    model: trimmed.slice(0, firstSlash).trim(),
    serial: trimmed.slice(firstSlash + 1).trim(),
  };
}

// Split phone line like "010-A 김/010-B 이 070-C 박" into one line per contact
function splitPhoneLine(rawLine: string): string[] {
  const segments = rawLine
    .split("/")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const seg of segments) {
    const phoneMatches = [...seg.matchAll(/\d{2,3}-?\d{3,4}-?\d{4}/g)];
    if (phoneMatches.length <= 1) {
      result.push(seg);
      continue;
    }
    for (let i = 0; i < phoneMatches.length; i += 1) {
      const start = phoneMatches[i].index ?? 0;
      const end =
        i + 1 < phoneMatches.length ? (phoneMatches[i + 1].index ?? seg.length) : seg.length;
      const piece = seg.slice(start, end).trim();
      if (piece) result.push(piece);
    }
  }
  return result;
}

// Table-format keyman: 접수자성함+접수자연락처 / 일반전화 / ★키맨성함·번호
function extractTableKeyman(rawText: string): string {
  const lines: string[] = [];

  // Use [\t ]+ instead of \s+ to stay within the same line (avoid swallowing newlines)
  const nameMatch = rawText.match(/접수자성함[\t ]+([^\n\t]+?)(?=[\t\n])/);
  const contactPhoneMatch = rawText.match(
    /접수자연락처[\t ]+(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );

  const name = nameMatch ? nameMatch[1].trim() : "";
  const phone = contactPhoneMatch ? contactPhoneMatch[1].trim() : "";

  if (name && phone) {
    lines.push(`${name} ${phone}`);
  } else if (phone) {
    lines.push(phone);
  } else if (name) {
    lines.push(name);
  }

  const landlineMatch = rawText.match(/일반전화\s+(0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/);
  if (landlineMatch) {
    lines.push(landlineMatch[1].trim());
  }

  // Quoted multi-line form: "010-... 이름\n010-..."
  const quotedKeymanMatch = rawText.match(/★?키맨성함\/번호\s*[\t ]+\s*"([\s\S]*?)"/);
  if (quotedKeymanMatch) {
    const inner = quotedKeymanMatch[1]
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    lines.push(...inner);
  } else {
    const keymanMatch = rawText.match(
      /★?키맨성함\/번호\s+([^\n\t]+?)(?=\s*(?:\n|\t|방문담당자|한조\/틴텍코드|주소|확장성|$))/
    );
    if (keymanMatch) {
      lines.push(keymanMatch[1].trim());
    }
  }

  if (lines.length === 0) {
    const fallback = extractPhonesWithContext(rawText);
    if (fallback) return fallback;
  }

  return lines.join("\n");
}

// One-line compact input decomposer — handles case where newlines were stripped.
// Uses landmarks (마감 keyword, first phone, first slash) to identify the 4 sections:
//   [grade+company+마감] [model/serial] [address] [phone(s)]
// Returns null if the input doesn't look like compact format or can't be confidently split.
function splitOneLineCompact(input: string): string[] | null {
  const closingKeywordMatch = input.match(
    /(분기마감|매월마감|매년마감|단순마감마감|단순마감|오픈\s*\d*시?반?)/
  );
  if (!closingKeywordMatch || closingKeywordMatch.index === undefined) return null;
  const sec1End = closingKeywordMatch.index + closingKeywordMatch[0].length;
  const sec1 = input.slice(0, sec1End);

  const rest = input.slice(sec1End);

  const phoneMatch = rest.match(/\d{2,3}-\d{3,4}-\d{4}/);
  if (!phoneMatch || phoneMatch.index === undefined) return null;
  const sec4Start = phoneMatch.index;
  const middle = rest.slice(0, sec4Start);
  const sec4 = rest.slice(sec4Start);

  // middle = [model/serial][address]. Must contain at least one '/'.
  const firstSlash = middle.indexOf("/");
  if (firstSlash < 0) return null;

  const after = middle.slice(firstSlash + 1);
  const addressStartRel = findAddressStart(after);
  if (addressStartRel < 0) return null;

  const serial = after.slice(0, addressStartRel).replace(/\s+$/, "");
  const address = after.slice(addressStartRel).trim();
  const sec2 = middle.slice(0, firstSlash) + "/" + serial;

  const sections = [sec1, sec2, address, sec4].map((s: string) => s.trim()).filter(Boolean);
  return sections.length >= 2 ? sections : null;
}

// Find where the address section begins within the "model/serial + address" blob.
// Picks the earliest plausible boundary from multiple hints:
//   - floor hint (\d+층 followed by space + 한글/괄호) — last 1-2 digits are the floor, rest is serial
//   - first 한글 character (serials don't contain 한글)
//   - opening parenthesis
//   - 지하/B+숫자+층
// Returns -1 if no boundary found.
function findAddressStart(after: string): number {
  const candidates: number[] = [];

  const floorMatch = after.match(/(\d+)층\s+[가-힣(]/);
  if (floorMatch && floorMatch.index !== undefined) {
    const digits = floorMatch[1];
    const floorLen = digits.length <= 2 ? digits.length : 1;
    candidates.push(floorMatch.index + (digits.length - floorLen));
  }

  const hangulMatch = after.match(/[가-힣]/);
  if (hangulMatch && hangulMatch.index !== undefined) {
    candidates.push(hangulMatch.index);
  }

  const parenMatch = after.match(/\(/);
  if (parenMatch && parenMatch.index !== undefined) {
    candidates.push(parenMatch.index);
  }

  const basementMatch = after.match(/지하\s*\d+층|B\d+층/);
  if (basementMatch && basementMatch.index !== undefined) {
    candidates.push(basementMatch.index);
  }

  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

// Split compact input block(s) — one block per 4-line group (company/model/address/phone)
function splitCompactBlocks(input: string): string[][] {
  const lines = input
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean);

  // Single-line input with newlines stripped — try to decompose via landmarks
  if (lines.length === 1) {
    const decomposed = splitOneLineCompact(lines[0]);
    if (decomposed && decomposed.length >= 3) {
      return [decomposed];
    }
  }

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    // Grade-company header marks start of a new block
    const isGradeCompanyLine = /^\s*\d+(?:NN|SS|S|N|V)[^0-9]/.test(line);
    if (isGradeCompanyLine && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  return blocks.length > 0 ? blocks : [lines];
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 3: Samsung Note Titles (삼성노트 제목 생성)
// ────────────────────────────────────────────────────────────────────────────

const SEOUL_DISTRICTS = [
  "송파구", "강남구", "서초구", "용산구", "성동구", "노원구", "은평구",
  "마포구", "종로구", "광진구", "동작구", "관악구", "구로구",
  "영등포구", "금천구", "동대문구", "서대문구", "도봉구", "강동구",
  "강북구", "양천구", "성북구", "중랑구",
];

const BUSINESS_SUFFIXES = [
  "학원", "교회", "의원", "치과", "병원", "약국", "법인", "회사",
  "디자인", "피앤씨", "기획", "팩토리", "코리아", "메디칼", "메디컬",
  "코스메틱", "바이오", "안전", "사이언스", "엔터테인먼트", "컴퍼니",
  "인터내셔널", "그룹", "연구소", "협회", "재단", "스튜디오",
];

const COMPANY_STOP_PATTERN = new RegExp(
  [
    "㈜",
    "\\(주\\)",
    "주식회사",
    "\\d+층",
    "\\d+호",
    "\\d+동",
    "[A-Z]{2,}",
    "빌딩",
    "타워",
    "분기마감",
    "매월마감",
    "매년마감",
    "단순마감마감",
    "단순마감",
    "전일연락필수",
    "준전일연락필수",
    "진성완료",
    "현장종료",
    "오픈\\s*\\d*시?반?",
    ">",
    "-",
    "본사",
    ...SEOUL_DISTRICTS,
  ].join("|")
);

function splitScheduleBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const lines = input.split(/\r?\n/).map((line: string) => line.trimEnd());
  const blocks: string[][] = [];
  let current: string[] = [];
  let expectedNextNumber: number | null = null;

  lines.forEach((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^#/.test(trimmed) && current.length === 0) return;

    const numberMatch = trimmed.match(/^(\d+)\./);
    if (numberMatch) {
      const num = parseInt(numberMatch[1], 10);

      if (expectedNextNumber === null) {
        if (current.length > 0) blocks.push(current);
        current = [trimmed];
        expectedNextNumber = num + 1;
        return;
      }

      if (num === expectedNextNumber) {
        if (current.length > 0) blocks.push(current);
        current = [trimmed];
        expectedNextNumber = num + 1;
        return;
      }
      // Non-sequential number = internal list item, fall through to treat as content
    }

    if (current.length === 0) return;
    current.push(trimmed);
  });

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function extractLocationLabel(lines: string[]): string {
  const joined = lines.join(" ");
  const basementFloorMatch = joined.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basementFloorMatch) return basementFloorMatch[1].replace(/\s+/g, "");
  const hoMatch = joined.match(/(\d+호)/);
  if (hoMatch) return hoMatch[1];
  const floorDotMatch = joined.match(/(\d+[·.]\d+층)/);
  if (floorDotMatch) {
    const parts = floorDotMatch[1].match(/\d+/g);
    if (parts && parts.length > 0) return `${parts[parts.length - 1]}층`;
  }
  const floorMatch = joined.match(/(\d+층)/);
  if (floorMatch) return floorMatch[1];
  const dongMatch = joined.match(/(\d+동)/);
  if (dongMatch) return dongMatch[1];
  return "미기재";
}

function extractCompanyBySuffixWord(line: string): string {
  const alternation = BUSINESS_SUFFIXES.join("|");
  const pattern = new RegExp(
    `([가-힣A-Za-z0-9]{2,}(?:${alternation}))(?=[^가-힣A-Za-z0-9]|$)`,
    "g"
  );
  const matches = [...line.matchAll(pattern)];
  for (const m of matches) {
    const candidate = m[1].trim();
    if (candidate.length >= 3 && candidate.length <= 30) return candidate;
  }
  return "";
}

function applyCompanyStop(raw: string): string {
  let result = raw.replace(/\([^)]*\)/g, "").replace(/^\d+\.\s*/, "").trim();
  const stopMatch = result.match(COMPANY_STOP_PATTERN);
  if (stopMatch && typeof stopMatch.index === "number" && stopMatch.index > 0) {
    result = result.slice(0, stopMatch.index);
  }
  return result.trim();
}

const KOREA_REGION_PATTERN =
  "서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주";

function extractCompanyBeforeModel(line: string): string {
  const pattern = new RegExp(
    `([가-힣][가-힣A-Za-z0-9]{1,})\\s+[A-Z][A-Za-z0-9,-]{2,}(?:\\([^)]*\\))?\\s*\\/\\s*(?:${KOREA_REGION_PATTERN})`
  );
  const m = line.match(pattern);
  if (m) {
    const candidate = m[1].trim();
    if (candidate.length >= 2 && candidate.length <= 30) return candidate;
  }
  return "";
}

function extractTaskFromBody(lines: string[]): string {
  const pattern = new RegExp(
    `(?:^|\\s)([가-힣]{2,}[가-힣A-Za-z0-9]*)\\s+[가-힣][가-힣A-Za-z0-9]+\\s+[A-Z][A-Za-z0-9,-]{2,}(?:\\([^)]*\\))?\\s*\\/\\s*(?:${KOREA_REGION_PATTERN})`
  );
  for (let i = 1; i < lines.length; i += 1) {
    const m = lines[i].match(pattern);
    if (m) {
      const task = m[1].trim();
      if (task.length >= 2 && task.length <= 20) return task;
    }
  }
  return "";
}

function extractCompanyFromBodyLine(line: string): string {
  if (!line) return "";

  let raw = line.trim();
  raw = raw.replace(/^"/, "").replace(/"$/, "");

  // Suffix form: "XXX㈜", "XXX주식회사", "XXX(주)"
  const suffixMatch = raw.match(
    /(?:^|\s|")\d*(?:NN|SS|S|N|V)?\s*([가-힣][가-힣0-9]{1,})(?:㈜|주식회사|\(주\))/
  );
  if (suffixMatch) return suffixMatch[1].trim();

  // Prefix form: "주식회사 XXX" or "㈜XXX"
  let afterAnchor: string | null = null;
  const jushikMatch = raw.match(/주식회사\s+(.+)/);
  if (jushikMatch) {
    afterAnchor = jushikMatch[1];
  } else {
    const juMatch = raw.match(/㈜\s*([가-힣A-Za-z0-9].+)/);
    if (juMatch) afterAnchor = juMatch[1];
  }

  // Grade-prefix anchor: "14SS광운", "30N코리움사이언스"
  if (!afterAnchor) {
    const gradeMatch = raw.match(
      /(?:^|\s|")\d*(?:NN|SS|S|N|V)\s*([가-힣][^\s].*)/
    );
    if (gradeMatch) afterAnchor = gradeMatch[1];
  }

  if (afterAnchor) {
    const result = applyCompanyStop(afterAnchor);
    if (result && /[가-힣]{2,}/.test(result)) return result;
  }

  // Model-based: "[company] [MODEL] / [region]"
  const beforeModel = extractCompanyBeforeModel(raw);
  if (beforeModel) return beforeModel;

  // Final fallback: suffix-word pattern (학원, 교회, 의원...)
  const suffixWord = extractCompanyBySuffixWord(raw);
  if (suffixWord) return suffixWord;

  return "";
}

function extractCompanyFromBody(lines: string[]): string {
  for (let i = 1; i < lines.length; i += 1) {
    const company = extractCompanyFromBodyLine(lines[i]);
    if (company && /[가-힣]{2,}/.test(company) && company.length <= 30) {
      return company;
    }
  }
  return "";
}

function companyWordOverlap(candidate: string, bodyText: string): boolean {
  if (!candidate || !bodyText) return false;
  const words = candidate
    .split(/\s+/)
    .filter((w: string) => w.length >= 2 && /[가-힣A-Za-z]/.test(w));
  if (words.length === 0) return false;
  return words.some((w: string) => bodyText.includes(w));
}

function extractScheduleSummary(lines: string[], scheduleIndex: number): ResultItem {
  const firstLineRaw = (lines[0] || "").trim();
  const firstLineContent = firstLineRaw.replace(/^\d+\.\s*/, "").trim();

  const slashIdx = firstLineContent.indexOf("/");
  let candidateCompany = "";
  let summaryAfterSlash = "";
  if (slashIdx > 0) {
    candidateCompany = firstLineContent.slice(0, slashIdx).trim();
    summaryAfterSlash = firstLineContent.slice(slashIdx + 1).trim();
  }

  const bodyText = lines.slice(1).join(" ");
  const bodyCompany = extractCompanyFromBody(lines);

  let company: string;
  let summary: string;

  if (candidateCompany && companyWordOverlap(candidateCompany, bodyText)) {
    // First-line "X" matches body content — it's a real company identifier
    company = candidateCompany;
    summary = summaryAfterSlash || firstLineContent || "점검";
  } else if (bodyCompany) {
    company = bodyCompany;
    const bodyTask = firstLineContent ? "" : extractTaskFromBody(lines);
    summary = firstLineContent || bodyTask || "점검";
  } else if (candidateCompany) {
    // No body confirmation but first line has slash — still use it
    company = candidateCompany;
    summary = summaryAfterSlash || "점검";
  } else {
    company = "미기재";
    summary = firstLineContent || "점검";
  }

  const location = extractLocationLabel(lines);
  const content = `${scheduleIndex + 1}/${company} ${location}/${summary}`;

  const warnings: string[] = [];
  if (company === "미기재") warnings.push("업체명 추출 실패");
  if (location === "미기재") warnings.push("위치 추출 실패");

  return {
    content,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function transformSamsungNoteTitles(input: string): ResultItem[] {
  const blocks = splitScheduleBlocks(input);
  return blocks.map((lines: string[], index: number) => extractScheduleSummary(lines, index));
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 4: Blank Report (미양식 → 빈 보고서 양식 생성)
// ────────────────────────────────────────────────────────────────────────────

function splitParagraphBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const normalized = input.trim();
  const explicitMultiBlocks = normalized
    .split(/\n\s*\n+/)
    .map((block: string) => block.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean))
    .filter((block: string[]) => block.length > 0);

  const hasNumberedSchedules = /^\d+\./m.test(normalized);
  const hasRepeatedTypeMarkers = (normalized.match(/(?:^|\n)(A\/S|여분요청|점검)\b/g) || []).length > 1;

  if (hasNumberedSchedules || hasRepeatedTypeMarkers) {
    return explicitMultiBlocks;
  }

  return [normalized.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean)];
}

function extractReportType(text: string): string {
  if (/여분요청/.test(text)) return "여분요청";
  if (/\bA\/S\b/.test(text)) return "A/S";
  return "점검";
}

function extractReportLevel(text: string, type: string): string {
  if (type === "점검") return "1";
  if (type === "A/S") {
    const match = text.match(/레벨\s*([123])/);
    return match ? match[1] : "";
  }
  return "";
}

function extractGrade(text: string): string {
  const tokenMatch = text.match(/(?:^|\s)(NN|SS|S|N|V)(?=\s|$)/);
  if (tokenMatch) return tokenMatch[1];
  const companyPrefixedMatch = text.match(/(?:^|\s)\d+(NN|SS|S|N|V)(?=[^A-Za-z0-9])/);
  if (companyPrefixedMatch) return companyPrefixedMatch[1];
  return "";
}

function extractCompanyForTemplate(text: string): string {
  const compact = text.replace(/\s+/g, " ");
  const quotedMatch = compact.match(
    /"\s*\d*(주식회사[^"]*?|법무법인[^"]*?|세무법인[^"]*?|[^"]*?(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))\s*(?:분기마감|매월마감|매년마감)/
  );
  if (quotedMatch) return quotedMatch[1].trim().replace(/-\s*$/, "");

  const companyAfterGradeMatch = compact.match(
    /(?:^|\s)\d+(NN|SS|S|N|V)([^\n]*?)(분기마감|매월마감|매년마감|오픈\s*\d*시?반?분기마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
  );
  if (companyAfterGradeMatch) {
    return companyAfterGradeMatch[2]
      .replace(/^\s*"/, "")
      .replace(/"\s*$/, "")
      .trim()
      .replace(/-\s*$/, "");
  }

  const fallback = compact.match(
    /(법무법인\s*[가-힣A-Za-z0-9\s]+|세무법인\s*[가-힣A-Za-z0-9\s]+|주식회사\s*[가-힣A-Za-z0-9\s]+|㈜\s*[가-힣A-Za-z0-9\s]+|[가-힣A-Za-z0-9\s]+(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))/
  );
  return fallback ? fallback[1].trim().replace(/-\s*$/, "") : "";
}

function extractDepartment(text: string): string {
  // Basement floors (지하1층, 지하 1층, B1층) take priority — must be checked
  // before the general \d+층 pattern which would only grab the trailing digit
  const basementMatch = text.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basementMatch) return basementMatch[1].replace(/\s+/g, "");

  // Prefer whitespace-anchored 1-2 digit floor: " 7층", " 11층"
  const spacedFloorMatch = text.match(/(?:^|\s)(\d{1,2})층/);
  if (spacedFloorMatch) return `${spacedFloorMatch[1]}층`;

  // Merged form like "107층" → typically building# + floor → take trailing digit
  const mergedFloorMatch = text.match(/(\d+)층/);
  if (mergedFloorMatch) {
    const num = mergedFloorMatch[1];
    if (num.length <= 2) return `${num}층`;
    return `${num.slice(-1)}층`;
  }

  const hoMatch = text.match(/(\d+호)/);
  if (hoMatch) return hoMatch[1];
  const suiteMatch = text.match(/상가\s*(\d+호)/);
  if (suiteMatch) return suiteMatch[1];
  return "";
}

const ADDRESS_START_PATTERN = new RegExp(
  `(?:^|\\s)(서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|${SEOUL_DISTRICTS.join("|")})\\s+`
);

function splitCompanyAddress(value: string): { company: string; address: string } {
  const raw = value.replace(/\s+/g, " ").trim();
  const match = raw.match(ADDRESS_START_PATTERN);
  if (!match || match.index === undefined || match.index <= 0) return { company: raw, address: "" };
  const company = raw.slice(0, match.index).replace(/\s*(?:주소|위치)\s*[:：]?\s*$/i, "").trim();
  const address = raw.slice(match.index).trim();
  return company ? { company, address } : { company: raw, address: "" };
}

function normalizeVisionInspectionText(text: string): string {
  const lines = text.split("\n");
  const companyIndex = lines.findIndex((line) => /^업체명\s*[:：]/.test(line));
  const departmentIndex = lines.findIndex((line) => /^부서명\s*[:：]/.test(line));
  if (companyIndex < 0) return text;

  const companyValue = parseValueAfterColon(lines[companyIndex], "업체명");
  const split = splitCompanyAddress(companyValue);
  if (split.company !== companyValue) lines[companyIndex] = `업체명: ${split.company}`;

  if (departmentIndex >= 0) {
    const currentDepartment = parseValueAfterColon(lines[departmentIndex], "부서명");
    const inferredDepartment = currentDepartment || extractDepartment(`${split.address} ${companyValue}`);
    if (inferredDepartment) lines[departmentIndex] = `부서명: ${inferredDepartment}`;
  }

  return lines.join("\n");
}

function extractPhonesWithContext(text: string): string {
  const contactNameMatch = text.match(
    /접수자성함\s*([^\n]+?)\s+접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactNameMatch) return `${contactNameMatch[1].trim()} ${contactNameMatch[2].trim()}`;

  const contactPhoneOnlyMatch = text.match(
    /접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactPhoneOnlyMatch) return contactPhoneOnlyMatch[1].trim();

  const genericContactBlockMatch = text.match(/연락처\s+(01\d[- ]?\d{3,4}[- ]?\d{4})\s*([^\n]*)/);
  if (genericContactBlockMatch) {
    const phone = genericContactBlockMatch[1].trim();
    const name = (genericContactBlockMatch[2] || "").trim();
    return name ? `${phone} ${name}` : phone;
  }

  return "";
}

function extractModelAndSerial(text: string): ModelSerial {
  const modelMatch = text.match(
    /기종\s+((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-|[A-Za-z가-힣0-9][A-Za-z가-힣0-9._-]{1,})[^\s\n]*)/i
  );
  const serialMatch = text.match(/(?:기번|시리얼넘버)\s+([A-Z0-9-]+)/i);
  if (modelMatch || serialMatch) {
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      serial: serialMatch ? serialMatch[1].trim() : "",
    };
  }

  const slashMatch = text.match(
    /((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-)[^/\n\s]*)\s*\/\s*([A-Z0-9-]+)/i
  );
  if (slashMatch) return { model: slashMatch[1].trim(), serial: slashMatch[2].trim() };

  const genericSlashLineMatch = text.match(
    /(?:^|\n|\s)(?!한조\/틴텍코드)([A-Za-z가-힣][A-Za-z가-힣0-9._-]{1,})\s*\/\s*([A-Z0-9-]{6,})(?=\s|$)/
  );
  if (genericSlashLineMatch) {
    return { model: genericSlashLineMatch[1].trim(), serial: genericSlashLineMatch[2].trim() };
  }

  return { model: "", serial: "" };
}

function extractAssetNumber(text: string): string {
  const match = text.match(/자산번호\s+([A-Z]\d+)/i);
  return match ? match[1].trim() : "";
}

function extractStatusText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const quotedStatusMatch = normalized.match(
    /(?:^|\s)상태\s+"\s*([\s\S]*?)\s*"(?=\s+(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  if (quotedStatusMatch) return quotedStatusMatch[1].trim();
  const plainStatusMatch = normalized.match(
    /(?:^|\s)상태\s+(.*?)(?=\s+(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  if (plainStatusMatch) return plainStatusMatch[1].trim();
  return "";
}

function extractTitleText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const titleMatch = normalized.match(
    /제목\s+(.*?)(?=\s+(?:상태|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  return titleMatch ? titleMatch[1].trim() : "";
}

function extractTemplateContent(text: string, type: string): string {
  if (type === "여분요청") return extractStatusText(text) || extractTitleText(text) || "";
  if (type === "A/S") return extractStatusText(text) || extractTitleText(text) || "";
  return "정기점검";
}

function extractTemplateProcessContent(_text: string, type: string): string {
  if (type === "점검") return "정기점검";
  return "";
}

type PrinterReportFields = {
  type: string;
  level: string;
  grade: string;
  company: string;
  department: string;
  region: string;
  keyman: string;
  model: string;
  serial: string;
  assetNumber: string;
  content: string;
  processContent: string;
};

function formatPrinterReport(f: PrinterReportFields): string {
  return [
    "작성자:",
    `구분:${f.type}`,
    `레벨:${f.level}`,
    `등급:${f.grade}`,
    `업체명:${f.company}`,
    `부서명:${f.department}`,
    `지역:${f.region}`,
    `키맨/접수자:${f.keyman}`,
    ITEM_DIVIDER,
    "1.",
    `모델명:${f.model}`,
    `시리얼넘버:${f.serial}`,
    `자산기번: ${f.assetNumber}`,
    `내용: ${f.content}`,
    `처리내용:${f.processContent ? ` ${f.processContent}` : ""}`,
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분:  K- C- M- Y- 폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    "특이사항:",
    SECTION_DIVIDER,
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    SECTION_DIVIDER,
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    ITEM_DIVIDER,
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}

function buildBlankReportCompact(blockLines: string[]): ResultItem {
  const gradeCompanyLine = blockLines[0] || "";
  const modelSerialLine = blockLines[1] || "";
  const addressLine = blockLines[2] || "";
  const phoneLines = blockLines.slice(3);

  const grade = extractGrade(gradeCompanyLine);
  const company = extractCompactCompany(gradeCompanyLine);
  const { model, serial } = parseCompactModelSerial(modelSerialLine);
  const department = extractDepartment(addressLine);
  const keymanSegments = phoneLines.flatMap((l: string) => splitPhoneLine(l));
  const keyman = keymanSegments.join("\n");

  const body = formatPrinterReport({
    type: "점검",
    level: "1",
    grade,
    company,
    department,
    region: "C",
    keyman,
    model,
    serial,
    assetNumber: "",
    content: "정기점검",
    processContent: "정기점검",
  });

  const warnings: string[] = [];
  if (!company) warnings.push("업체명 추출 실패");
  if (!model && !serial) warnings.push("모델/시리얼 추출 실패");
  if (!keyman) warnings.push("연락처 추출 실패");

  return {
    content: body,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function buildBlankReport(blockLines: string[]): ResultItem {
  const rawText = blockLines.join("\n");
  const flatText = blockLines.join(" ");
  const format = detectInputFormat(rawText);

  // Type: table format prefers 접수분야 field (handles 샘플전달, 점검, A/S, 여분요청...)
  const tableType = format === "table" ? extractTableReportType(rawText) : "";
  const type = tableType || extractReportType(flatText);

  const level = extractReportLevel(flatText, type);
  const grade = extractGrade(flatText);
  const company =
    format === "table" ? extractTableCompany(rawText) : extractCompanyForTemplate(flatText);
  const department = extractDepartment(flatText);
  const keyman =
    format === "table" ? extractTableKeyman(rawText) : extractPhonesWithContext(flatText);
  const ms: ModelSerial = (() => {
    if (format === "table") {
      const table = extractTableModelSerial(rawText);
      const fallback = extractModelAndSerial(flatText);
      return {
        model: table.model || fallback.model,
        serial: table.serial || fallback.serial,
      };
    }
    return extractModelAndSerial(flatText);
  })();
  const assetNumber = extractAssetNumber(flatText);

  // Region: table format reads 방문담당자 (수도권A/B/C/D/E), defaults to C
  const region = format === "table" ? extractTableRegion(rawText) || "C" : "C";

  // Content: table format prefers 상태 field (multi-line, quote-stripped).
  // If 상태 has a value, use it and leave 처리내용 blank; otherwise fall back to defaults.
  let content: string;
  let processContent: string;
  if (format === "table") {
    const status = extractStatusTextFromRaw(rawText);
    if (status) {
      content = status;
      processContent = "";
    } else {
      content = extractTemplateContent(flatText, type);
      processContent = extractTemplateProcessContent(flatText, type);
    }
  } else {
    content = extractTemplateContent(flatText, type);
    processContent = extractTemplateProcessContent(flatText, type);
  }

  const body = formatPrinterReport({
    type,
    level,
    grade,
    company,
    department,
    region,
    keyman,
    model: ms.model,
    serial: ms.serial,
    assetNumber,
    content,
    processContent,
  });

  const warnings: string[] = [];
  if (!company) warnings.push("업체명 추출 실패");
  if (!ms.model && !ms.serial) warnings.push("모델/시리얼 추출 실패");
  if (!keyman) warnings.push("연락처 추출 실패");

  return {
    content: body,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function transformBlankReports(input: string): ResultItem[] {
  if (!input || !input.trim()) return [];

  const format = detectInputFormat(input);
  if (format === "compact") {
    const blocks = splitCompactBlocks(input);
    return blocks.map((block: string[]) => buildBlankReportCompact(block));
  }

  const blocks = splitParagraphBlocks(input);
  return blocks.map((block: string[]) => buildBlankReport(block));
}

// ────────────────────────────────────────────────────────────────────────────
// Clipboard utilities
// ────────────────────────────────────────────────────────────────────────────

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

async function copyTextToClipboard(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, message: "복사할 내용이 없습니다." };

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, message: "복사 완료" };
    } catch {
      const fallbackSucceeded = copyTextFallback(text);
      if (fallbackSucceeded) return { ok: true, message: "복사 완료" };
      return { ok: false, message: "복사가 차단되었습니다. 직접 선택해 복사해 주세요." };
    }
  }

  const fallbackSucceeded = copyTextFallback(text);
  if (fallbackSucceeded) return { ok: true, message: "복사 완료" };
  return { ok: false, message: "복사가 차단되었습니다. 직접 선택해 복사해 주세요." };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests (DEV only)
// ────────────────────────────────────────────────────────────────────────────

const TEST_CASES: TestCase[] = [
  {
    name: "업체명 여러 줄 유지",
    input: "업체명: 주식회사 필립오토서비스\n부가설명 한 줄 더\n부서명: 303호\n-------------------------------------",
    expected: "부가설명 한 줄 더",
    mode: "inspection",
  },
  {
    name: "주차비지원유무 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n주차비지원유무 : 주차하려했으나 발렛 5천원\n다음 방문시 공용주차 요청\n특이사항: 테스트",
    expected: "다음 방문시 공용주차 요청",
    mode: "inspection",
  },
  {
    name: "특이사항 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n특이사항: 첫줄\n둘째줄\n셋째줄",
    expected: "셋째줄",
    mode: "inspection",
  },
  {
    name: "위치 제목 자동 번호 부여",
    input: "-------------------------------------\n15층입구\n모델명: D470\n시리얼넘버: 809150608947",
    expected: "1. 15층입구",
    mode: "inspection",
  },
  {
    name: "청정기 필터리셋 필드 유지",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n자산기번: X7505\n내용: 정기점검\n처리내용: 필터 청소\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    expected: "필터리셋:유",
    mode: "air-purifier",
  },
  {
    name: "청정기 필터교체 필드 유지",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n자산기번: X7505\n내용: 정기점검\n처리내용: 필터 청소\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    expected: "필터교체:무",
    mode: "air-purifier",
  },
  {
    name: "청정기 매수/토너 필드 제외",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    mode: "air-purifier",
    expected: "※부품신청※",
  },
  {
    name: "삼성노트 업체명 추출 실패 경고",
    input: "1.점검\n알수없는텍스트\n010-1234-5678",
    expected: "미기재",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 첫줄 X/Y + 바디 매칭 (올리브인터내셔널)",
    input: "1.올리브인터내셔널/모니터 전달\nAS    SS   PC모니터  비용 180,000원 안내완료   주식회사 올리브인터내셔널 AK빌딩 4층\n자산번호   S0378   시리얼번호\n접수자성함연락처   김종현 담당자님 010-7456-5416\n서울 강남구 논현로79길 12 (역삼동) AK빌딩 4층 (엘베 유)",
    expected: "1/올리브인터내셔널 4층/모니터 전달",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 내부 번호리스트 제외 (알스퀘어)",
    input: "2.알스퀘어 신한리츠운용/랜선2개\n5.알스퀘어디자인-신한리츠운용 그레이츠강남\n6. 성함 : 천명규 책임 / 010-6210-8679\n7. 주소(엘리베이터 유무) :서울 서초구 서초동 1321-11 그레이츠강남 1층",
    expected: "1/알스퀘어 신한리츠운용 1층/랜선2개",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 첫줄 슬래시는 태스크 (블레이드)",
    input: "3.블레이드/k드럼 분해PM\nA/S N ECOSYS-MA2100CFX \"4N주식회사 그리드엔터테인먼트-전 주식회사 일삼일 /\n기번   WDM4302486   자산번호   B7749\n접수자성함   서유나\n접수자연락처   010-5018-0906\n주소   서울 강남구 논현로155길 31   확장성",
    expected: "1/그리드엔터테인먼트 미기재/블레이드/k드럼 분해PM",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 구(區) 표기 정리 (광운)",
    input: "4.1대\n14SS주식회사 광운송파구 > 강남구분기마감\nD450/800140653219\n서울 강남구 도산대로 159\n춘곡빌딩 (춘곡빌딩, 서울 강남구 신사동 561-30)",
    expected: "1/광운 미기재/1대",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 빈 첫줄은 점검 (팬틱스)",
    input: "5.\n4NN주식회사 팬틱스-전 주식회사 컨셉케이컴퍼니분기마감\nApeosPort-C2060/513194\n서울 강남구 도산대로12길 25-1\n2층 엘베o 엘베는 3층(특이사항: 엘리베이터는 3층으로 내려야함) (서울 강남구 논현동 11-19)\n010-9119-3335 대표님 김수민 010-4893-3286(결제 키)",
    expected: "1/팬틱스 2층/점검",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 ㈜ 접미형 (신우개발)",
    input: "6.9대\n25V신우개발㈜3층 매월마감\nAPEOS-C5570/175219\n서울 서초구 바우뫼로 198\n- (신우빌딩, 서울 서초구 양재동 82-7)",
    expected: "1/신우개발 3층/9대",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 6건 일괄 처리 순차 번호",
    input: "1.올리브인터내셔널/모니터 전달\n주식회사 올리브인터내셔널 AK빌딩 4층\n2.알스퀘어 신한리츠운용/랜선2개\n5.알스퀘어디자인-신한리츠운용 그레이츠강남\n7. 주소 서울 서초구 1층\n3.블레이드/k드럼 분해PM\nN ECOSYS \"4N주식회사 그리드엔터테인먼트-전 주식회사\n4.1대\n14SS주식회사 광운송파구 > 강남구분기마감\n5.\n4NN주식회사 팬틱스-전 주식회사 분기마감\n2층\n6.9대\n25V신우개발㈜3층",
    expected: "6/신우개발 3층/9대",
    mode: "samsung-note",
  },
  {
    name: "청정기 compact 입력 - 등급/업체명/부서명",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층 프리즘산업 (프리즘빌딩, 서울 강남구 역삼동 736-35)\n010-9312-7412 이영선/010-9312-7412 이영선",
    expected: "업체명: 프리즘산업",
    mode: "air-purifier",
  },
  {
    name: "청정기 compact 입력 - 부서명 107층 → 7층",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층 프리즘산업\n010-9312-7412 이영선",
    expected: "부서명: 7층",
    mode: "air-purifier",
  },
  {
    name: "청정기 compact 입력 - 모델/시리얼 슬래시 분리",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층\n010-9312-7412 이영선",
    expected: "시리얼넘버: 318115/00036240",
    mode: "air-purifier",
  },
  {
    name: "미양식 compact 입력 - 주식회사 유지",
    input:
      "31SS주식회사 에이피더핀(AP The Fin Inc)중앙쪽매월마감\nECOSYS-M5521CDN/VUY2Z03481\n서울 강남구 테헤란로 218에이피타워 11층 (AP Tower)\n010-6822-9591/070-4850-8726 이수민선임 010-8131-1966 이세희선임(경영지원)",
    expected: "업체명:주식회사 에이피더핀(AP The Fin Inc)중앙쪽",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 입력 - 키맨 여러 전화번호 분리",
    input:
      "31SS주식회사 에이피더핀매월마감\nECOSYS-M5521CDN/VUY2Z03481\n서울 강남구 11층\n010-6822-9591/070-4850-8726 이수민선임 010-8131-1966 이세희선임(경영지원)",
    expected: "010-8131-1966 이세희선임(경영지원)",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 업체명 여러 줄 유지",
    input:
      'A/S\tV\tApeosPort-VI C3371(베니)\t"19V엔티에스케이투\nK2 성수 2층 CS팀-문서용매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n일반전화\t02-3408-8507\n★키맨성함/번호\t양명호 차장 010-6314-7409\n기종\tApeosPort-VI C3371(베니)\t기기상태\t확인요망\n상태\t출력시 묻어나옴',
    expected: "K2 성수 2층 CS팀-문서용",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 모델명 전체 추출",
    input:
      'A/S\tV\tApeosPort-VI C3371(베니)\t"19V엔티에스케이투\nK2 성수 2층 CS팀-문서용매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686\n기종\tApeosPort-VI C3371(베니)\t기기상태\t확인요망',
    expected: "모델명:ApeosPort-VI C3371(베니)",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 시리얼 인용구 내부 추출",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686',
    expected: "시리얼넘버:665941",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 키맨 3줄 (접수자/일반/★키맨)",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n일반전화\t02-3408-8507\n★키맨성함/번호\t양명호 차장 010-6314-7409',
    expected: "02-3408-8507",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 내용이 참고사항까지 넘치지 않음",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n제목\t출력시 묻어나옴\n상태\t출력시 묻어나옴\n참고사항\t" [AS 히스토리 요약]\n📊 총 접수 건수: 3건\n✅ 특이사항 없음"',
    expected: "내용: 출력시 묻어나옴\n처리내용:",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 접수분야가 샘플전달이면 구분도 샘플전달",
    input:
      '샘플전달\tN\tES5473\t"15N브루니아단순마감"\n접수유형\t전화\t접수분야\t샘플전달\n기번\tAK96006517',
    expected: "구분:샘플전달",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 점검 타입이어도 상태값 있으면 내용에 사용",
    input:
      '점검\tN\t모델\t"19N회사단순마감"\n기번\tXYZ123\t자산번호\tA1\n접수유형\t카카오\t접수분야\t점검\n상태\t실제 문제 증상\n참고사항\t" 뭐라뭐라 "',
    expected: "내용: 실제 문제 증상\n처리내용:",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 키맨 따옴표 다중라인 (분리)",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t\n접수자연락처\t010-1111-2222\n★키맨성함/번호\t"010-3333-4444 대표님\n010-5555-6666"\n방문담당자\t수도권C',
    expected: "010-5555-6666",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 업체명 끝 ㈜ 제거",
    input:
      "점검    N   MFC-L5700DN   19N동영공예품㈜-단순마감마감\n접수분야   점검\n기번   E7671",
    expected: "업체명:동영공예품",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 수도권A → 지역:A",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222\n방문담당자\t수도권A',
    expected: "지역:A",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 수도권E → 지역:E",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222\n방문담당자\t수도권E',
    expected: "지역:E",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 없으면 기본 지역:C",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222',
    expected: "지역:C",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 한 줄 입력 - 시리얼 끝 자리 누락 안됨",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업 (프리즘빌딩, 서울 강남구 역삼동 736-35)010-9312-7412 이영선/",
    expected: "시리얼넘버:318115/00036240",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 한 줄 입력 - 부서명 정상 추출",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업010-9312-7412 이영선",
    expected: "부서명:7층",
    mode: "blank-report",
  },
  {
    name: "청정기 compact 한 줄 입력 - 모델/시리얼 분리",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업010-9312-7412 이영선",
    expected: "시리얼넘버: 318115/00036240",
    mode: "air-purifier",
  },
  {
    name: "compact 한 줄 입력 - 2자리 층 (AP The Fin)",
    input:
      "31SS주식회사 에이피더핀매월마감ECOSYS-M5521CDN/VUY2Z03481서울 강남구 테헤란로 218에이피타워 11층 (AP Tower)010-6822-9591",
    expected: "부서명:11층",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 지하1층 주소 (지하1층으로 추출)",
    input:
      'A/S\tV\t모델\t"19V회사단순마감"\n기번\tX1\t자산번호\tA1\n접수자연락처\t010-1111-2222\n주소\t서울 성북구 종암로36길 52, 하월곡아남아파트 102동 9호10호 지하 1층 관리사무소',
    expected: "부서명:지하1층",
    mode: "blank-report",
  },
  {
    name: "미양식 table - B1층 패턴도 지하층으로 인식",
    input:
      'A/S\tV\t모델\t"19V회사단순마감"\n기번\tX1\t자산번호\tA1\n접수자연락처\t010-1111-2222\n주소\t서울 강남구 테헤란로 123 B1층 기계실',
    expected: "부서명:B1층",
    mode: "blank-report",
  },
  {
    name: "복사 함수 준비",
    input: "noop",
    expectedFunction: true,
    mode: "shared",
  },
];

function runSelfTests(): TestResult[] {
  return TEST_CASES.map((test: TestCase) => {
    if (test.expectedFunction) {
      const passed = typeof copyTextToClipboard === "function" && typeof copyTextFallback === "function";
      return { ...test, passed, actual: passed ? "function ready" : "missing function" };
    }

    let actual = "";
    if (test.mode === "samsung-note") {
      actual = transformSamsungNoteTitles(test.input).map((r: ResultItem) => r.content).join("\n");
    } else if (test.mode === "blank-report") {
      actual = transformBlankReports(test.input).map((r: ResultItem) => r.content).join("\n");
    } else if (test.mode === "air-purifier") {
      actual = transformAirPurifierText(test.input);
    } else {
      actual = transformInspectionText(test.input);
    }

    return {
      ...test,
      passed: typeof test.expected === "string" ? actual.includes(test.expected) : false,
      actual,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Processing form (미양식 mode) — manual entry for printer service details
// ────────────────────────────────────────────────────────────────────────────

type PerItemForm = {
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

const EMPTY_ITEM_FORM: PerItemForm = {
  model: "", serial: "", asset: "", content: "",
  processContent: "",
  mailBlack: "", mailColor: "", mailLargeColor: "", mailTotal: "",
  tonerK: "", tonerC: "", tonerM: "", tonerY: "",
  waste: "",
  spareRaw: "",
  hantin: "",
  parking: "",
  notes: "",
};

type SharedForm = {
  level: string;
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

const EMPTY_SHARED_FORM: SharedForm = {
  level: "",
  warranty: "", cumCount: "", expectedCount: "",
  partName: "", partQty: "", partShipped: "",
  selfItem: "", selfQty: "", selfShipped: "",
  arrivalHour: "", arrivalMinute: "", duration: "",
};
const FIXED_INSPECTION_LEVEL = "1";
const FIXED_INSPECTION_REPORT_TYPES = ["점검"];

type AirPurifierForm = {
  filterReset: string;
  filterChange: string;
  notes: string;
  arrivalHour: string;
  arrivalMinute: string;
  duration: string;
};

const EMPTY_AIR_FORM: AirPurifierForm = {
  filterReset: "",
  filterChange: "",
  notes: "",
  arrivalHour: "",
  arrivalMinute: "",
  duration: "",
};

function suffixIfValue(label: string, v: string): string {
  return v.trim() ? `${label} ${v.trim()}` : label;
}

function normToken(s: string): string {
  return s === "-" ? "" : s;
}

function dashIfEmpty(s: string): string {
  return s.trim() ? s.trim() : "-";
}

function applyReportTypeSelection(text: string, selected: string[], other: string): string {
  if (!selected.length) return text;
  const values = selected.map((v) => v === "기타" ? other.trim() : v).filter(Boolean).join(", ");
  return /^구분\s*[:：]/m.test(text) ? text.replace(/^구분\s*[:：]\s*.*$/gm, `구분: ${values}`) : `구분: ${values}\n${text}`;
}

function detectUnifiedInputMode(text: string): "inspection" | "blank-report" {
  const raw = String(text || "");
  const intakeMarkers = ["접수분야", "접수유형", "임대리스트순번", "방문담당자", "AS접수횟수", "자가사용내역"];
  const markerCount = intakeMarkers.filter((marker) => raw.includes(marker)).length;
  if (markerCount >= 2) return "blank-report";
  const first = raw.trim().split(/\r?\n/)[0] || "";
  if (/^(?:A\s*\/?\s*S|여분요청|샘플전달|자가요청)\b/i.test(first)) return "blank-report";
  return "inspection";
}

function detectReportTypesFromInput(text: string): string[] {
  const raw = String(text || "");
  const field = raw.match(/(?:접수분야|구분)\s*[:：\t ]+\s*([^\t\r\n]+)/i)?.[1] || raw.trim().split(/\s+/)[0] || "";
  const found: string[] = [];
  if (/점검/.test(field)) found.push("점검");
  if (/A\s*\/?\s*S|에이에스/i.test(field)) found.push("AS");
  if (/마감/.test(field)) found.push("마감");
  if (/여분/.test(field)) found.push("여분");
  if (/세팅|셋팅/.test(field)) found.push("세팅");
  return found;
}

// Parses an existing "매수:흑X 컬X 큰컬X 합X" line into its 4 values
function parseMail(line: string): { black: string; color: string; largeColor: string; total: string } {
  const m = line.match(/^매수\s*:\s*흑(\S*)\s*컬(\S*)\s*큰컬(\S*)\s*합(\S*)/);
  if (!m) return { black: "", color: "", largeColor: "", total: "" };
  return { black: normToken(m[1]), color: normToken(m[2]), largeColor: normToken(m[3]), total: normToken(m[4]) };
}

function parseToner(line: string): { K: string; C: string; M: string; Y: string } {
  const m = line.match(/^토너잔량\s*:\s*K(\S*)\s+C(\S*)\s+M(\S*)\s+Y(\S*)/);
  if (!m) return { K: "", C: "", M: "", Y: "" };
  return { K: normToken(m[1]), C: normToken(m[2]), M: normToken(m[3]), Y: normToken(m[4]) };
}

function parseValueAfterColon(line: string, label: string): string {
  const re = new RegExp(`^${label}\\s*:\\s*(.*)$`);
  const m = line.match(re);
  return m ? m[1].trim() : "";
}

function mergeMailLine(line: string, f: PerItemForm): string {
  const formHasAny = !!(f.mailBlack.trim() || f.mailColor.trim() || f.mailLargeColor.trim() || f.mailTotal.trim());
  if (!formHasAny) return line;
  const p = parseMail(line);
  const black = f.mailBlack.trim() || p.black;
  const color = f.mailColor.trim() || p.color;
  const large = f.mailLargeColor.trim() || p.largeColor;
  const total = f.mailTotal.trim() || p.total;
  return `매수:흑${dashIfEmpty(black)} 컬${dashIfEmpty(color)} 큰컬${dashIfEmpty(large)} 합${dashIfEmpty(total)}`;
}

function mergeTonerLine(line: string, f: PerItemForm): string {
  const formHasAny = !!(f.tonerK.trim() || f.tonerC.trim() || f.tonerM.trim() || f.tonerY.trim());
  if (!formHasAny) return line;
  const p = parseToner(line);
  const K = f.tonerK.trim() || p.K;
  const C = f.tonerC.trim() || p.C;
  const M = f.tonerM.trim() || p.M;
  const Y = f.tonerY.trim() || p.Y;
  return `토너잔량:K${dashIfEmpty(K)} C${dashIfEmpty(C)} M${dashIfEmpty(M)} Y${dashIfEmpty(Y)}`;
}

function mergeWasteLine(line: string, f: PerItemForm): string {
  if (!f.waste.trim()) return line;
  return `폐통: ${f.waste.trim()}%`;
}

// 여분 is kept as free text (the user edits the original directly), so it
// renders straight from the stored raw string. Multi-line notes are joined
// with newlines and emitted as-is.
function renderSpareLine(f: PerItemForm): string {
  const raw = f.spareRaw.replace(/\s+$/, "");
  return raw ? `여분: ${raw.replace(/^\s+/, "")}` : "여분:";
}

type SpareToken = "K" | "C" | "M" | "Y" | "폐" | "드럼";
const SPARE_TOKENS: SpareToken[] = ["K", "C", "M", "Y", "폐", "드럼"];
function spareTokenRegex(token: SpareToken): RegExp {
  const name = token === "폐" ? "폐(?:통)?" : token;
  // K2C2M2Y2처럼 붙여 쓰는 경우 다음 토큰 앞의 이전 숫자도 경계로 인정한다.
  const prefix = token.length === 1 ? "(^|[\\s\\n,;/]|\\d)" : "(^|[\\s\\n,;/])";
  // K-2는 수량 2, K-처럼 숫자가 없는 하이픈은 미입력으로 구분한다.
  return new RegExp(`${prefix}(${name})\\s*[:=]?\\s*(-\\s*\\d+|\\d+|-)`, token.length === 1 ? "i" : "");
}
function groupedSpareTokenCount(raw: string, token: SpareToken): number | null {
  if (!(["K", "C", "M", "Y"] as SpareToken[]).includes(token)) return null;
  const tonerSet = raw.match(/(?:컬러\s*)?토너\s*[-:=]?\s*(\d+)\s*(?:세트|set)/i);
  if (tonerSet) return Number(tonerSet[1]);
  const allColor = raw.match(/(?:KCMY|CMYK)\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/i);
  if (allColor) return Number(allColor[1]);
  const cmy = raw.match(/CMY\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/i);
  return token !== "K" && cmy ? Number(cmy[1]) : null;
}
function expandSpareGroups(raw: string): string {
  return raw
    .replace(/(?:컬러\s*)?토너\s*[-:=]?\s*(\d+)\s*(?:세트|set)/gi, (_all, n: string) => `K${n} C${n} M${n} Y${n}`)
    .replace(/(?:KCMY|CMYK)\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/gi, (_all, n: string) => `K${n} C${n} M${n} Y${n}`)
    .replace(/CMY\s*[-:=]?\s*(\d+)\s*(?:개씩|세트)?/gi, (_all, n: string) => `C${n} M${n} Y${n}`);
}
function spareTokenCount(raw: string, token: SpareToken): number | null {
  const m = raw.match(spareTokenRegex(token));
  if (m) {
    const value = m[3].replace(/\s/g, "");
    return value === "-" ? null : Number(value.replace(/^-/, ""));
  }
  return groupedSpareTokenCount(raw, token);
}
function changeSpareToken(raw: string, token: SpareToken, delta: number): string {
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
function SpareQuickEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div>
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">{SPARE_TOKENS.map((token) => { const count = spareTokenCount(value, token); return <div key={token} className="rounded-lg border border-slate-200 bg-white p-1.5"><div className="text-center text-[10px] font-bold text-slate-500">{token}</div><div className="mt-1 grid grid-cols-3 items-center"><button type="button" onClick={()=>onChange(changeSpareToken(value,token,-1))} className="rounded bg-slate-100 py-1 text-xs text-slate-500">−</button><span className="text-center text-sm font-bold text-slate-700">{count ?? "-"}</span><button type="button" onClick={()=>onChange(changeSpareToken(value,token,1))} className="rounded bg-slate-700 py-1 text-xs text-white">＋</button></div></div>; })}</div>
    <textarea value={value} onChange={(e)=>onChange(e.target.value)} rows={3} placeholder="예: K1 C1 M1 Y1 폐1\n보관 위치나 특이사항 직접 입력" className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs leading-5 outline-none focus:border-slate-400" />
    <div className="mt-1 text-[10px] text-slate-400">K-2·토너1세트·CMY1개씩도 인식하며, 보관위치와 줄바꿈은 그대로 유지됩니다.</div>
  </div>;
}

// Structural lines that end a 여분/특이사항 free-text block.
const FIELD_MARKER_REGEX = /^(작성자|구분|레벨|등급|업체명|부서명|지역|키맨\/접수자|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무|특이사항|보증기간 내 여부|교체 전 카운터 누적 사용매수|사용 부품 예상 사용매수|물품명|물품|수량|출고여부|도착 시간|소요 시간)\s*:/;

function isStructuralLine(line: string, isStart: boolean): boolean {
  return isStart || isDividerLine(line) || /^※/.test(line) || FIELD_MARKER_REGEX.test(line);
}


// A numbered line ("1.", "2. 7층") only starts a new item when it directly
// follows a divider — this avoids treating numbered lines inside multi-line
// 처리내용/특이사항 (e.g. "2.토너교체") as a new device.
function itemStartFlags(lines: string[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  let prevDivider = false;
  lines.forEach((line: string, i: number) => {
    if (isDividerLine(line)) { prevDivider = true; return; }
    if (line.trim() === "") return;
    if (prevDivider && /^\s*\d+\./.test(line) && !/※/.test(line)) flags[i] = true;
    prevDivider = false;
  });
  return flags;
}

function applyProcessingFormV2(
  text: string,
  itemForms: PerItemForm[],
  shared: SharedForm,
  author: string
): string {
  let itemIdx = -1;
  let section: "" | "parts" | "self" = "";
  let skipCont = false;
  const out: string[] = [];
  const lines = text.split("\n");
  const starts = itemStartFlags(lines);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Skip continuation lines of a 여분/특이사항 we've already re-rendered.
    if (skipCont) {
      if (isStructuralLine(line, starts[li])) {
        skipCont = false;
      } else {
        continue;
      }
    }

    if (starts[li]) {
      itemIdx++;
      section = "";
      out.push(line);
      continue;
    }
    if (/^※부품신청※/.test(line)) { section = "parts"; out.push(line); continue; }
    if (/^※자가신청※/.test(line)) { section = "self"; out.push(line); continue; }

    // Header (shared)
    if (/^작성자\s*:/.test(line)) {
      out.push(author.trim() ? line.replace(/^(작성자\s*:\s*).*/, `$1${author.trim()}`) : line);
      continue;
    }
    if (/^레벨\s*:/.test(line)) {
      out.push(shared.level.trim() ? line.replace(/^(레벨\s*:\s*).*/, `$1${shared.level.trim()}`) : line);
      continue;
    }

    // Per-item fields
    if (itemIdx >= 0 && itemIdx < itemForms.length) {
      const f = itemForms[itemIdx];
      if (/^모델명\s*:/.test(line)) { out.push(suffixIfValue("모델명:", f.model.trim() || parseValueAfterColon(line, "모델명"))); continue; }
      if (/^시리얼넘버\s*:/.test(line)) { out.push(suffixIfValue("시리얼넘버:", f.serial.trim() || parseValueAfterColon(line, "시리얼넘버"))); continue; }
      if (/^자산기번\s*:/.test(line)) { out.push(suffixIfValue("자산기번:", f.asset.trim() || parseValueAfterColon(line, "자산기번"))); continue; }
      if (/^내용\s*:/.test(line)) { out.push(suffixIfValue("내용:", f.content.trim() || parseValueAfterColon(line, "내용"))); continue; }
      if (/^처리내용\s*:/.test(line)) {
        out.push(f.processContent.trim() ? `처리내용: ${f.processContent.trim()}` : line);
        if (f.processContent.trim()) skipCont = true;
        continue;
      }
      if (/^매수\s*:/.test(line)) { out.push(mergeMailLine(line, f)); continue; }
      if (/^토너잔량\s*:/.test(line)) { out.push(mergeTonerLine(line, f)); continue; }
      if (/^폐통\s*:/.test(line)) { out.push(mergeWasteLine(line, f)); continue; }
      if (/^여분\s*:/.test(line)) { out.push(renderSpareLine(f)); skipCont = true; continue; }
      if (/^한틴이카유무\s*:/.test(line)) {
        const existing = parseValueAfterColon(line, "한틴이카유무");
        const v = f.hantin.trim() || existing;
        out.push(suffixIfValue("한틴이카유무:", v));
        continue;
      }
      if (/^주차비지원유무\s*:/.test(line)) {
        const existing = parseValueAfterColon(line, "주차비지원유무");
        const v = f.parking.trim() || existing;
        out.push(suffixIfValue("주차비지원유무:", v));
        continue;
      }
      if (/^특이사항\s*:/.test(line)) {
        const notes = f.notes.trim();
        out.push(notes ? `특이사항: ${notes}` : "특이사항:");
        skipCont = true;
        continue;
      }
    }

    // Parts / self / footer (shared)
    if (/^보증기간 내 여부\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "보증기간 내 여부");
      const v = shared.warranty.trim() || existing;
      out.push(v ? `보증기간 내 여부 : ${v}` : "보증기간 내 여부 :");
      continue;
    }
    if (/^교체 전 카운터 누적 사용매수\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "교체 전 카운터 누적 사용매수");
      const v = shared.cumCount.trim() || existing;
      out.push(v ? `교체 전 카운터 누적 사용매수 : ${v}` : "교체 전 카운터 누적 사용매수 :");
      continue;
    }
    if (/^사용 부품 예상 사용매수\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "사용 부품 예상 사용매수");
      const v = shared.expectedCount.trim() || existing;
      out.push(v ? `사용 부품 예상 사용매수 : ${v}` : "사용 부품 예상 사용매수 :");
      continue;
    }
    if (/^물품명\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "물품명");
      const v = shared.partName.trim() || existing;
      out.push(suffixIfValue("물품명:", v));
      continue;
    }
    if (/^물품\s*:/.test(line) && section === "self") {
      const existing = parseValueAfterColon(line, "물품");
      const v = shared.selfItem.trim() || existing;
      out.push(suffixIfValue("물품:", v));
      continue;
    }
    if (/^수량\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "수량");
      const v = (section === "self" ? shared.selfQty.trim() : shared.partQty.trim()) || existing;
      out.push(suffixIfValue("수량:", v));
      continue;
    }
    if (/^출고여부\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "출고여부");
      const v = (section === "self" ? shared.selfShipped.trim() : shared.partShipped.trim()) || existing;
      out.push(suffixIfValue("출고여부:", v));
      continue;
    }
    if (/^도착 시간\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "도착 시간");
      const arrival = shared.arrivalHour
        ? `${shared.arrivalHour}:${shared.arrivalMinute || "00"}`
        : existing;
      out.push(suffixIfValue("도착 시간:", arrival));
      continue;
    }
    if (/^소요 시간\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "소요 시간");
      const v = shared.duration.trim() ? `${shared.duration.trim()}분` : existing;
      out.push(suffixIfValue("소요 시간:", v));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

// Pre-fills per-item forms from a transformed result: captures each item's
// 여분 (raw text, multi-line) and 특이사항 so the form boxes show the
// existing values for the user to confirm or edit.
function parseItemDataFromText(text: string, count: number): PerItemForm[] {
  const forms: PerItemForm[] = Array.from({ length: count }, () => ({ ...EMPTY_ITEM_FORM }));
  let idx = -1;
  let collecting: "process" | "spare" | "note" | null = null;
  const lines = text.split("\n");
  const starts = itemStartFlags(lines);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (starts[li]) { idx++; collecting = null; continue; }
    if (isDividerLine(line) || /^※/.test(line)) { collecting = null; continue; }
    if (idx < 0 || idx >= count) continue;

    if (/^모델명\s*:/.test(line)) { forms[idx].model = parseValueAfterColon(line, "모델명"); collecting = null; continue; }
    if (/^시리얼넘버\s*:/.test(line)) { forms[idx].serial = parseValueAfterColon(line, "시리얼넘버"); collecting = null; continue; }
    if (/^자산기번\s*:/.test(line)) { forms[idx].asset = parseValueAfterColon(line, "자산기번"); collecting = null; continue; }
    if (/^내용\s*:/.test(line)) { forms[idx].content = parseValueAfterColon(line, "내용"); collecting = null; continue; }
    if (/^처리내용\s*:/.test(line)) {
      forms[idx].processContent = parseValueAfterColon(line, "처리내용");
      collecting = "process";
      continue;
    }
    if (/^여분\s*:/.test(line)) {
      forms[idx].spareRaw = parseValueAfterColon(line, "여분");
      collecting = "spare";
      continue;
    }
    if (/^한틴이카유무\s*:/.test(line)) {
      forms[idx].hantin = parseValueAfterColon(line, "한틴이카유무");
      collecting = null;
      continue;
    }
    if (/^주차비지원유무\s*:/.test(line)) {
      forms[idx].parking = parseValueAfterColon(line, "주차비지원유무");
      collecting = null;
      continue;
    }
    if (/^특이사항\s*:/.test(line)) {
      forms[idx].notes = parseValueAfterColon(line, "특이사항");
      collecting = "note";
      continue;
    }
    if (collecting && !FIELD_MARKER_REGEX.test(line)) {
      const key = collecting === "process" ? "processContent" : collecting === "spare" ? "spareRaw" : "notes";
      forms[idx][key] = forms[idx][key] ? `${forms[idx][key]}\n${line}` : line;
      continue;
    }
    collecting = null;
  }
  return forms;
}

const PREVIEW_FIELD_LABEL_BY_ITEM_KEY: Partial<Record<keyof PerItemForm, string>> = {
  model: "모델명",
  serial: "시리얼넘버",
  asset: "자산기번",
  content: "내용",
  processContent: "처리내용",
  spareRaw: "여분",
  hantin: "한틴이카유무",
  parking: "주차비지원유무",
  notes: "특이사항",
};

function patchPreviewField(text: string, label: string, value: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${label}\\s*:`).test(line));
  const valueLines = String(value || "").split("\n");
  const replacement = [
    valueLines[0]?.trim() ? `${label}: ${valueLines[0]}` : `${label}:`,
    ...valueLines.slice(1),
  ];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !FIELD_MARKER_REGEX.test(lines[end]) && !isDividerLine(lines[end]) && !/^※/.test(lines[end])) end++;
    lines.splice(start, end - start, ...replacement);
    return lines.join("\n");
  }
  const insertAt = lines.findIndex((line) => isDividerLine(line) || /^※/.test(line));
  lines.splice(insertAt >= 0 ? insertAt : lines.length, 0, ...replacement);
  return lines.join("\n");
}

type ResultBlock = { text: string; device: number | null };

// Splits a rendered inspection result into header / per-device / footer
// blocks so the bottom result panel can jump to the device being edited.
function splitResultBlocks(text: string): ResultBlock[] {
  if (!text) return [];
  const lines = text.split("\n");
  const starts = itemStartFlags(lines);
  const blocks: ResultBlock[] = [];
  let cur: string[] = [];
  let curDevice: number | null = null;
  let deviceIdx = -1;
  let inFooter = false;

  const flush = () => {
    const t = cur.join("\n").replace(/^\n+|\n+$/g, "");
    if (t.trim()) blocks.push({ text: t, device: curDevice });
    cur = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (!inFooter && /^※/.test(lines[i])) { flush(); inFooter = true; curDevice = null; }
    else if (starts[i]) { flush(); deviceIdx++; curDevice = deviceIdx; }
    cur.push(lines[i]);
  }
  flush();
  return blocks;
}

function countInspectionItems(text: string): number {
  if (!text) return 0;
  return itemStartFlags(text.split("\n")).filter(Boolean).length;
}

const NEW_DEVICE_LINES = [
  "모델명:", "시리얼넘버:", "자산기번:", "내용:", "처리내용:",
  "매수: 흑-    컬-    큰컬-    합-", "토너잔량:K-   C-   M-   Y-", "폐통:        %",
  "여분:", "한틴이카유무:", "주차비지원유무:", "특이사항:", ITEM_DIVIDER,
];

function inspectionDeviceParts(text: string): { header: string[]; devices: string[][]; footer: string[] } {
  const lines = text.split("\n");
  const starts = itemStartFlags(lines).map((flag, i) => flag ? i : -1).filter((i) => i >= 0);
  if (!starts.length) return { header: lines, devices: [], footer: [] };
  const footerAt = lines.findIndex((line, i) => i > starts[0] && /^※/.test(line));
  const deviceEnd = footerAt >= 0 ? footerAt : lines.length;
  const devices = starts.map((start, i) => lines.slice(start, starts[i + 1] ?? deviceEnd));
  return { header: lines.slice(0, starts[0]), devices, footer: footerAt >= 0 ? lines.slice(footerAt) : [] };
}

function rebuildInspectionDevices(header: string[], devices: string[][], footer: string[]): string {
  const numbered = devices.map((block, i) => {
    const next = block.map((line, li) => li === 0 ? line.replace(/^\s*\d+\./, `${i + 1}.`) : line);
    if (!isDividerLine(next[next.length - 1] || "")) next.push(ITEM_DIVIDER);
    return next;
  });
  return [...header, ...numbered.flat(), ...footer].join("\n");
}

function extractInspectionItemLabels(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  const starts = itemStartFlags(lines);
  const labels: string[] = [];
  let idx = -1;
  let location = "";
  let model = "";
  let serial = "";
  let asset = "";

  const flush = () => {
    if (idx < 0) return;
    const parts = [location, model, serial, asset].map((p: string) => p.trim()).filter((p: string) => p);
    labels.push(`${idx + 1}. ${parts.length ? parts.join("/") : "(미상)"}`);
  };

  let collectingLoc = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (starts[li]) {
      flush();
      idx++;
      const titleMatch = line.match(/^\s*\d+\.\s*(.*)$/);
      location = titleMatch ? titleMatch[1].trim() : "";
      model = serial = asset = "";
      collectingLoc = true;
      continue;
    }
    const mm = line.match(/^모델명\s*:\s*(.*)$/);
    if (mm) { model = mm[1]; collectingLoc = false; continue; }
    const ms = line.match(/^시리얼넘버\s*:\s*(.*)$/);
    if (ms) { serial = ms[1]; continue; }
    const ma = line.match(/^자산기번\s*:\s*(.*)$/);
    if (ma) { asset = ma[1]; continue; }
    // A standalone line between the number and 모델명 is the location
    // (e.g. "1." on its own line followed by "3층").
    if (collectingLoc && line.trim() && !isDividerLine(line) && !FIELD_MARKER_REGEX.test(line)) {
      location = location ? `${location} ${line.trim()}` : line.trim();
    }
  }
  flush();
  return labels;
}

function applyAirPurifierForm(text: string, f: AirPurifierForm, author: string): string {
  return text.split("\n").map((line: string) => {
    if (/^작성자\s*:/.test(line)) {
      return author.trim() ? line.replace(/^(작성자\s*:\s*).*/, `$1${author.trim()}`) : line;
    }
    if (/^필터리셋\s*:/.test(line)) {
      return f.filterReset.trim() ? `필터리셋:${f.filterReset.trim()}` : "필터리셋:";
    }
    if (/^필터교체\s*:/.test(line)) {
      return f.filterChange.trim() ? `필터교체:${f.filterChange.trim()}` : "필터교체:";
    }
    if (/^특이사항\s*:/.test(line)) {
      return suffixIfValue("특이사항:", f.notes);
    }
    if (/^도착 시간\s*:/.test(line)) {
      const arrival = f.arrivalHour
        ? `${f.arrivalHour}:${f.arrivalMinute || "00"}`
        : "";
      return suffixIfValue("도착 시간:", arrival);
    }
    if (/^소요 시간\s*:/.test(line)) {
      const duration = f.duration.trim() ? `${f.duration.trim()}분` : "";
      return suffixIfValue("소요 시간:", duration);
    }
    return line;
  }).join("\n");
}

const HANTIN_OPTIONS = ["한공", "한조", "모바일한조", "한조해지업체", "보안으로 설치불가", "고객불편으로 설치불가", "무"];
const PARKING_OPTIONS = ["유", "무"];
const SHIP_OPTIONS = ["출고부탁드립니다", "선출고완료"];
const HOUR_OPTIONS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
const MINUTE_OPTIONS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
const DURATION_STEPS = [1, 5, 10, 30, 60];
const LEVEL_OPTIONS = ["1", "2", "3", "4", "5"];
const YESNO_OPTIONS = ["유", "무"];

const TONER_COLORS: Record<string, string> = {
  K: "#111827",
  C: "#06B6D4",
  M: "#EC4899",
  Y: "#EAB308",
};

type NumSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
  accent: string;
  suffix?: string;
};

function NumSelect({ value, onChange, options, labels, placeholder, accent, suffix }: NumSelectProps) {
  const [open, setOpen] = useState(false);
  const filled = value !== "";
  const label = placeholder ?? "선택";
  const labelFor = (v: string): string => {
    if (labels) {
      const idx = options.indexOf(v);
      if (idx >= 0) return labels[idx];
    }
    return `${v}${suffix ?? ""}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: "white",
          border: "1px solid #CBD5E1",
          borderLeft: filled ? `3px solid ${accent}` : "1px solid #CBD5E1",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? labelFor(value) : label}</span>
        <span className="ml-1 text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="flex w-full flex-col rounded-t-2xl bg-white shadow-2xl"
            style={{ maxHeight: "75vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="block w-full px-5 py-3 text-left text-sm text-slate-500 transition active:bg-slate-100"
              >
                해제
              </button>
              {options.map((opt: string, i: number) => {
                const active = value === opt;
                const text = labels?.[i] ?? `${opt}${suffix ?? ""}`;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className="block w-full px-5 py-3 text-left text-sm transition active:bg-slate-100"
                    style={{
                      background: active ? accent : "transparent",
                      color: active ? "white" : "#0F172A",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type DeviceInfo = Pick<PerItemForm, "model" | "serial" | "asset" | "content">;
const EMPTY_DEVICE_INFO: DeviceInfo = { model: "", serial: "", asset: "", content: "" };

function DevicePicker({ forms, labels, selected, onSelect, onAdd, onUpdate, onMove, onReorder, onRemove }: {
  forms: PerItemForm[];
  labels: string[];
  selected: number;
  onSelect: (i: number) => void;
  onAdd: (info: DeviceInfo) => void;
  onUpdate: (i: number, info: DeviceInfo) => void;
  onMove: (i: number, direction: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DeviceInfo>({ ...EMPTY_DEVICE_INFO });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const beginEdit = (index: number | "new") => {
    setEditing(index);
    setDraft(index === "new" ? { ...EMPTY_DEVICE_INFO } : {
      model: forms[index]?.model || "", serial: forms[index]?.serial || "",
      asset: forms[index]?.asset || "", content: forms[index]?.content || "",
    });
    setOpen(true);
  };
  const save = () => {
    if (!draft.model.trim() && !draft.serial.trim() && !draft.asset.trim()) return;
    if (editing === "new") onAdd(draft);
    else if (typeof editing === "number") onUpdate(editing, draft);
    setEditing(null);
  };
  const beginDrag = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (forms.length <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragFrom(index);
    setDragOver(index);
  };
  const trackDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragFrom === null) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-device-index]") as HTMLElement | null;
    const index = target ? Number(target.dataset.deviceIndex) : NaN;
    if (Number.isInteger(index) && index >= 0 && index < forms.length) setDragOver(index);
  };
  const finishDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) onReorder(dragFrom, dragOver);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragFrom(null);
    setDragOver(null);
  };
  const cancelDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };
  const closeModal = () => {
    if (editing !== null) {
      setEditing(null);
      return;
    }
    setOpen(false);
  };
  const rowClass = (index: number) => {
    if (dragFrom === index) return "border-blue-700 bg-blue-100 shadow-lg shadow-blue-200/70 ring-2 ring-blue-500 scale-[0.99]";
    if (dragOver === index && dragFrom !== null) return "border-amber-500 bg-amber-100 ring-2 ring-amber-400";
    if (selected === index) return "border-blue-300 bg-blue-50";
    return "border-slate-100 bg-white";
  };

  return <div className="relative mb-2 rounded-lg bg-slate-50 p-2">
    <button type="button" onClick={() => beginEdit("new")} className="absolute right-2 top-2 rounded-md bg-blue-700 px-2 py-1 text-[10px] font-bold leading-none text-white shadow-sm">＋ 추가</button>
    <div className="mb-1 flex items-center justify-between pr-14">
      <span className="text-sm font-bold text-slate-900">기기 선택</span>
      <span className="text-[10px] text-slate-500">{forms.length}대 중 {selected + 1}번 편집 중</span>
    </div>
    <div>
      <button type="button" onClick={() => { setEditing(null); setOpen(true); }} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-800">
        <span className="min-w-0 whitespace-normal break-words leading-5">{labels[selected] || `${selected + 1}. (미상)`}</span><span className="shrink-0 text-[10px] text-slate-400">▾</span>
      </button>
    </div>

    {open && <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setOpen(false)} role="dialog">
      <div className="flex max-h-[82vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-bold text-slate-800">{editing === "new" ? "새 기기 추가" : typeof editing === "number" ? `${editing + 1}번 기기 정보 수정` : "기기 선택·순서변경"}</div>
          <div className="flex items-center gap-1.5">
            {editing === null && <button type="button" onClick={() => beginEdit(selected)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">수정</button>}
            <button type="button" onClick={closeModal} className="rounded-lg px-2 py-1 text-xs text-slate-500">닫기</button>
          </div>
        </div>
        {editing !== null ? <div className="space-y-2 overflow-y-auto p-4">
          {([['model','모델명'],['serial','시리얼넘버'],['asset','자산기번'],['content','내용']] as [keyof DeviceInfo,string][]).map(([key, label]) =>
            <label key={key} className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input autoFocus={key === "model"} value={draft[key]} onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-slate-500" /></label>)}
          <div className="flex gap-2 pt-2"><button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">뒤로</button><button type="button" onClick={save} className="flex-1 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white">{editing === "new" ? "기기 추가" : "정보 저장"}</button></div>
        </div> : <div className="flex-1 overflow-y-auto p-2">
          {forms.map((_, i) => <div key={i} data-device-index={i} className={`mb-1 flex items-stretch gap-1 rounded-xl border p-1.5 transition ${rowClass(i)}`}>
            <button type="button" onPointerDown={(e) => beginDrag(e, i)} onPointerMove={trackDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} className={`w-9 shrink-0 touch-none rounded-lg text-lg font-bold leading-none active:bg-blue-200 ${dragFrom === i ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-500"}`}>≡</button>
            <button type="button" onClick={() => { onSelect(i); setOpen(false); }} className="min-w-0 flex-1 px-2 py-2 text-left"><div className="whitespace-normal break-words text-sm font-bold leading-5 text-slate-800">{labels[i] || `${i + 1}. (미상)`}</div></button>
            <button type="button" disabled={i === 0} onClick={() => onMove(i, -1)} className="hidden h-9 w-9 rounded-lg bg-slate-100 text-sm font-bold text-slate-600 disabled:opacity-25 sm:block">↑</button>
            <button type="button" disabled={i === forms.length - 1} onClick={() => onMove(i, 1)} className="hidden h-9 w-9 rounded-lg bg-slate-100 text-sm font-bold text-slate-600 disabled:opacity-25 sm:block">↓</button>
            {forms.length > 1 && <button type="button" onClick={() => onRemove(i)} className="h-9 rounded-lg bg-rose-50 px-2 text-[11px] font-bold text-rose-600">삭제</button>}
          </div>)}
        </div>}
      </div>
    </div>}
  </div>;
}

type AuthorPickerProps = {
  value: string;
  onChange: (v: string) => void;
  accent: string;
};

function AuthorPicker({ value, onChange, accent }: AuthorPickerProps) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<AuthorTeam>("팀장");
  const [newName, setNewName] = useState("");
  const { book, addAuthor, removeAuthor } = useAuthorBook();
  const filled = value !== "";
  const add = () => {
    addAuthor(team, newName);
    setNewName("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: "white",
          border: "1px solid #CBD5E1",
          borderLeft: filled ? `3px solid ${accent}` : "1px solid #CBD5E1",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? value : "작성자 선택"}</span>
        <span className="ml-1 text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="flex w-full flex-col rounded-t-2xl bg-white shadow-2xl"
            style={{ maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">작성자 선택</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500"
              >
                닫기
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1 border-b border-slate-100 px-3 py-2">
              {AUTHOR_TEAMS.map((t: AuthorTeam) => {
                const active = team === t;
                const label = t === "팀장" ? "팀장" : `${t}팀`;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTeam(t)}
                    className="rounded-lg py-2 text-xs font-semibold transition active:scale-95"
                    style={{
                      background: active ? accent : "#F1F5F9",
                      color: active ? "white" : "#334155",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto py-1 pb-3">
              <div className="flex gap-1.5 border-b border-slate-100 px-3 py-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                  placeholder="작성자 추가"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <button type="button" onClick={add} className="rounded-lg bg-slate-700 px-3 text-xs font-bold text-white">추가</button>
              </div>
              {book[team].map((name: string) => {
                const active = value === name;
                return (
                  <div key={name} className="flex border-b border-slate-50">
                    <button
                      type="button"
                      onClick={() => {
                        onChange(name);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 px-5 py-3 text-left text-sm transition active:bg-slate-100"
                      style={{
                        background: active ? accent : "transparent",
                        color: active ? "white" : "#0F172A",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {name}
                    </button>
                    <button type="button" onClick={() => removeAuthor(team, name)} className="px-4 text-xs font-bold text-rose-500">삭제</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type ProcessingFormPanelProps = {
  itemForm: PerItemForm;
  setItemF: <K extends keyof PerItemForm>(key: K, value: PerItemForm[K]) => void;
  shared: SharedForm;
  setSharedF: <K extends keyof SharedForm>(key: K, value: SharedForm[K]) => void;
  itemCount: number;
  itemLabels: string[];
  selectedItem: number;
  setSelectedItem: (i: number) => void;
  accent: string;
  bgSoft: string;
  author: string;
  setAuthor: (v: string) => void;
  reportTypes: string[];
  reportTypeOther: string;
  setReportTypes: (v: string[]) => void;
  setReportTypeOther: (v: string) => void;
  canManageDevices: boolean;
  allItemForms: PerItemForm[];
  onAddDevice: (info: DeviceInfo) => void;
  onUpdateDevice: (i: number, info: DeviceInfo) => void;
  onMoveDevice: (i: number, direction: -1 | 1) => void;
  onReorderDevice: (from: number, to: number) => void;
  onRemoveDevice: (i: number) => void;
  showLevel: boolean;
  showHantinParking: boolean;
};

function ProcessingFormPanel({
  itemForm, setItemF,
  shared, setSharedF,
  itemCount, itemLabels, selectedItem, setSelectedItem,
  accent, bgSoft,
  author, setAuthor,
  reportTypes, reportTypeOther, setReportTypes, setReportTypeOther,
  canManageDevices, allItemForms, onAddDevice, onUpdateDevice, onMoveDevice, onReorderDevice, onRemoveDevice,
  showLevel, showHantinParking,
}: ProcessingFormPanelProps) {
  const [partsExpanded, setPartsExpanded] = useState(false);
  const [selfExpanded, setSelfExpanded] = useState(false);
  const textInputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-500";

  return (
    <section className="mb-3 rounded-2xl bg-white px-1 py-2 sm:px-1.5">
      {/* ▣ 기본 입력 */}
      <div className="mb-3 rounded-xl border-2 border-slate-800 p-3">
      {/* 작성자 / 구분 / 레벨 */}
      <div className={`mb-2 grid gap-2 rounded-xl p-2 ${showLevel ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem]" : "grid-cols-2"}`} style={{ background: bgSoft }}>
        <div>
          <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">작성자</div>
          <AuthorPicker
            value={author}
            onChange={setAuthor}
            accent={accent}
          />
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1"><span className="rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">구분</span><span className="text-[9px] text-slate-400">중복</span></div>
          <ReportTypeSelector selected={reportTypes} other={reportTypeOther} onSelected={setReportTypes} onOther={setReportTypeOther} accent={accent} />
        </div>
        {showLevel && (
          <div className="min-w-0">
            <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">레벨</div>
            <NumSelect
              value={shared.level}
              onChange={(v) => setSharedF("level", v)}
              options={LEVEL_OPTIONS}
              placeholder="-"
              accent={accent}
            />
          </div>
        )}
      </div>

      {canManageDevices ? <DevicePicker forms={allItemForms} labels={itemLabels} selected={selectedItem} onSelect={setSelectedItem} onAdd={onAddDevice} onUpdate={onUpdateDevice} onMove={onMoveDevice} onReorder={onReorderDevice} onRemove={onRemoveDevice} /> : itemCount > 1 && (
        <NumSelect value={String(selectedItem)} onChange={(v) => setSelectedItem(Number(v))} options={Array.from({ length: itemCount }, (_, i) => String(i))} labels={itemLabels} placeholder="기기 선택" accent={accent} />
      )}

      {/* 처리내용 */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">처리내용</div>
        <textarea
          value={itemForm.processContent}
          onChange={(e) => setItemF("processContent", e.target.value)}
          rows={4}
          className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-slate-500"
        />
      </div>

      {/* 매수 */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">매수</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-slate-500">
            <span className="flex w-9 shrink-0 items-center justify-center bg-slate-200 px-1 text-xs font-bold text-slate-600">흑</span>
            <input inputMode="numeric" value={itemForm.mailBlack} onChange={(e) => setItemF("mailBlack", e.target.value)} className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none" />
          </div>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-slate-500">
            <span className="flex w-9 shrink-0 items-center justify-center bg-slate-200 px-1 text-xs font-bold text-slate-600">컬</span>
            <input inputMode="numeric" value={itemForm.mailColor} onChange={(e) => setItemF("mailColor", e.target.value)} className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none" />
          </div>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-slate-500">
            <span className="flex w-9 shrink-0 items-center justify-center bg-slate-200 px-1 text-xs font-bold text-slate-600">큰컬</span>
            <input inputMode="numeric" value={itemForm.mailLargeColor} onChange={(e) => setItemF("mailLargeColor", e.target.value)} className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none" />
          </div>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-slate-500">
            <span className="flex w-9 shrink-0 items-center justify-center bg-slate-200 px-1 text-xs font-bold text-slate-600">합</span>
            <input inputMode="numeric" value={itemForm.mailTotal} onChange={(e) => setItemF("mailTotal", e.target.value)} className="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none" />
          </div>
        </div>
      </div>

      {/* 잔량 — K/C/M/Y + 폐통, 직접 입력 (5칸) */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">잔량</div>
        <div className="grid grid-cols-5 gap-1">
          {(["K", "C", "M", "Y"] as const).map((ch: "K" | "C" | "M" | "Y") => {
            const key = (`toner${ch}`) as "tonerK" | "tonerC" | "tonerM" | "tonerY";
            return (
              <div key={ch}>
                <div className="mb-0.5 flex items-center justify-center gap-0.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-slate-300"
                    style={{ background: TONER_COLORS[ch] }}
                  />
                  <span className="text-[11px] font-semibold text-slate-600">{ch}</span>
                </div>
                <input
                  inputMode="numeric"
                  value={itemForm[key]}
                  onChange={(e) => setItemF(key, e.target.value)}
                  className="w-full min-w-0 rounded-lg bg-white px-1 py-1.5 text-center text-sm outline-none"
                />
              </div>
            );
          })}
          <div>
            <div className="mb-0.5 text-center text-[11px] font-semibold text-slate-600">폐통</div>
            <input
              inputMode="numeric"
              value={itemForm.waste}
              onChange={(e) => setItemF("waste", e.target.value)}
              className="w-full min-w-0 rounded-lg bg-white px-1 py-1.5 text-center text-sm outline-none"
            />
          </div>
        </div>
      </div>

      {/* 여분 — 원문은 보존하고 알려진 수량만 빠르게 조정 */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">여분</div>
        <SpareQuickEditor value={itemForm.spareRaw} onChange={(v)=>setItemF("spareRaw",v)} />
      </div>
      </div>{/* /기본 입력 */}

      {/* ▣ 추가 정보 */}
      <div className="mb-3 rounded-xl border-2 border-slate-800 p-3">
      {showHantinParking && (
        <>
          {/* 한틴이카 — 칩 빠른선택 + 직접입력 */}
          <div className="mb-2">
            <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">한틴이카유무</div>
            <div className="mb-1 flex flex-wrap gap-1">
              {HANTIN_OPTIONS.map((opt: string) => {
                const active = itemForm.hantin === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setItemF("hantin", active ? "" : opt)}
                    className="rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-95"
                    style={{
                      background: active ? accent : "#F1F5F9",
                      color: active ? "white" : "#334155",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              placeholder="직접 입력"
              value={itemForm.hantin}
              onChange={(e) => setItemF("hantin", e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-500"
            />
          </div>

          {/* 주차비 — 칩 빠른선택 + 직접입력 */}
          <div className="mb-2">
            <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">주차비지원유무</div>
            <div className="mb-1 flex flex-wrap gap-1">
              {PARKING_OPTIONS.map((opt: string) => {
                const active = itemForm.parking === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setItemF("parking", active ? "" : opt)}
                    className="rounded-full px-3 py-1 text-xs font-medium transition active:scale-95"
                    style={{
                      background: active ? accent : "#F1F5F9",
                      color: active ? "white" : "#334155",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              placeholder="직접 입력"
              value={itemForm.parking}
              onChange={(e) => setItemF("parking", e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-500"
            />
          </div>
        </>
      )}

      {/* 특이사항 */}
      <div>
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">특이사항</div>
        <textarea
          value={itemForm.notes}
          onChange={(e) => setItemF("notes", e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-slate-500"
        />
      </div>
      </div>{/* /추가 정보 */}

      {/* ▣ 부품·자가·시간 */}
      <div className="mb-3 space-y-3 rounded-xl border-2 border-slate-800 p-3">
      {/* 부품신청 */}
      <div className="rounded-lg bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setPartsExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-bold text-slate-700"
        >
          <span>※ 부품신청 ※</span>
          <span className="text-[10px] text-slate-400">{partsExpanded ? "접기 ▲" : "펼치기 ▼"}</span>
        </button>
        {partsExpanded && (
        <div className="mt-2 space-y-1.5">
          <div>
            <div className="text-[11px] text-slate-500">보증기간 내 여부</div>
            <input value={shared.warranty} onChange={(e) => setSharedF("warranty", e.target.value)} className={textInputClass} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">교체 전 카운터 누적 사용매수</div>
            <input value={shared.cumCount} onChange={(e) => setSharedF("cumCount", e.target.value)} inputMode="numeric" className={textInputClass} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">사용 부품 예상 사용매수</div>
            <input value={shared.expectedCount} onChange={(e) => setSharedF("expectedCount", e.target.value)} inputMode="numeric" className={textInputClass} />
          </div>
          <div className="pt-1 text-[11px] font-semibold text-slate-600">▶ 신청 부품</div>
          <div>
            <div className="text-[11px] text-slate-500">물품명</div>
            <input value={shared.partName} onChange={(e) => setSharedF("partName", e.target.value)} className={textInputClass} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[11px] text-slate-500">수량</div>
              <input value={shared.partQty} onChange={(e) => setSharedF("partQty", e.target.value)} inputMode="numeric" className={textInputClass} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500">출고여부</div>
              <NumSelect
                value={shared.partShipped}
                onChange={(v) => setSharedF("partShipped", v)}
                options={SHIP_OPTIONS}
                accent={accent}
              />
            </div>
          </div>
        </div>
        )}
      </div>

      {/* 자가신청 */}
      <div className="rounded-lg bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setSelfExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-bold text-slate-700"
        >
          <span>※ 자가신청 ※</span>
          <span className="text-[10px] text-slate-400">{selfExpanded ? "접기 ▲" : "펼치기 ▼"}</span>
        </button>
        {selfExpanded && (
        <div className="mt-2 space-y-1.5">
          <div>
            <div className="text-[11px] text-slate-500">물품</div>
            <input value={shared.selfItem} onChange={(e) => setSharedF("selfItem", e.target.value)} className={textInputClass} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[11px] text-slate-500">수량</div>
              <input value={shared.selfQty} onChange={(e) => setSharedF("selfQty", e.target.value)} inputMode="numeric" className={textInputClass} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500">출고여부</div>
              <NumSelect
                value={shared.selfShipped}
                onChange={(v) => setSharedF("selfShipped", v)}
                options={SHIP_OPTIONS}
                accent={accent}
              />
            </div>
          </div>
        </div>
        )}
      </div>

      {/* 시간 */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">도착 시간</span>
            {shared.arrivalHour && (
              <span className="text-xs font-semibold" style={{ color: accent }}>
                {shared.arrivalHour}:{shared.arrivalMinute || "00"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-1.5">
            <NumSelect
              value={shared.arrivalHour}
              onChange={(v) => setSharedF("arrivalHour", v)}
              options={HOUR_OPTIONS}
              placeholder="시"
              accent={accent}
              suffix="시"
            />
            <NumSelect
              value={shared.arrivalMinute}
              onChange={(v) => setSharedF("arrivalMinute", v)}
              options={MINUTE_OPTIONS}
              placeholder="분"
              accent={accent}
              suffix="분"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">소요 시간</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: accent }}>
                {shared.duration ? `${shared.duration}분` : "0분"}
              </span>
              {shared.duration && (
                <button
                  type="button"
                  onClick={() => setSharedF("duration", "")}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 active:scale-95"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {DURATION_STEPS.map((step: number) => (
              <button
                key={step}
                type="button"
                onClick={() => {
                  const current = parseInt(shared.duration || "0", 10) || 0;
                  setSharedF("duration", String(current + step));
                }}
                className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
              >
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>{/* /부품·자가·시간 */}
    </section>
  );
}

type AirPurifierFormPanelProps = {
  form: AirPurifierForm;
  setAirF: <K extends keyof AirPurifierForm>(key: K, value: AirPurifierForm[K]) => void;
  accent: string;
  author: string;
  setAuthor: (v: string) => void;
};

function AirPurifierFormPanel({
  form, setAirF, accent,
  author, setAuthor,
}: AirPurifierFormPanelProps) {
  return (
    <section className="mb-3 rounded-2xl bg-white px-1 py-2 sm:px-1.5">
      {/* 작성자 */}
      <div className="mb-2">
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">작성자</div>
        <AuthorPicker
          value={author}
          onChange={setAuthor}
          accent={accent}
        />
      </div>

      {/* 필터리셋 / 필터교체 */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">필터리셋</div>
          <NumSelect
            value={form.filterReset}
            onChange={(v) => setAirF("filterReset", v)}
            options={YESNO_OPTIONS}
            placeholder="-"
            accent={accent}
          />
        </div>
        <div>
          <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">필터교체</div>
          <NumSelect
            value={form.filterChange}
            onChange={(v) => setAirF("filterChange", v)}
            options={YESNO_OPTIONS}
            placeholder="-"
            accent={accent}
          />
        </div>
      </div>

      {/* 특이사항 */}
      <div className="mb-3">
        <div className="mb-1.5 inline-block rounded-md bg-slate-200 px-2.5 py-0.5 text-[13px] font-bold text-slate-700">특이사항</div>
        <textarea
          value={form.notes}
          onChange={(e) => setAirF("notes", e.target.value)}
          rows={3}
          className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-slate-500"
        />
      </div>

      {/* 시간 */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">도착 시간</span>
            {form.arrivalHour && (
              <span className="text-xs font-semibold" style={{ color: accent }}>
                {form.arrivalHour}:{form.arrivalMinute || "00"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-1.5">
            <NumSelect
              value={form.arrivalHour}
              onChange={(v) => setAirF("arrivalHour", v)}
              options={HOUR_OPTIONS}
              placeholder="시"
              accent={accent}
              suffix="시"
            />
            <NumSelect
              value={form.arrivalMinute}
              onChange={(v) => setAirF("arrivalMinute", v)}
              options={MINUTE_OPTIONS}
              placeholder="분"
              accent={accent}
              suffix="분"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">소요 시간</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: accent }}>
                {form.duration ? `${form.duration}분` : "0분"}
              </span>
              {form.duration && (
                <button
                  type="button"
                  onClick={() => setAirF("duration", "")}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 active:scale-95"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {DURATION_STEPS.map((step: number) => (
              <button
                key={step}
                type="button"
                onClick={() => {
                  const current = parseInt(form.duration || "0", 10) || 0;
                  setAirF("duration", String(current + step));
                }}
                className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
              >
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

// Prefixes whose lines are owned by the form. When the user types directly
// into a result block, lines NOT in this set are preserved across subsequent
// form changes; lines IN this set are re-driven by the form (so the form
// stays the source of truth for them).
const FORM_DRIVEN_PREFIXES = new Set<string>([
  // shared header
  "작성자", "레벨",
  // per-item (inspection)
  "처리내용", "매수", "토너잔량", "폐통", "여분",
  "한틴이카유무", "주차비지원유무", "특이사항",
  // shared footer / 부품·자가
  "보증기간 내 여부",
  "교체 전 카운터 누적 사용매수", "사용 부품 예상 사용매수",
  "물품명", "물품", "수량", "출고여부",
  "도착 시간", "소요 시간",
  // air-purifier
  "필터리셋", "필터교체",
]);

function linePrefix(line: string): string {
  const t = line.replace(/^\s+/, "");
  const idx = t.indexOf(":");
  if (idx === -1) return "";
  return t.slice(0, idx).trim();
}

// Merge the user's manual edit of a block with the freshly form-driven base.
// Lines whose prefix is form-driven take the form's value; every other line
// keeps the user's text (기기위치, 모델명, 시리얼넘버, 내용, 등급 등).
function mergeBlockEdit(formBase: string, userEdit: string): string {
  // 처리내용 등 여러 줄 필드는 첫 라벨 줄뿐 아니라 다음 필드 전까지를 통째로 교체한다.
  // 기존 Map 방식만 사용하면 라벨 없는 2번째 줄부터가 사라질 수 있다.
  const replaceMultiline = (target: string, source: string, label: string): string => {
    const sourceLines = source.split("\n");
    const targetLines = target.split("\n");
    const startOf = (lines: string[]) => lines.findIndex((line) => new RegExp(`^${label}\\s*:`).test(line));
    const endOf = (lines: string[], start: number) => {
      let end = start + 1;
      while (end < lines.length && !FIELD_MARKER_REGEX.test(lines[end]) && !isDividerLine(lines[end]) && !/^※/.test(lines[end])) end++;
      return end;
    };
    const sourceStart = startOf(sourceLines); const targetStart = startOf(targetLines);
    if (sourceStart < 0 || targetStart < 0) return target;
    targetLines.splice(targetStart, endOf(targetLines, targetStart) - targetStart, ...sourceLines.slice(sourceStart, endOf(sourceLines, sourceStart)));
    return targetLines.join("\n");
  };
  let mergedEdit = replaceMultiline(userEdit, formBase, "처리내용");
  mergedEdit = replaceMultiline(mergedEdit, formBase, "여분");
  mergedEdit = replaceMultiline(mergedEdit, formBase, "특이사항");
  const baseByPrefix = new Map<string, string>();
  for (const line of formBase.split("\n")) {
    const p = linePrefix(line);
    if (p && FORM_DRIVEN_PREFIXES.has(p)) baseByPrefix.set(p, line);
  }
  return mergedEdit.split("\n").map((line: string) => {
    const p = linePrefix(line);
    if (p && baseByPrefix.has(p)) return baseByPrefix.get(p) as string;
    return line;
  }).join("\n");
}

// 생성된 양식/결과 텍스트에서 "업체명: X" 줄을 찾아 거래처명을 뽑는다.
// 미양식탭에서 AS 접수내용을 변환하면 출력에 업체명 줄이 정규화되어 들어가므로 이를 통합이력 검색에 쓴다.
function extractVendorFromText(text: string): string {
  const m = text.match(/^\s*업체명\s*[:：]\s*(.+)$/m);
  return m ? m[1].trim() : "";
}

// 키맨/접수자 문자열 → [{label, name, phone}]. 여러 명(전화 2개 이상)이면 분리.
const PHONE_RE = /(01[016789][-\s]?\d{3,4}[-\s]?\d{4}|\d{2,4}-\d{3,4}-\d{4})/;
export function parseKeymen_(raw: string): { label: string; name: string; phone: string }[] {
  const s0 = String(raw || "").trim();
  if (!s0) return [];
  // "이연철님 박현수님"처럼 공백+님으로 붙은 여러 명 → 님 뒤를 경계로.
  const s = s0.replace(/님/g, "님|");
  let parts = s.split(/[,/;·\n|]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const phones = s0.match(new RegExp(PHONE_RE, "g"));
    if (phones && phones.length >= 2) {
      parts = [];
      let rest = s0;
      for (const ph of phones) {
        const idx = rest.indexOf(ph);
        parts.push(rest.slice(0, idx + ph.length).trim());
        rest = rest.slice(idx + ph.length);
      }
      if (rest.trim()) parts[parts.length - 1] += " " + rest.trim();
    }
  }
  return parts
    .map((p) => {
      const m = p.match(PHONE_RE);
      const phone = m ? m[0].trim() : "";
      const name = p.replace(phone, "").replace(/\([^)]*\)/g, "").replace(/님/g, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim();
      return { label: p.trim(), name, phone };
    })
    .filter((k) => (k.name || k.phone) && !/^(유|무|유\/무)$/.test(k.name) && !/처리내용|특이사항|필히작성/.test(k.label));
}

export default function App() {
  // Restore the previous working session so leaving/returning (or a stray
  // tap) doesn't wipe everything that was being entered.
  const [savedSession] = useState<Record<string, unknown> | null>(() => {
    try { return JSON.parse(localStorage.getItem("session_v1") || "null"); } catch { return null; }
  });
  const ss = savedSession ?? {};

  const [mode, setMode] = useState<Mode>(() => {
    const m = ss.mode as Mode;
    return MODE_ORDER.includes(m) ? m : "inspection";
  });
  // Original input is entered via a popup and not persisted (blank next time);
  // the converted result/forms are persisted so work isn't lost.
  const [inputText, setInputText] = useState<string>("");
  const [textOutput, setTextOutput] = useState<string>((ss.textOutput as string) ?? "");
  const [listOutput, setListOutput] = useState<ResultItem[]>((ss.listOutput as ResultItem[]) ?? []);
  const [toast, setToast] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [itemForms, setItemForms] = useState<PerItemForm[]>(
    Array.isArray(ss.itemForms) && ss.itemForms.length
      ? (ss.itemForms as PerItemForm[]).map((f) => ({ ...EMPTY_ITEM_FORM, ...f }))
      : [EMPTY_ITEM_FORM],
  );
  const [sharedForm, setSharedForm] = useState<SharedForm>({ ...EMPTY_SHARED_FORM, ...(ss.sharedForm as Partial<SharedForm> ?? {}) });
  const [selectedItem, setSelectedItem] = useState<number>((ss.selectedItem as number) ?? 0);
  const [airForm, setAirForm] = useState<AirPurifierForm>({ ...EMPTY_AIR_FORM, ...(ss.airForm as Partial<AirPurifierForm> ?? {}) });
  // Manual result edits live per result block (keyed by block index). They're
  // persisted so a user's direct fixes (기기위치 / 특이사항 등) survive a reload.
  const [editedBlocks, setEditedBlocks] = useState<Record<number, string>>(
    (ss.editedBlocks as Record<number, string>) ?? {},
  );
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [inputModalOpen, setInputModalOpen] = useState<boolean>(false);
  const [draftInput, setDraftInput] = useState<string>("");

  // 거래처 조회(통합이력 / 점검양식 검색) 관련
  const [currentVendor, setCurrentVendor] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [photoBusy, setPhotoBusy] = useState<boolean>(false);
  const [previewCollapsed, setPreviewCollapsed] = useState<boolean>(true);
  const toastTimerRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const lastBlankVendor = useRef<string>("");
  // 탭별 작업상태 보관 (탭을 바꿔도 적던 내용이 사라지지 않게)
  const modeStateRef = useRef<Record<string, {
    inputText: string; textOutput: string; listOutput: ResultItem[];
    itemForms: PerItemForm[]; sharedForm: SharedForm; selectedItem: number;
    editedBlocks: Record<number, string>; airForm: AirPurifierForm;
    reportTypes: string[]; reportTypeOther: string;
  }>>({});


  // On a restored session, skip the first auto-transform so it doesn't
  // re-parse and overwrite the restored form edits.
  const skipAutoRef = useRef<boolean>(
    Boolean(savedSession && (ss.textOutput || (Array.isArray(ss.listOutput) && ss.listOutput.length))),
  );

  const [author, setAuthor] = useState<string>(() => {
    try { return localStorage.getItem("author") || ""; } catch { return ""; }
  });

  useEffect(() => {
    try { localStorage.setItem("author", author); } catch {
      // ignore quota / private mode errors
    }
  }, [author]);

  // 내장 자가테스트는 화면 패널 대신 개발 콘솔로만 출력한다(평소엔 숨김).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const results = runSelfTests();
    const failed = results.filter((t) => !t.passed);
    if (failed.length) console.warn("[selfTests] 실패:", failed.map((t) => t.name));
    else console.info(`[selfTests] ${results.length}건 통과`);
    const compactSpare = "K2C2M2Y2 폐2\n(복합기 뒤 보관)";
    const spareCountsOk = (["K", "C", "M", "Y", "폐"] as SpareToken[]).every((token) => spareTokenCount(compactSpare, token) === 2);
    const spareEditOk = changeSpareToken(compactSpare, "M", 1).startsWith("K2C2M3Y2 폐2");
    if (!spareCountsOk || !spareEditOk) console.warn("[selfTests] 공백 없는 여분 토큰 파싱 실패");
    const spareVariants: Array<[string, Record<string, number>]> = [
      ["K-2 C-2 M-2 Y-2 폐-2 (폐2는 복합기 왼쪽 서랍장)", { K: 2, C: 2, M: 2, Y: 2, 폐: 2 }],
      ["토너1세트 폐통1", { K: 1, C: 1, M: 1, Y: 1, 폐: 1 }],
      ["토너 k1,CMY1개씩 폐-1", { K: 1, C: 1, M: 1, Y: 1, 폐: 1 }],
    ];
    const variantsOk = spareVariants.every(([raw, expected]) => Object.entries(expected).every(([token, count]) => spareTokenCount(raw, token as SpareToken) === count));
    const groupedEditOk = changeSpareToken("토너 k1,CMY1개씩 폐-1", "C", 1).includes("C2 M1 Y1");
    if (!variantsOk || !groupedEditOk) console.warn("[selfTests] 여분 변형 표현 파싱 실패");
  }, []);

  const config = MODE_CONFIG[mode];
  const showForm = mode === "blank-report" || mode === "inspection";
  const showAirForm = mode === "air-purifier";

  const displayedList = useMemo(() => {
    if (mode !== "blank-report") return listOutput;
    return listOutput.map((item: ResultItem, i: number) => ({
      ...item,
      content: applyProcessingFormV2(
        item.content,
        [itemForms[i] ?? EMPTY_ITEM_FORM],
        sharedForm,
        author,
      ),
    }));
  }, [mode, listOutput, itemForms, sharedForm, author]);

  const displayedTextOutput = useMemo(() => {
    if (mode === "air-purifier") {
      return applyAirPurifierForm(textOutput, airForm, author);
    }
    if (mode === "inspection") {
      return applyProcessingFormV2(textOutput, itemForms, sharedForm, author);
    }
    return textOutput;
  }, [mode, textOutput, airForm, itemForms, sharedForm, author]);

  const currentItemForm = itemForms[selectedItem] ?? EMPTY_ITEM_FORM;

  const itemLabels = useMemo(() => {
    if (mode === "inspection") return extractInspectionItemLabels(displayedTextOutput);
    if (mode === "blank-report") {
      return listOutput.map((item: ResultItem, i: number) => {
        const labels = extractInspectionItemLabels(item.content);
        return labels[0] ?? `${i + 1}.`;
      });
    }
    return [];
  }, [mode, displayedTextOutput, listOutput]);

  // Form changes do NOT discard manual edits; mergeBlockEdit re-applies the
  // form's values to form-driven lines while preserving everything else.
  const setItemF = <K extends keyof PerItemForm>(key: K, value: PerItemForm[K]) => {
    setItemForms((prev: PerItemForm[]) => prev.map((f: PerItemForm, i: number) =>
      i === selectedItem ? { ...f, [key]: value } : f,
    ));
    const label = PREVIEW_FIELD_LABEL_BY_ITEM_KEY[key];
    if (label) {
      const blockIndex = resultBlocks.findIndex((block: ResultBlock) => block.device === selectedItem);
      if (blockIndex >= 0) {
        setEditedBlocks((prev: Record<number, string>) => (
          prev[blockIndex] === undefined
            ? prev
            : { ...prev, [blockIndex]: patchPreviewField(prev[blockIndex], label, String(value ?? "")) }
        ));
      }
    }
  };
  const setSharedF = <K extends keyof SharedForm>(key: K, value: SharedForm[K]) => {
    setSharedForm((prev: SharedForm) => ({ ...prev, [key]: value }));
  };
  const setAirF = <K extends keyof AirPurifierForm>(key: K, value: AirPurifierForm[K]) => {
    setAirForm((prev: AirPurifierForm) => ({ ...prev, [key]: value }));
  };
  const handleSetAuthor = (v: string) => {
    setAuthor(v);
  };

  // Result blocks for the bottom panel, tagged with their device index so
  // selecting a device scrolls its block into view.
  // IT통합(PC) 폼 상태 (탭 전환에도 유지, 초기화 시 리셋)
  const [pcSubTab, setPcSubTab] = useState<"it" | "copier">("it");
  const [pcForm, setPcForm] = useState<PcFormState>({ ...EMPTY_PC_FORM });
  const pcFilled = useMemo(() => Object.values(pcForm).some((v) => String(v).trim() !== ""), [pcForm]);
  const pcText = useMemo(() => buildPcText(pcForm, author), [pcForm, author]);
  const [copierExpansionForm, setCopierExpansionForm] = useState<CopierExpansionFormState>({ ...EMPTY_COPIER_EXPANSION_FORM });
  const copierExpansionFilled = useMemo(() => Object.values(copierExpansionForm).some((v) => String(v).trim() !== ""), [copierExpansionForm]);
  const copierExpansionText = useMemo(() => buildCopierExpansionText(copierExpansionForm, author), [copierExpansionForm, author]);
  const [logisticsForm, setLogisticsForm] = useState<LogisticsFormState>({ ...EMPTY_LOGISTICS_FORM });
  const logisticsFilled = Boolean(logisticsForm.vendor.trim() || logisticsForm.item.trim() || logisticsForm.notes.trim());
  const logisticsText = useMemo(() => buildLogisticsText(logisticsForm, author), [logisticsForm, author]);
  const [reportTypes, setReportTypes] = useState<string[]>(
    Array.isArray(ss.reportTypes) ? (ss.reportTypes as string[]) : [],
  );
  const [reportTypeOther, setReportTypeOther] = useState<string>((ss.reportTypeOther as string) ?? "");

  useEffect(() => {
    if (mode !== "inspection") return;
    if (sharedForm.level !== FIXED_INSPECTION_LEVEL) {
      setSharedForm((prev: SharedForm) => ({ ...prev, level: FIXED_INSPECTION_LEVEL }));
    }
    if (reportTypes.length !== 1 || reportTypes[0] !== FIXED_INSPECTION_REPORT_TYPES[0]) {
      setReportTypes(FIXED_INSPECTION_REPORT_TYPES);
    }
    if (reportTypeOther) setReportTypeOther("");
  }, [mode, sharedForm.level, reportTypes, reportTypeOther]);

  // 카테고리 폼(불만/재계약/초과조정) — 모드키별 상태 맵
  const isCat = mode === "bulman" || mode === "misu" || mode === "recontract" || mode === "overage-adjust";
  const [catForms, setCatForms] = useState<Record<string, Record<string, string>>>({});
  const curCatForm = catForms[mode] || (isCat ? emptyCatForm(mode) : {});
  const catFilled = isCat && Object.values(curCatForm).some((v) => String(v).trim() !== "");
  const catText = useMemo(() => (isCat ? buildCatText(mode, curCatForm, author) : ""), [isCat, mode, curCatForm, author]);

  const resultBlocks = useMemo<ResultBlock[]>(() => {
    if (mode === "inspection") return splitResultBlocks(applyReportTypeSelection(displayedTextOutput, reportTypes, reportTypeOther));
    if (mode === "blank-report") {
      return displayedList.map((item: ResultItem, i: number) => ({ text: applyReportTypeSelection(item.content, reportTypes, reportTypeOther), device: i }));
    }
    if (mode === "air-purifier") return displayedTextOutput ? [{ text: displayedTextOutput, device: null }] : [];
    if (mode === "samsung-note") return displayedList.map((item: ResultItem) => ({ text: item.content, device: null }));
    if (mode === "pc") {
      if (pcSubTab === "copier") return copierExpansionFilled ? [{ text: copierExpansionText, device: null }] : [];
      return pcFilled ? [{ text: pcText, device: null }] : [];
    }
    if (mode === "logistics") return logisticsFilled ? [{ text: logisticsText, device: null }] : [];
    if (isCat) return catFilled ? [{ text: catText, device: null }] : [];
    return [];
  }, [mode, displayedTextOutput, displayedList, pcSubTab, pcText, pcFilled, copierExpansionText, copierExpansionFilled, logisticsText, logisticsFilled, isCat, catText, catFilled, reportTypes, reportTypeOther]);

  const blockJoiner = mode === "inspection" ? "\n" : "\n\n";

  const deviceBlockRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const resultScrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll the result panel to the selected device — only when the device
  // selection changes, and only within the panel (never the page), so
  // typing in form fields doesn't make the screen jump.
  useEffect(() => {
    const container = resultScrollRef.current;
    const el = deviceBlockRefs.current[selectedItem];
    if (container && el) container.scrollTop = el.offsetTop - container.offsetTop;
  }, [selectedItem]);

  const showToast = (text: string, kind: "success" | "error" = "success") => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ text, kind });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  };

  const resetOutputs = () => {
    setTextOutput("");
    setListOutput([]);
    setEditedBlocks({});
  };

  const handleModeChange = (next: Mode) => {
    if (next === mode) return;
    // 현재 탭의 작업상태를 저장해 두고, 대상 탭의 저장본을 복원한다(없으면 빈 상태).
    modeStateRef.current[mode] = {
      inputText, textOutput, listOutput, itemForms, sharedForm, selectedItem, editedBlocks, airForm,
      reportTypes, reportTypeOther,
    };
    const s = modeStateRef.current[next];
    setMode(next);
    skipAutoRef.current = true; // 복원된 입력으로 자동 변환이 다시 돌지 않게(작업 보존)
    if (s) {
      setInputText(s.inputText);
      setTextOutput(s.textOutput);
      setListOutput(s.listOutput);
      setItemForms(s.itemForms);
      setSharedForm(s.sharedForm);
      setSelectedItem(s.selectedItem);
      setEditedBlocks(s.editedBlocks);
      setAirForm(s.airForm);
      setReportTypes(next === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : s.reportTypes);
      setReportTypeOther(next === "inspection" ? "" : s.reportTypeOther);
      // 미양식 복원 시 통합이력 팝업이 자동으로 다시 뜨지 않게 마지막 인식 업체명을 맞춰둔다.
      if (next === "blank-report") {
        lastBlankVendor.current = extractVendorFromText(s.listOutput[0]?.content || s.textOutput || "");
      }
    } else {
      setInputText("");
      resetOutputs();
      setItemForms([{ ...EMPTY_ITEM_FORM }]);
      setSharedForm(EMPTY_SHARED_FORM);
      setSelectedItem(0);
      setAirForm(EMPTY_AIR_FORM);
      setReportTypes(next === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : []);
      setReportTypeOther("");
    }
  };

  const runTransform = (text: string, m: Mode) => {
    let nextItemForms: PerItemForm[] = [{ ...EMPTY_ITEM_FORM }];
    if (m === "inspection") {
      const out = transformInspectionText(text);
      setTextOutput(out);
      setListOutput([]);
      const count = Math.max(1, countInspectionItems(out));
      nextItemForms = parseItemDataFromText(out, count);
    } else if (m === "air-purifier") {
      setTextOutput(transformAirPurifierText(text));
      setListOutput([]);
    } else if (m === "samsung-note") {
      setListOutput(transformSamsungNoteTitles(text));
      setTextOutput("");
    } else {
      const items = transformBlankReports(text);
      setListOutput(items);
      setTextOutput("");
      // Each 미양식 card is a self-contained single-item report.
      nextItemForms = items.map((item: ResultItem) => parseItemDataFromText(item.content, 1)[0]);
      if (nextItemForms.length === 0) nextItemForms = [{ ...EMPTY_ITEM_FORM }];
    }
    setItemForms(nextItemForms);
    setSelectedItem(0);
    setEditedBlocks({});
  };

  // Auto-transform on input or mode change (debounced)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (skipAutoRef.current) {
        skipAutoRef.current = false;
        return;
      }
      // Empty input doesn't wipe outputs (mode change / 초기화 handle that),
      // so a restored result survives.
      if (inputText.trim()) runTransform(inputText, mode);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [inputText, mode]);

  // Persist the working session (debounced) so it survives reloads.
  // inputText is excluded (popup-only); editedBlocks ARE persisted so the
  // user's direct result edits don't disappear after leaving and coming back.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem("session_v1", JSON.stringify({
          mode, textOutput, listOutput, itemForms, sharedForm,
          selectedItem, airForm, editedBlocks, reportTypes, reportTypeOther,
        }));
      } catch {
        // ignore quota / private mode errors
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [mode, textOutput, listOutput, itemForms, sharedForm, selectedItem, airForm, editedBlocks, reportTypes, reportTypeOther]);

  const openInputModal = () => {
    setDraftInput(inputText);
    setInputModalOpen(true);
  };
  // 거래처 전환 시 함께 비워야 하는 현장 사진 상태.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const photoLinkRef = useRef<string>("");
  const [visitMeta, setVisitMeta] = useState<VisitDraft>({
    visited: true, vendor: "", author: "", workDate: kstDate(), arrivalTime: "", machineCount: 0, grade: "", contractEnded: false,
    workKinds: [], minutes: {}, salesIt: "", salesCopier: "", commute: "", note: "",
  });
  const clearPreviousVendorWork = (clearVendor = true) => {
    setItemForms([{ ...EMPTY_ITEM_FORM }]);
    setSharedForm(mode === "inspection" ? { ...EMPTY_SHARED_FORM, level: FIXED_INSPECTION_LEVEL } : EMPTY_SHARED_FORM);
    setAirForm(EMPTY_AIR_FORM);
    setSelectedItem(0);
    setEditedBlocks({});
    if (clearVendor) setCurrentVendor("");
    setReportTypes(mode === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : []);
    setReportTypeOther("");
    setVisitMeta({ visited: true, vendor: "", author: "", workDate: kstDate(), arrivalTime: "", machineCount: 0, grade: "", contractEnded: false, workKinds: [], minutes: {}, salesIt: "", salesCopier: "", commute: "", note: "" });
    setPhotos((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
    photoLinkRef.current = "";
  };
  const confirmInputModal = () => {
    const isNewSource = draftInput.trim() !== inputText.trim();
    if (draftInput.trim() && isNewSource) clearPreviousVendorWork();
    if (draftInput.trim() && (mode === "inspection" || mode === "blank-report")) {
      const detected = detectUnifiedInputMode(draftInput);
      if (detected !== mode) {
        delete modeStateRef.current[detected];
        handleModeChange(detected);
        skipAutoRef.current = false;
      }
      setSharedForm((prev: SharedForm) => detected === "inspection" ? { ...prev, level: FIXED_INSPECTION_LEVEL } : { ...prev, level: "" });
      setReportTypes(detected === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : detectReportTypesFromInput(draftInput));
      if (detected === "inspection") setReportTypeOther("");
    }
    setInputText(draftInput);
    if (!draftInput.trim()) resetOutputs();
    setInputModalOpen(false);
  };

  // 점검탭 검색에서 고른 양식(_원문)을 변환기에 주입 — 붙여넣기 확인과 같은 경로(자동 변환).
  const handleLoadForm = (text: string) => {
    clearPreviousVendorWork(false);
    if (mode !== "air-purifier") {
      const detected = detectUnifiedInputMode(text);
      if (detected !== mode) {
        delete modeStateRef.current[detected];
        handleModeChange(detected);
        skipAutoRef.current = false;
      }
      setSharedForm((prev: SharedForm) => detected === "inspection" ? { ...prev, level: FIXED_INSPECTION_LEVEL } : { ...prev, level: "" });
      setReportTypes(detected === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : detectReportTypesFromInput(text));
      if (detected === "inspection") setReportTypeOther("");
    }
    setInputText(text);
    setSearchOpen(false);
    showToast("양식을 불러왔어요");
  };

  // [점검/AS 불러오기]: 세션 출력에서 등급·업체명·지역·키맨(이름/연락처 분리) 추출
  const loadSharedFromInspect = (src: "inspection" | "as") => {
    const key: Mode = src === "inspection" ? "inspection" : "blank-report";
    const s = key === mode ? { textOutput, listOutput } : modeStateRef.current[key];
    if (!s) return null;
    const text = (s.textOutput && s.textOutput.trim())
      ? s.textOutput
      : (s.listOutput || []).map((i: ResultItem) => i.content).join("\n");
    if (!text.trim()) return null;
    const pick = (re: RegExp) => { const m = text.match(re); return m ? m[1].trim() : ""; };
    const company = pick(/업체명\s*[:：]\s*(.+)/);
    const region = pick(/지역\s*[:：]\s*(.+)/);
    const grade = pick(/등급\s*[:：]\s*(.+)/);
    // 키맨/접수자는 여러 줄일 수 있음(이름1 전화1\n이름2 전화2) → 구분선/다음항목 전까지 통째로.
    const kmM = text.match(/키맨\/접수자\s*[:：]\s*([\s\S]*?)(?=[\r\n]\s*(?:[ㅡ\-_=]{3,}|\d+\s*\.)|$)/);
    const keymanRaw = kmM ? kmM[1].trim() : "";
    return { grade, company, region, keymen: parseKeymen_(keymanRaw), author };
  };

  // 📷 사진 → 양식: 비전 모델로 추출 후 해당 변환기에 입력.
  //  - 청정기 탭: 청정기 양식으로 (현재 탭 유지)
  //  - 그 외(미양식 등): 점검 양식으로 (점검 탭으로 전환해 결과 표시)
  const handlePhotoPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    showToast("사진 읽는 중…");
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, 1400);
      const isAir = mode === "air-purifier";
      const resp = await visionForm(dataUrl, isAir ? "air" : "inspection");
      if (resp.ok && resp.text) {
        if (mode === "air-purifier") {
          // 청정기는 청정기 변환기를 통과시키면 정상 동작
          setInputText(resp.text);
        } else {
          // 미양식 등: blank-report 변환기가 점검 양식을 재가공하며 망가뜨리므로,
          // 변환 없이 비전 결과를 그대로 결과로 세팅하고 편집 폼만 파싱해 채운다.
          const normalizedText = normalizeVisionInspectionText(resp.text);
          const count = Math.max(1, countInspectionItems(normalizedText));
          const forms = parseItemDataFromText(normalizedText, count);
          setTextOutput(normalizedText);
          setListOutput([]);
          setItemForms(forms.length ? forms : [{ ...EMPTY_ITEM_FORM }]);
          setSelectedItem(0);
          setEditedBlocks({});
          setMode("inspection");
          setSharedForm((prev: SharedForm) => ({ ...prev, level: FIXED_INSPECTION_LEVEL }));
          setReportTypes(FIXED_INSPECTION_REPORT_TYPES);
          setReportTypeOther("");
          skipAutoRef.current = true; // 입력 변경으로 자동 변환이 덮어쓰지 않게
          setInputText(normalizedText);
        }
        showToast("사진에서 양식을 만들었어요");
      } else {
        showToast(resp.error || "사진 변환 실패", "error");
      }
    } catch {
      showToast("사진 처리 오류", "error");
    } finally {
      setPhotoBusy(false);
    }
  };

  // 미양식탭: AS 접수내용을 변환하면 출력의 업체명을 인식해 통합이력을 자동으로 띄운다.
  useEffect(() => {
    if (mode !== "blank-report") return;
    const src = listOutput[0]?.content || textOutput || "";
    const v = extractVendorFromText(src);
    if (v && v !== lastBlankVendor.current) {
      lastBlankVendor.current = v;
      setCurrentVendor(v); // 통합이력은 자동으로 띄우지 않음 — 사용자가 직접 열어 검색
    }
  }, [mode, listOutput, textOutput]);

  const buildResultText = () => {
    let text = resultBlocks
      .map((b: ResultBlock, i: number) => (editedBlocks[i] !== undefined ? mergeBlockEdit(b.text, editedBlocks[i]) : b.text))
      .join(blockJoiner);
    if ((mode === "inspection" || mode === "blank-report") && reportTypes.length) {
      text = applyReportTypeSelection(text, reportTypes, reportTypeOther);
    }
    return text;
  };
  const handlePreviewBlockChange = (block: ResultBlock, index: number, value: string) => {
    setEditedBlocks((prev: Record<number, string>) => ({ ...prev, [index]: value }));
    if (block.device === null || (mode !== "inspection" && mode !== "blank-report")) return;
    const parsed = parseItemDataFromText(value, 1)[0];
    if (!parsed) return;
    setItemForms((prev: PerItemForm[]) => prev.map((form: PerItemForm, i: number) =>
      i === block.device ? { ...form, ...parsed } : form,
    ));
  };

  const handleCopyAll = async () => {
    const target = buildResultText();

    if (!target) {
      showToast("복사할 내용이 없어요", "error");
      return;
    }

    const result = await copyTextToClipboard(target);
    showToast(result.message, result.ok ? "success" : "error");
  };

  const [sending, setSending] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false); // 탭 "더보기" 드롭다운
  const [screen, setScreen] = useState<"home" | "field" | "happycall" | "itquote" | "daily" | "weekly" | "growth">("field"); // 좌측 메뉴 화면
  const [menuOpen, setMenuOpen] = useState(false); // 좌측 ☰ 메뉴

  // 첨부 사진(갤러리 다중선택, 대량 60장+). 전송 시 Storage 병렬 업로드 → 카톡 메시지에 링크 첨부.
  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setPhotos((prev) => [...prev, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
      photoLinkRef.current = ""; // 새 사진 추가 → 캐시 무효화
    }
    e.target.value = "";
  };
  const removePhoto = (idx: number) => {
    setPhotos((prev) => {
      const p = prev[idx];
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((_, i) => i !== idx);
    });
    photoLinkRef.current = "";
  };

  // 첨부 사진 병렬 업로드(동시 4개) → 앨범 1건 생성 → 모아보기 링크 1개 반환(캐시).
  const ensurePhotoLink = async (): Promise<string> => {
    if (!photos.length) return "";
    if (photoLinkRef.current) return photoLinkRef.current;
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const urls: string[] = new Array(photos.length);
    let nextIdx = 0, done = 0;
    const worker = async () => {
      while (nextIdx < photos.length) {
        const i = nextIdx++;
        const f = photos[i].file;
        if (f.type.startsWith("video/")) {
          // 동영상은 원본 그대로 업로드 (다운스케일/변환 X)
          const ext = (f.name.split(".").pop() || "mp4").toLowerCase();
          urls[i] = await uploadPhoto(`${ymd}/${crypto.randomUUID()}.${ext}`, f, f.type || "video/mp4");
        } else {
          const dataUrl = await fileToDownscaledDataUrl(f, 1600);
          const blob = await (await fetch(dataUrl)).blob();
          urls[i] = await uploadPhoto(`${ymd}/${crypto.randomUUID()}.jpg`, blob, "image/jpeg");
        }
        done++;
        showToast(`첨부 ${done}/${photos.length} 올리는 중…`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker));
    const albumId = await createAlbum(urls, currentVendor);
    photoLinkRef.current = `${window.location.origin}${window.location.pathname}?album=${albumId}`;
    return photoLinkRef.current;
  };

  const visitKindForMode = (): WorkKind =>
    mode === "inspection" || mode === "air-purifier" ? "inspection" : mode === "blank-report" ? "as" :
    mode === "logistics" ? "delivery" : mode === "pc" ? "pc" : mode === "bulman" ? "bulman" : mode === "misu" ? "misu" :
    mode === "recontract" ? "recontract" : "overage";

  const recordVisit = async (target: string, destination?: SendDestination) => {
    const parsedVendor = extractVendorFromText(target);
    const parsedGrade = target.match(/등급\s*[:：]?\s*\(?\s*([^,\n\r)]+)/)?.[1]?.trim() || "";
    const vendor = parsedVendor || logisticsForm.vendor || (pcSubTab === "copier" ? copierExpansionForm.company : pcForm.company) || String(curCatForm["업체명"] || currentVendor || "");
    const kind: WorkKind = destination === "inspection" ? "inspection" : destination === "as" ? "as" : visitKindForMode();
    const existingMinutes = Number(visitMeta.minutes[kind] || 0);
    const formDuration = mode === "air-purifier" ? Number(airForm.duration || 0) : Number(sharedForm.duration || 0);
    const arrivalTime = visitMeta.arrivalTime || (mode === "air-purifier"
      ? (airForm.arrivalHour ? `${airForm.arrivalHour}:${airForm.arrivalMinute || "00"}` : "")
      : (sharedForm.arrivalHour ? `${sharedForm.arrivalHour}:${sharedForm.arrivalMinute || "00"}` : ""));
    await saveVisit({
      ...visitMeta, vendor, author, workDate: kstDate(), arrivalTime, grade: visitMeta.grade || parsedGrade,
      machineCount: visitMeta.machineCount || (mode === "inspection" || mode === "blank-report" ? Math.max(1, itemForms.length) : mode === "air-purifier" ? 1 : 0),
      workKinds: Array.from(new Set([...visitMeta.workKinds, kind, ...(reportTypes.includes("점검") ? ["inspection" as WorkKind] : []), ...(reportTypes.includes("AS") ? ["as" as WorkKind] : [])])),
      minutes: { ...visitMeta.minutes, [kind]: existingMinutes || formDuration },
    }, target);
  };

  const handleSendAll = async (kind: "normal" | "자가" | "부품" = "normal", destination?: SendDestination) => {
    let target = buildResultText();
    if (!target) {
      showToast("보낼 내용이 없어요", "error");
      return;
    }
    if (sending) return;
    setSending(true);
    showToast(kind === "normal" ? "보내는 중…" : `${kind} 요청 보내는 중…`);
    try {
      const link = await ensurePhotoLink();
      if (link) target += `\n\n📷 현장사진 ${photos.length}장 모아보기:\n${link}`;
    } catch (e) {
      setSending(false);
      showToast("사진 업로드 실패: " + ((e as Error).message || "오류"), "error");
      return;
    }

    // 확장성: IT는 PC확장성, 복합기(기타)는 복합기확장성으로 저장/전송.
    if (mode === "pc") {
      const res = pcSubTab === "copier"
        ? await sendCopierExpansionForm(copierExpansionForm, author, target, new Date().toISOString())
        : await sendPcForm(pcForm, author, target, new Date().toISOString());
      if (res.ok) try { await recordVisit(target); } catch (e) { res.message = `${res.message || "전송 완료"} · 방문집계 실패: ${(e as Error).message}`; }
      setSending(false);
      showToast(res.ok ? (res.message || "전송 완료") : "전송 실패: " + (res.error || "오류"), res.ok ? "success" : "error");
      return;
    }

    if (mode === "logistics") {
      const res = await sendLogisticsForm(logisticsForm, author, target, new Date().toISOString());
      if (res.ok) try { await recordVisit(target); } catch (e) { res.message = `${res.message || "전송 완료"} · 방문집계 실패: ${(e as Error).message}`; }
      setSending(false);
      showToast(res.ok ? (res.message || "물류방 전송 완료") : "전송 실패: " + (res.error || "오류"), res.ok ? "success" : "error");
      return;
    }

    // 카테고리(불만/재계약/초과조정): 테이블 저장 + 방 전송
    if (isCat) {
      const res = await sendCategoryForm(mode, curCatForm, author, target, new Date().toISOString());
      if (res.ok) try { await recordVisit(target); } catch (e) { res.message = `${res.message || "전송 완료"} · 방문집계 실패: ${(e as Error).message}`; }
      setSending(false);
      showToast(res.ok ? (res.message || "전송 완료") : "전송 실패: " + (res.error || "오류"), res.ok ? "success" : "error");
      return;
    }

    const modeLabel =
      mode === "inspection" ? "점검" :
      mode === "blank-report" ? "AS" :
      mode === "air-purifier" ? "청정기" :
      mode === "samsung-note" ? "삼성노트" : String(mode);
    const res = await sendForm({
      text: target,
      vendor: currentVendor,
      mode: modeLabel,
      author,
      ts: new Date().toISOString(),
    }, kind, destination);
    if (res.ok && kind === "normal") try { await recordVisit(target, destination); } catch (e) { res.message = `${res.message || "전송 완료"} · 방문집계 실패: ${(e as Error).message}`; }
    setSending(false);
    if (res.ok) {
      showToast(res.message || "전송 완료 — 시트 저장 & 카톡 게시됨", "success");
    } else {
      showToast("전송 실패: " + (res.error || "알 수 없는 오류"), "error");
    }
  };

  const handleReset = () => {
    setInputText("");
    resetOutputs();
    setItemForms([{ ...EMPTY_ITEM_FORM }]);
    setSharedForm(mode === "inspection" ? { ...EMPTY_SHARED_FORM, level: FIXED_INSPECTION_LEVEL } : EMPTY_SHARED_FORM);
    setSelectedItem(0);
    setAirForm(EMPTY_AIR_FORM);
    setPhotos((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
    photoLinkRef.current = "";
    setPcForm({ ...EMPTY_PC_FORM });
    setCopierExpansionForm({ ...EMPTY_COPIER_EXPANSION_FORM });
    setLogisticsForm({ ...EMPTY_LOGISTICS_FORM });
    setReportTypes(mode === "inspection" ? FIXED_INSPECTION_REPORT_TYPES : []);
    setReportTypeOther("");
    setVisitMeta({ visited: true, vendor: "", author: "", workDate: kstDate(), arrivalTime: "", machineCount: 0, grade: "", contractEnded: false, workKinds: [], minutes: {}, salesIt: "", salesCopier: "", commute: "", note: "" });
    if (isCat) setCatForms((prev) => ({ ...prev, [mode]: emptyCatForm(mode) }));
    try { localStorage.removeItem("session_v1"); } catch { /* ignore */ }
    showToast("초기화 완료");
  };

  const addInspectionDevice = (info: DeviceInfo) => {
    const parts = inspectionDeviceParts(buildResultText());
    if (!parts.devices.length) {
      showToast("먼저 기존 점검 양식을 불러오세요", "error");
      return;
    }
    const nextIndex = parts.devices.length;
    const nextDevices = [...parts.devices, [`${nextIndex + 1}.`, ...NEW_DEVICE_LINES]];
    setTextOutput(rebuildInspectionDevices(parts.header, nextDevices, parts.footer));
    setItemForms((prev) => [...prev, { ...EMPTY_ITEM_FORM, ...info }]);
    setSelectedItem(nextIndex);
    showToast(`${nextIndex + 1}번 기기를 추가했어요`);
  };

  const updateInspectionDevice = (index: number, info: DeviceInfo) => {
    setItemForms((prev) => prev.map((form, i) => i === index ? { ...form, ...info } : form));
    setSelectedItem(index);
  };

  const moveInspectionDevice = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const parts = inspectionDeviceParts(buildResultText());
    if (target < 0 || target >= parts.devices.length) return;
    const devices = [...parts.devices];
    [devices[index], devices[target]] = [devices[target], devices[index]];
    setTextOutput(rebuildInspectionDevices(parts.header, devices, parts.footer));
    setItemForms((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSelectedItem((current) => current === index ? target : current === target ? index : current);
    setEditedBlocks({});
  };

  const reorderInspectionDevice = (from: number, to: number) => {
    const parts = inspectionDeviceParts(buildResultText());
    if (from === to || from < 0 || to < 0 || from >= parts.devices.length || to >= parts.devices.length) return;
    const reorder = <T,>(items: T[]) => {
      const next = [...items];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return next;
    };
    setTextOutput(rebuildInspectionDevices(parts.header, reorder(parts.devices), parts.footer));
    setItemForms((prev) => reorder(prev));
    setSelectedItem((current) => {
      if (current === from) return to;
      if (from < to && current > from && current <= to) return current - 1;
      if (from > to && current >= to && current < from) return current + 1;
      return current;
    });
    setEditedBlocks({});
  };

  const removeInspectionDevice = (index: number) => {
    const parts = inspectionDeviceParts(buildResultText());
    if (parts.devices.length <= 1) return;
    if (!window.confirm(`${index + 1}번 기기를 양식에서 삭제할까요?`)) return;
    const devices = parts.devices.filter((_, i) => i !== index);
    setTextOutput(rebuildInspectionDevices(parts.header, devices, parts.footer));
    setItemForms((prev) => prev.filter((_, i) => i !== index));
    setSelectedItem((current) => current === index ? Math.min(index, devices.length - 1) : current > index ? current - 1 : current);
    setEditedBlocks({});
    showToast("기기를 삭제했어요");
  };


  const hasOutput = textOutput.length > 0 || listOutput.length > 0 || (mode === "pc" && (pcSubTab === "copier" ? copierExpansionFilled : pcFilled)) || (mode === "logistics" && logisticsFilled) || (isCat && catFilled);
  const appScreens = [["home", "홈"], ["daily", "일일업무"], ["weekly", "주간현황판"], ["growth", "성장기록"], ["happycall", "해피콜"], ["itquote", "IT 견적"], ["field", "FIELD"]] as [typeof screen, string][];

  return (
    <div className={`min-h-screen text-slate-900 ${screen === "field" ? "bg-white" : "bg-[#F4F6FA]"}`}>
      {/* 좌측 메뉴 드로어 */}
      {menuOpen && (
        <div className="fixed inset-0 z-[80] flex" onClick={() => setMenuOpen(false)}>
          <div className="h-full w-64 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="text-lg font-bold text-slate-900">퍼스트전산 CS팀</div>
              <div className="text-[11px] text-slate-400">현장 업무 통합</div>
            </div>
            <nav className="p-2">
              {([["home", "홈"], ["field", "FIELD"], ["daily", "일일업무"], ["weekly", "주간현황판"], ["growth", "성장기록"], ["happycall", "해피콜"], ["itquote", "IT 견적"]] as [typeof screen, string][]).map(([key, label]) => (
                <button key={key} type="button"
                  onClick={() => { setScreen(key); setMenuOpen(false); }}
                  className={`block w-full rounded-xl px-4 py-3 text-left text-sm transition ${screen === key ? "bg-[#F1F5F9] font-bold text-[#334155]" : "font-medium text-slate-600 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
              <a
                href="/manual/field-manual.svg"
                target="_blank"
                rel="noreferrer"
                className="mt-2 block w-full rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                사용 매뉴얼 이미지 ↗
              </a>
            </nav>
          </div>
          <div className="flex-1 bg-black/30" />
        </div>
      )}

      {screen !== "field" && (
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-[#111827] text-white lg:flex">
          <div className="border-b border-white/10 px-5 py-5">
            <div className="text-base font-black">FIRSTOA ERP</div>
            <div className="mt-1 text-xs font-semibold text-slate-400">현장 업무 운영</div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {appScreens.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setScreen(key)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-bold transition ${screen === key ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
                <span>{label}</span>
                {screen === key && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
              </button>
            ))}
          </nav>
          <div className="border-t border-white/10 px-5 py-4 text-xs text-slate-400">{author || "작성자 미선택"}</div>
        </aside>
      )}

      <div className={`mx-auto flex flex-col px-3 pt-4 sm:px-6 sm:pt-6 ${screen === "daily" || screen === "weekly" || screen === "growth" ? "max-w-[1500px] pb-16 lg:ml-64 lg:max-w-none lg:px-8" : "max-w-3xl"} ${screen === "field" && hasOutput && !previewCollapsed ? "pb-[46vh]" : screen === "daily" || screen === "weekly" || screen === "growth" ? "" : "pb-60"}`}>
        {/* 상단 헤더 존 — 필드 화면 배경 띠 */}
        <div className={`-mx-3 px-3 sm:-mx-6 sm:px-6 ${screen === "field" ? "-mt-4 mb-3 bg-gradient-to-br from-[#27375C] to-[#1A2440] pb-3 pt-5 shadow-md sm:-mt-6 sm:pt-7" : ""}`}>
        {/* Header — 브랜딩 */}
        <header className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="메뉴"
              className={`flex h-8 w-8 items-center justify-center rounded-md border transition active:scale-95 ${screen === "field" ? "border-white/20 bg-white/10 hover:bg-white/20" : "border-slate-200 bg-white hover:bg-slate-50 lg:hidden"}`}>
              <span className="flex flex-col gap-[3px]"><span className={`h-0.5 w-4 rounded ${screen === "field" ? "bg-white" : "bg-slate-700"}`} /><span className={`h-0.5 w-4 rounded ${screen === "field" ? "bg-white" : "bg-slate-700"}`} /><span className={`h-0.5 w-4 rounded ${screen === "field" ? "bg-white" : "bg-slate-700"}`} /></span>
            </button>
            <h1 className={`text-xl font-black tracking-tight sm:text-2xl ${screen === "field" ? "text-white" : "text-slate-950"}`}>
              {screen === "field" ? "FIELD" : screen === "home" ? "홈" : screen === "happycall" ? "해피콜" : screen === "itquote" ? "IT 견적" : screen === "daily" ? "일일업무" : screen === "weekly" ? "주간현황판" : "성장기록"}
            </h1>
          </div>
          {screen === "field" && (
            <div className="flex items-center gap-1">
              {(mode === "inspection" || mode === "air-purifier" || mode === "blank-report") && (
                <button type="button" onClick={() => !photoBusy && photoInputRef.current?.click()} disabled={photoBusy} aria-label="사진양식"
                  className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white leading-none transition hover:bg-slate-50 active:scale-95 disabled:opacity-40"><span className="text-sm">{photoBusy ? "⏳" : "📷"}</span><span className="mt-0.5 text-[9px] font-bold text-slate-600">사진</span></button>
              )}
              <button type="button" onClick={() => setHistoryOpen(true)} aria-label="통합이력"
                className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white leading-none transition hover:bg-slate-50 active:scale-95"><span className="text-sm">🗂️</span><span className="mt-0.5 text-[9px] font-bold text-slate-600">이력</span></button>
              {(mode === "inspection" || mode === "air-purifier" || mode === "blank-report") && (
                <button type="button" onClick={() => setSearchOpen(true)} aria-label="거래처검색"
                  className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white leading-none transition hover:bg-slate-50 active:scale-95"><span className="text-sm">🔍</span><span className="mt-0.5 text-[9px] font-bold text-slate-600">검색</span></button>
              )}
              {(mode === "inspection" || mode === "air-purifier" || mode === "blank-report") && (
                <button type="button" onClick={openInputModal} aria-label="원본입력"
                  className="relative flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white leading-none transition hover:bg-slate-50 active:scale-95">
                  <span className="text-sm">📝</span><span className="mt-0.5 text-[9px] font-bold text-slate-600">원본</span>{!!inputText.trim() && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />}
                </button>
              )}
            </div>
          )}
        </header>

        {/* 홈 / 해피콜 / IT견적 화면 */}
        {screen === "home" && <Home onGoField={() => setScreen("field")} />}
        {screen === "daily" && <WorkDashboard kind="daily" author={author} />}
        {screen === "weekly" && <WorkDashboard kind="weekly" author={author} />}
        {screen === "growth" && <GrowthHub author={author} />}
        {(screen === "happycall" || screen === "itquote") && (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
            <div className="text-3xl">🚧</div>
            <div className="mt-2 text-base font-bold text-slate-700">{screen === "happycall" ? "해피콜" : "IT 견적"}</div>
            <div className="mt-1 text-sm text-slate-400">구상 중 — 곧 만들어집니다</div>
          </div>
        )}

        {screen === "field" && (<>
        {/* ===== FIELD 화면 ===== */}

        {/* 상단 탭 — 점검·AS는 하나로 합치고 내부에서 원본 형식만 전환 */}
        <div className="relative">
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/10 p-1" role="tablist">
            {([["점검·AS", "inspection"], ["물류", "logistics"], ["확장성", "pc"]] as [string, Mode][]).map(([label, target]) => {
              const active = target === "inspection" ? (mode === "inspection" || mode === "air-purifier" || mode === "blank-report") : mode === target;
              return (
                <button
                  key={label}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setMoreOpen(false); if (!active) handleModeChange(target); }}
                  className={`rounded-xl py-2.5 text-sm transition ${active ? "bg-white font-bold text-slate-900 shadow-sm" : "font-bold text-white/70 hover:text-white"}`}
                >
                  {label}
                </button>
              );
            })}
            {(() => {
              const moreActive = mode === "bulman" || mode === "misu" || mode === "overage-adjust" || mode === "recontract";
              return (
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className={`rounded-xl py-2.5 text-sm font-bold transition ${moreActive ? "bg-white text-slate-900 shadow-sm" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                >
                  {moreActive ? config.label : "더보기"} ▾
                </button>
              );
            })()}
          </div>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-1 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {([["불만", "bulman"], ["미수", "misu"], ["초과조정", "overage-adjust"], ["재계약", "recontract"]] as [string, Mode][]).map(([label, target]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setMoreOpen(false); if (mode !== target) handleModeChange(target); }}
                    className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${mode === target ? "font-bold text-slate-900" : "text-slate-600"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 점검·AS 내부에서는 기기 종류만 선택. 원본 형식은 자동 감지. */}
        {(mode === "inspection" || mode === "air-purifier" || mode === "blank-report") && (
          <div className="mt-2 flex gap-1 rounded-xl bg-white/10 p-1">
            {([["복합기", "inspection"], ["청정기", "air-purifier"]] as [string, Mode][]).map(([label, target]) => {
              const active = target === "inspection" ? mode === "inspection" || mode === "blank-report" : mode === target;
              return (
                <button
                  key={label}
                  onClick={() => { if (!active) handleModeChange(target); }}
                  className={`flex-1 rounded-lg py-2 text-sm transition ${
                    active ? "bg-white font-bold text-slate-900 shadow-sm" : "font-bold text-white/70 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {mode === "pc" && (
          <div className="mt-2 flex gap-1 rounded-xl bg-white/10 p-1">
            {([["it", "IT"], ["copier", "복합기(기타)"]] as [typeof pcSubTab, string][]).map(([key, label]) => {
              const active = pcSubTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPcSubTab(key)}
                  className={`flex-1 rounded-lg py-2 text-sm transition ${
                    active ? "bg-white font-bold text-slate-900 shadow-sm" : "font-bold text-white/70 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        </>)}{/* /필드 탭 */}
        </div>{/* /헤더 존 */}

        {screen === "field" && (<>
        <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoPick} className="hidden" />

        <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-xl" aria-hidden="true">{FIELD_GUIDES[mode].icon}</span>
            <div className="min-w-0">
              <div className="font-bold text-slate-900">{FIELD_GUIDES[mode].title}</div>
              <div className="mt-0.5 text-xs leading-5 text-slate-500">{FIELD_GUIDES[mode].description}</div>
            </div>
          </div>
          {mode !== "inspection" && mode !== "blank-report" && mode !== "air-purifier" && mode !== "pc" && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-800">
              카톡방 자동전송은 아직 준비 중입니다. 내용을 작성한 뒤 하단의 <b>복사</b> 버튼을 눌러 카톡방에 붙여넣어 주세요.
            </div>
          )}
        </div>

        {/* Processing form — 미양식 + 점검 */}
        {showForm && (
          <ProcessingFormPanel
            itemForm={currentItemForm}
            setItemF={setItemF}
            shared={sharedForm}
            setSharedF={setSharedF}
            itemCount={itemForms.length}
            itemLabels={itemLabels}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            accent={config.accent}
            bgSoft={config.bgSoft}
            author={author}
            setAuthor={handleSetAuthor}
            reportTypes={reportTypes}
            reportTypeOther={reportTypeOther}
            setReportTypes={setReportTypes}
            setReportTypeOther={setReportTypeOther}
            canManageDevices={mode === "inspection"}
            allItemForms={itemForms}
            onAddDevice={addInspectionDevice}
            onUpdateDevice={updateInspectionDevice}
            onMoveDevice={moveInspectionDevice}
            onReorderDevice={reorderInspectionDevice}
            onRemoveDevice={removeInspectionDevice}
            showLevel
            showHantinParking={mode === "blank-report" || mode === "inspection"}
          />
        )}

        {/* Air purifier form — only for 청정기 */}
        {showAirForm && (
          <AirPurifierFormPanel
            form={airForm}
            setAirF={setAirF}
            accent={config.accent}
            author={author}
            setAuthor={handleSetAuthor}
          />
        )}

        {/* 확장성 form */}
        {mode === "pc" && (
          <div className="space-y-3">
            {pcSubTab === "it" ? (
              <PcForm
                form={pcForm}
                setForm={setPcForm}
                author={author}
                setAuthor={handleSetAuthor}
                accent={config.accent}
                onLoad={loadSharedFromInspect}
                onError={(m) => showToast(m, "error")}
              />
            ) : (
              <CopierExpansionForm
                form={copierExpansionForm}
                setForm={setCopierExpansionForm}
                author={author}
                setAuthor={handleSetAuthor}
                onLoad={loadSharedFromInspect}
                onError={(m) => showToast(m, "error")}
              />
            )}
          </div>
        )}

        {mode === "logistics" && <LogisticsForm form={logisticsForm} setForm={setLogisticsForm} author={author} setAuthor={handleSetAuthor} />}

        {/* 카테고리 폼 (불만/재계약/초과조정) */}
        {isCat && (
          <CategoryForm
            schemaKey={mode}
            form={curCatForm}
            setForm={(f) => setCatForms((prev) => ({ ...prev, [mode]: f }))}
            author={author}
            setAuthor={handleSetAuthor}
            onLoad={loadSharedFromInspect}
            onError={(m) => showToast(m, "error")}
          />
        )}

        </>)}

      </div>

      {/* Sticky bottom: result panel + action bar (FIELD 전용) */}
      {screen === "field" && (
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        {hasOutput && (
          <div className="mx-auto max-w-3xl px-3 pt-1 sm:px-6">
            <button
              type="button"
              onClick={() => setPreviewCollapsed((v) => !v)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600"
            >
              {previewCollapsed ? "결과 미리보기 펼치기 ▲" : "결과 미리보기 접기 ▼"}
            </button>
            {!previewCollapsed && (
            <div ref={resultScrollRef} className="relative space-y-1.5 overflow-y-auto pb-2" style={{ maxHeight: "30vh" }}>
                {resultBlocks.map((block: ResultBlock, i: number) => {
                  const active = block.device !== null && block.device === selectedItem;
                  const text = editedBlocks[i] !== undefined ? editedBlocks[i] : block.text;
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        if (block.device !== null) deviceBlockRefs.current[block.device] = el;
                      }}
                      className="rounded-lg p-1"
                      style={{
                        background: active ? config.bgSoft : "#F8FAFC",
                        borderLeft: `3px solid ${active ? config.accent : "transparent"}`,
                      }}
                    >
                      <textarea
                        value={text}
                        onChange={(e) => handlePreviewBlockChange(block, i, e.target.value)}
                        rows={Math.max(2, text.split("\n").length)}
                        className="w-full resize-none bg-transparent p-1 font-mono text-[11px] leading-snug text-slate-800 outline-none"
                      />
                    </div>
                  );
                })}
            </div>
            )}
          </div>
        )}
        {/* 첨부 사진 썸네일 — 첨부했을 때만 표시 */}
        {photos.length > 0 && (
          <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-6">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <div key={p.url} className="relative shrink-0">
                  {p.file.type.startsWith("video/") ? (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-800 text-lg text-white">🎥</div>
                  ) : (
                    <img src={p.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  )}
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white" aria-label="사진 제거">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">첨부 {photos.length}개 — 보내기 시 카톡에 링크로 첨부 (사진·영상)</div>
          </div>
        )}

        {/* 액션: 보조줄(초기화·복사·사진첨부) + 전송줄(보내기·자가·부품) */}
        <div className="mx-auto max-w-3xl space-y-2 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleReset}
              className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 active:scale-[0.98]"
            >
              초기화
            </button>
            <button
              onClick={handleCopyAll}
              disabled={!hasOutput}
              className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40"
            >
              복사
            </button>
            <label className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]">
              📷 사진/영상{photos.length > 0 ? ` ${photos.length}` : ""}
              <input type="file" accept="image/*,video/*" multiple onChange={handlePhotoSelect} className="hidden" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {(mode === "inspection" || mode === "blank-report") ? <>
              <button onClick={() => handleSendAll("normal", "inspection")} disabled={!hasOutput || sending} className="flex-1 whitespace-nowrap rounded-lg bg-blue-700 py-3 text-sm font-bold text-white disabled:bg-slate-200">{sending ? "전송 중…" : "점검방 보내기"}</button>
              <button onClick={() => handleSendAll("normal", "as")} disabled={!hasOutput || sending} className="flex-1 whitespace-nowrap rounded-lg bg-rose-600 py-3 text-sm font-bold text-white disabled:bg-slate-200">{sending ? "전송 중…" : "AS방 보내기"}</button>
            </> : <button onClick={() => handleSendAll("normal")} disabled={!hasOutput || sending} className="flex-[1.5] whitespace-nowrap rounded-lg bg-slate-700 py-3 text-sm font-semibold text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-400">{sending ? "보내는 중…" : mode === "logistics" ? "물류방 보내기" : "보내기"}</button>}
            {(mode === "inspection" || mode === "blank-report") && (
              <>
                <button
                  onClick={() => handleSendAll("자가")}
                  disabled={!hasOutput || sending}
                  className="flex-1 whitespace-nowrap rounded-lg border py-3 text-sm font-semibold tracking-tight transition active:scale-[0.98] disabled:opacity-40"
                  style={{ borderColor: "#0f766e", color: "#0f766e", background: "#fff" }}
                >
                  자가신청
                </button>
                <button
                  onClick={() => handleSendAll("부품")}
                  disabled={!hasOutput || sending}
                  className="flex-1 whitespace-nowrap rounded-lg border py-3 text-sm font-semibold tracking-tight transition active:scale-[0.98] disabled:opacity-40"
                  style={{ borderColor: "#b45309", color: "#b45309", background: "#fff" }}
                >
                  부품신청
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* 원본 입력 팝업 */}
      {inputModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/50 sm:items-center sm:justify-center"
          onClick={() => setInputModalOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-bold text-slate-900">원본 입력</span>
              <span className="text-[11px] text-slate-400">입력칸을 길게 눌러 붙여넣기</span>
            </div>
            <textarea
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              placeholder={config.placeholder}
              autoFocus
              className="m-3 h-[45vh] resize-none rounded-xl bg-slate-50 p-3 font-mono text-sm outline-none focus:bg-white"
            />
            <div className="flex gap-2 border-t border-slate-100 p-3">
              <button
                type="button"
                onClick={() => setInputModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setDraftInput("")}
                className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-500"
              >
                초기화
              </button>
              <button
                type="button"
                onClick={confirmInputModal}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ background: config.accent }}
              >
                확인 (변환)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사용 설명서 */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/50 sm:items-center sm:justify-center"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-slate-50 sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 text-white"
              style={{ background: config.accent }}
            >
              <div>
                <div className="text-base font-bold">사용 설명서</div>
                <div className="text-xs opacity-80">처음이어도 그대로 따라 하면 돼요</div>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="rounded-full bg-white/20 px-3 py-1 text-sm font-semibold"
              >
                닫기 ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              {/* 한 줄 소개 */}
              <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-600 shadow-sm">
                <b style={{ color: config.accent }}>거래처를 검색</b>해 지난 점검양식을 불러오거나,<br />
                원본을 붙여넣어 <b style={{ color: config.accent }}>깔끔한 보고 양식</b>으로 바꿔주는 앱이에요 📄
              </div>

              {/* 기본 순서 - 스텝 배지 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-bold text-slate-900">⭐ 기본 순서 (이것만 기억!)</div>
                <div className="space-y-2.5">
                  {[
                    ["맨 위에서 ", "탭", " 고르기 (점검[복합기/청정기] / AS)"],
                    ["", "🔍 거래처검색", " → 지난 양식 불러오기"],
                    ["또는 ", "📝 원본입력", " → 카톡 원본 붙여넣기"],
                    ["", "작성자", " 고르고 빈 칸 채우기"],
                    ["맨 아래 ", "결과", " 확인 후 ", "📋 복사"],
                  ].map((parts: string[], idx: number) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: config.accent }}
                      >
                        {idx + 1}
                      </span>
                      <span className="text-sm text-slate-700">
                        {parts[0]}<b className="text-slate-900">{parts[1]}</b>{parts[2] ?? ""}<b className="text-slate-900">{parts[3] ?? ""}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 상단 아이콘 3개 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-slate-900">🔲 상단 아이콘</div>
                <div className="space-y-1.5 text-sm text-slate-700">
                  <div><b className="text-slate-900">🔍 거래처검색</b> — 거래처명으로 지난 점검/AS 양식을 찾아 불러오기 (점검 탭)</div>
                  <div><b className="text-slate-900">📝 원본입력</b> — 카톡 원본을 직접 붙여넣어 변환</div>
                  <div><b className="text-slate-900">🗂️ 통합이력</b> — 그 거래처의 점검·AS·초과·미수·불만 등 전체 이력 보기</div>
                </div>
              </div>

              {/* 탭 안내 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-slate-900">🗂️ 탭 안내</div>
                <div className="space-y-1.5 text-sm text-slate-700">
                  <div><b className="text-slate-900">점검</b> — 복합기/프린터 점검 (거래처검색·사진양식 지원). 안에서 <b className="text-slate-900">복합기/청정기</b> 토글로 청정기 점검도</div>
                  <div><b className="text-slate-900">AS</b> — AS 접수내용을 붙여넣어 깔끔한 양식으로 변환</div>
                </div>
              </div>

              {/* 칸 채우기 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-slate-900">✏️ 칸 채우기</div>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  <li>• <b className="text-slate-900">작성자</b> : 탭하면 팀별 이름 → 내 이름 선택 (기억됨)</li>
                  <li>• <b className="text-slate-900">매수 / 잔량</b> : 숫자 직접 입력</li>
                  <li>• <b className="text-slate-900">여분</b> : 원래 내용이 들어와 있어 숫자만 고치면 됨</li>
                  <li>• <b className="text-slate-900">한틴이카 / 주차비</b> : 단추로 고르거나 직접 입력</li>
                  <li>• <b className="text-slate-900">부품·자가신청</b> : 평소 접힘, 필요할 때 “펼치기 ▼”</li>
                </ul>
                <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                  💡 칸을 채우면 아래 결과가 바로바로 바뀝니다.
                </div>
              </div>

              {/* 기기 여러 대 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-slate-900">🖨️ 기기가 여러 대일 때 (점검)</div>
                <p className="text-sm leading-relaxed text-slate-700">
                  폼 위쪽 <b className="text-slate-900">“기기 선택”</b>에서 기기를 고르면 아래 결과도 그 기기로 따라가요.
                  기기를 바꿔가며 채우면 되고, 먼저 채운 건 그대로 저장돼요.
                </p>
              </div>

              {/* 결과/복사 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 text-sm font-bold text-slate-900">📋 결과 / 복사</div>
                <p className="text-sm leading-relaxed text-slate-700">
                  맨 아래 <b className="text-slate-900">결과 칸</b>은 위아래로 넘겨 보고, 글자를 직접 고칠 수도 있어요.
                  다 됐으면 <b className="text-slate-900">복사</b> 누르고 메신저에 붙여넣기!
                </p>
              </div>

              {/* 자동 저장 */}
              <div
                className="rounded-2xl p-4 text-sm leading-relaxed"
                style={{ background: config.bgSoft, color: config.textDark }}
              >
                <b>🔒 안심하세요</b><br />
                적던 내용은 자동 저장돼요. 앱을 닫았다 와도 그대로 있어요.
                처음부터 다시 하려면 <b>초기화</b>를 누르세요.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 거래처 검색 팝업 */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-slate-900/40 backdrop-blur-sm sm:items-center sm:justify-center"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="flex h-[90vh] w-full flex-col rounded-t-3xl bg-white sm:h-[82vh] sm:max-w-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-3xl px-5 py-4 text-white" style={{ background: config.accent }}>
              <div className="text-base font-bold">{mode === "air-purifier" ? "청정기 거래처 찾기" : "거래처 점검양식 찾기"}</div>
              <button type="button" onClick={() => setSearchOpen(false)} className="rounded-xl bg-white/20 px-3 py-1.5 text-sm font-semibold">
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {mode === "air-purifier" ? (
                <AirSearch
                  accent={config.accent}
                  onLoadForm={handleLoadForm}
                  onVendor={setCurrentVendor}
                  onError={(m) => showToast(m, "error")}
                />
              ) : (
                <VendorSearch
                  accent={config.accent}
                  onLoadForm={handleLoadForm}
                  onVendor={setCurrentVendor}
                  onError={(m) => showToast(m, "error")}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 통합이력 팝업 (controlled) */}
      <UnifiedHistory
        vendor={currentVendor}
        accent={config.accent}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onError={(m) => showToast(m, "error")}
      />

      {/* Toast */}
      {toast && (
        <div
          className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl px-5 py-3 text-center text-base font-bold leading-6 shadow-2xl"
          style={{
            background: toast.kind === "success" ? "#065F46" : "#991B1B",
            color: "white",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
