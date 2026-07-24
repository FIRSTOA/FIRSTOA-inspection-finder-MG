/**
 * FIELD 외부 시트 동기화용 Apps Script 웹앱
 *
 * Script Properties에 FIELD_SYNC_SECRET를 넣고 웹앱으로 배포합니다.
 * Supabase Edge Function의 FIELD_SHEETS_WEBHOOK_URL / FIELD_SHEETS_WEBHOOK_SECRET와 연결합니다.
 */
const FIELD_SHEETS = {
  expansion_it: { spreadsheetId: "1Q0u_ok6s3o7_qnSFyDW632zkspV_MqttRnFQ4uurmpg", sheetId: 1571265600 },
  expansion_copier: { spreadsheetId: "10850TfeSvd0Z1iiI1ycCyGskGRPXicRUd1_Xx996QKQ", sheetId: 746760933 },
  contact_change: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 1289086745 },
  complaint: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 419415178 },
};

function doPost(e) {
  try {
    const request = JSON.parse(e.postData && e.postData.contents || "{}");
    const secret = PropertiesService.getScriptProperties().getProperty("FIELD_SYNC_SECRET");
    if (!secret || request.secret !== secret) return json_({ ok: false, error: "unauthorized" });
    if (request.action !== "append_field_sheet_row") return json_({ ok: false, error: "unknown action" });
    const result = appendFieldSheetRow_(request);
    return json_({ ok: true, row: result.row, sheet: result.sheet });
  } catch (error) {
    return json_({ ok: false, error: error && error.message || String(error) });
  }
}

function appendFieldSheetRow_(request) {
  const config = FIELD_SHEETS[request.category];
  if (!config) throw new Error("지원하지 않는 동기화 종류입니다.");
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sourceSheet = spreadsheet.getSheets().find((item) => item.getSheetId() === config.sheetId);
  if (!sourceSheet) throw new Error("대상 시트 탭을 찾지 못했습니다.");
  const sheet = request.testMode ? getOrCreateTestSheet_(spreadsheet, sourceSheet, request.category) : sourceSheet;

  const headerRow = findHeaderRow_(sheet, request.category);
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const data = request.payload && request.payload.data || {};
  const labelValues = parseLabeledText_(request.sourceText || "");
  const valueFor = (header) => fieldValue_(request.category, header, data, request, labelValues);
  const previousRow = Math.max(headerRow + 1, sheet.getLastRow());
  sheet.insertRowAfter(previousRow);
  const row = previousRow + 1;

  // 기존 행의 수식은 새 행에도 복사하고, 사람이 입력하는 열만 덮어씁니다.
  headers.forEach((header, index) => {
    const column = index + 1;
    const previous = sheet.getRange(previousRow, column);
    const formula = previous.getFormula();
    if (formula) previous.copyTo(sheet.getRange(row, column), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    const value = valueFor(header);
    if (value !== undefined) sheet.getRange(row, column).setValue(value);
  });

  return { row, sheet: sheet.getName() };
}

function findHeaderRow_(sheet, category) {
  const signatures = {
    expansion_it: ["업체명", "세부사양"],
    expansion_copier: ["상호", "등록자"],
    contact_change: ["업체명", "변경전"],
    complaint: ["업체명", "불만내용"],
  };
  const required = signatures[category] || [];
  const rows = Math.min(20, Math.max(1, sheet.getLastRow()));
  const values = sheet.getRange(1, 1, rows, sheet.getLastColumn()).getDisplayValues();
  const index = values.findIndex((row) => required.every((header) => row.includes(header)));
  return index >= 0 ? index + 1 : 1;
}

function getOrCreateTestSheet_(spreadsheet, sourceSheet, category) {
  const name = `웹앱_테스트_${category}`;
  let testSheet = spreadsheet.getSheetByName(name);
  if (testSheet) return testSheet;
  testSheet = spreadsheet.insertSheet(name);
  sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).copyTo(testSheet.getRange(1, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
  testSheet.setFrozenRows(1);
  return testSheet;
}

function fieldValue_(category, header, data, request, labels) {
  const submittedAt = new Date(request.submittedAt || new Date());
  const copierPeriod = category === "expansion_copier" ? {
    "년월": Utilities.formatDate(submittedAt, "Asia/Seoul", "yy년 MM월"),
    "주차": `${isoWeek_(submittedAt)}주차`,
  } : {};
  const base = {
    "웹앱 전송ID": request.jobId,
    "날짜": request.submittedAt,
    "등록일": request.submittedAt,
    "작성자": request.author,
    ...copierPeriod,
  };
  if (Object.prototype.hasOwnProperty.call(base, header)) return base[header];

  // Edge Function AI가 시트의 실제 헤더 기준으로 정리한 값은 우선 적용합니다.
  const sheetValues = data && data._sheetValues;
  if (sheetValues && Object.prototype.hasOwnProperty.call(sheetValues, header)) return sheetValues[header];

  const maps = {
    expansion_it: {
      "사무/설계/디자인/개발": "purpose", "세부사양": "spec", "지역": "region", "업체명": "company", "등급": "grade",
      "업체담당자": "vendorContact", "연락처": "contact", "IT담당자": "itContact", "렌탈or구매or유지보수": "rentalBuyMaint",
      "지정업체": "designatedVendor", "지정업체만족도": "designatedSat", "총 인원": "totalPeople", "인원 추가 설명": "peopleNote",
      "수량": "qty", "금액": "amount", "시기": "timing", "시기 추가 설명": "timingNote", "어필 OR 추가영업": "appeal",
    },
    expansion_copier: {
      "등록자": "registrant", "전략영업담당자": "salesOwner", "상호": "company", "업종": "industryPeopleRevenue",
      "프로젝트주소": "meetingAddress", "키맨성함+직함": "keymanNameTitle", "키맨전화번호": "contact",
      "의사결정 파급력": "decisionPower", "개인 히스토리": "personalHistory", "프로젝트": "projectStatus",
      "품목(원문)": "itemRaw", "예상 발주금액(만원)": "expectedAmount", "예상 발주시기(YYYY-MM)": "expectedOrderMonth",
      "계약 종료(예정)일": "contractEndDate", "특이사항": "notes", "거래처등급": "grade", "[AI 자동완성 개입 여부]": "_webInput",
    },
    contact_change: {
      "유입": "_webInput", "담당자": "_author", "등급": "grade", "업체명": "company", "지역": "region",
      "구분": "category", "사유": "reason", "변경전": "before", "변경후": "after", "등록요청": "_webInput",
    },
    complaint: {
      "접수/처리": "_complaintReceipt", "등급": "grade", "업체명": "company", "거래처담당자": "담당자/연락처",
      "거래처연락처": "담당자/연락처", "불만내용": "불편내용", "불만유형": "불만유형", "불만항목": "불만정도",
    },
  };
  const key = maps[category] && maps[category][header];
  if (!key) return undefined;
  if (key === "_author") return request.author;
  if (key === "_webInput") return "웹앱 직접입력";
  if (key === "_complaintReceipt") return "불만접수";
  if (data[key] !== undefined && data[key] !== "") return data[key];
  if (labels[header] !== undefined) return labels[header];
  return labels[key];
}

function isoWeek_(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
}

function parseLabeledText_(text) {
  const values = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:\d+\.\s*)?([^:：]+)\s*[:：]\s*(.*)$/);
    if (match) values[match[1].trim()] = match[2].trim();
  });
  return values;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
