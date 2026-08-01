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
  praise: { spreadsheetId: "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ", sheetId: 0 },
  reception_copier: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 1181394897 },
  reception_copier_new: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 1181394897 },
  reception_remote: { spreadsheetId: "1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g", sheetId: 916322987 },
};

function doPost(e) {
  // 동시 전송 시 getLastRow/insertRow가 얽혀 행이 충돌하지 않도록 스크립트 전역 잠금.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (waitError) {
    return json_({ ok: false, error: "다른 동기화가 진행 중입니다. 잠시 후 재시도하세요." });
  }
  try {
    const request = JSON.parse(e.postData && e.postData.contents || "{}");
    const secret = PropertiesService.getScriptProperties().getProperty("FIELD_SYNC_SECRET");
    if (!secret || request.secret !== secret) return json_({ ok: false, error: "unauthorized" });
    if (request.action !== "append_field_sheet_row") return json_({ ok: false, error: "unknown action" });
    const result = appendFieldSheetRow_(request);
    return json_({ ok: true, row: result.row, sheet: result.sheet });
  } catch (error) {
    return json_({ ok: false, error: error && error.message || String(error) });
  } finally {
    lock.releaseLock();
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
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];

  // 멱등성: 같은 jobId가 이미 기록돼 있으면 그 행을 돌려준다(재시도 시 중복 append 방지).
  const jobIdCol = headers.indexOf("웹앱 전송ID") + 1;
  if (jobIdCol > 0 && request.jobId && sheet.getLastRow() > headerRow) {
    const existing = sheet.getRange(headerRow + 1, jobIdCol, sheet.getLastRow() - headerRow, 1).getDisplayValues();
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === String(request.jobId)) {
        return { row: headerRow + 1 + i, sheet: sheet.getName() };
      }
    }
  }

  const data = request.payload && request.payload.data || {};
  const labelValues = parseLabeledText_(request.sourceText || "");

  // 갱신 모드: 접수 때 만든 행에 처리 결과(시작·종료·처리여부 등)를 나중에 채운다.
  // 행 번호가 밀렸을 수 있으니 키 열(순)이 일치할 때만 갱신하고, 다르면 새 행으로 추가한다.
  var updateRow = Number(data["_updateRow"] || 0);
  if (updateRow > headerRow && updateRow <= sheet.getLastRow()) {
    var keyHeader = String(data["_updateKeyHeader"] || "");
    var keyValue = String(data["_updateKeyValue"] || "");
    // "순"처럼 헤더가 중복된 시트가 있어 열 번호를 직접 받는 쪽을 우선한다 (원격 탭은 M열=13)
    var keyCol = Number(data["_updateKeyColumn"] || 0) || (keyHeader ? headers.indexOf(keyHeader) + 1 : 0);
    var keyOk = !keyHeader || (keyCol > 0 && String(sheet.getRange(updateRow, keyCol).getDisplayValue()).trim() === keyValue.trim());
    if (keyOk) {
      headers.forEach(function (header, index) {
        var value = fieldValue_(request.category, header, index + 1, data, request, labelValues);
        if (value !== undefined && value !== "") sheet.getRange(updateRow, index + 1).setValue(value);
      });
      SpreadsheetApp.flush();
      return { row: updateRow, sheet: sheet.getName(), updated: true };
    }
  }

  const previousRow = Math.max(headerRow + 1, sheet.getLastRow());
  sheet.insertRowAfter(previousRow);
  const row = previousRow + 1;

  // 수식은 구글의 복사(copyTo)로만 옮긴다 — 텍스트 재기입은 일부 수식을 깨뜨린다.
  // 바로 위 행이 비어 있는 경우가 있어(빈 행·수동 입력 행) 위로 최대 30행을 훑어
  // 열마다 "수식이 있는 가장 가까운 행"을 찾아 그 행에서 복사한다.
  const scanFrom = Math.max(headerRow + 1, previousRow - 29);
  const scanCount = previousRow - scanFrom + 1;
  const scan = scanCount > 0 ? sheet.getRange(scanFrom, 1, scanCount, lastColumn).getFormulas() : [];
  const sourceRowOf = [];
  for (let col = 0; col < lastColumn; col++) {
    let found = 0;
    for (let r = scan.length - 1; r >= 0; r--) {
      if (scan[r][col]) { found = scanFrom + r; break; }
    }
    sourceRowOf.push(found);
  }
  // 같은 원본 행에서 오는 연속 구간끼리 묶어 한 번에 복사 (호출 수 최소화)
  let gStart = -1;
  for (let i = 0; i <= lastColumn; i++) {
    const same = i < lastColumn && sourceRowOf[i] && (gStart < 0 || sourceRowOf[i] === sourceRowOf[gStart]);
    if (same && gStart < 0) gStart = i;
    else if (!same && gStart >= 0) {
      const src = sourceRowOf[gStart];
      sheet.getRange(src, gStart + 1, 1, i - gStart)
        .copyTo(sheet.getRange(row, gStart + 1, 1, i - gStart), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      gStart = i < lastColumn && sourceRowOf[i] ? i : -1;
    }
  }

  const values = headers.map(function (header, index) {
    return fieldValue_(request.category, header, index + 1, data, request, labelValues);
  });
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const has = i < values.length && values[i] !== undefined;
    if (has && start < 0) start = i;
    if (!has && start >= 0) {
      sheet.getRange(row, start + 1, 1, i - start).setValues([values.slice(start, i)]);
      start = -1;
    }
  }
  if (request.category === "contact_change") {
    const orderCell = sheet.getRange(row, 13);
    if (!orderCell.getFormula()) orderCell.setFormula('=LET(v, INDEX($G:$G, ROW()), IF(v="","", COUNTIF($G$3:INDEX($G:$G, ROW()), v) & "차"))');
  }
  SpreadsheetApp.flush();

  return { row, sheet: sheet.getName() };
}

function findHeaderRow_(sheet, category) {
  const signatures = {
    expansion_it: ["업체명", "세부사양"],
    expansion_copier: ["상호", "등록자"],
    contact_change: ["업체명", "변경전"],
    complaint: ["업체명", "불만내용"],
    praise: ["거래처명", "칭찬이유"],
    reception_copier: ["퍼스트순", "접수유형"],
    reception_copier_new: ["퍼스트순", "접수유형"],
    reception_remote: ["접수일", "한조처리"],
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

function fieldValue_(category, header, column, data, request, labels) {
  // 담당자·주소 변경 표는 A:M까지만 사용합니다. 오른쪽 보조 영역의 같은 헤더는 건드리지 않습니다.
  if (category === "contact_change" && column > 13) return undefined;
  // 접수(복합기 기존): A~T까지만 기입 — 퍼스트순(F) 기준 함수가 채우는 오른쪽 열들을 건드리지 않는다 (AK열 업체담당자 중복 보호)
  // 예외: BD열 "처리완료" — 일정리스트에서 완료 치면 웹앱이 행 갱신으로 채운다
  if (category === "reception_copier" && column > 20 && String(header).replace(/\s+/g, "") !== "처리완료") return undefined;
  // 접수(원격·IT): A열(행 순번)·C열(년월)은 자동 계산 — 덮어쓰면 수식이 깨진다.
  // "순" 헤더가 A열과 M열에 중복되므로 임대리스트 순번은 M열(13)에만 기입한다.
  if (category === "reception_remote") {
    if (column === 1 || column === 3) return undefined;
    if (String(header).replace(/\s+/g, "") === "순") return column === 13 ? (data["leaseNo"] || undefined) : undefined;
  }
  // 접수(복합기 신규): A~AT까지 직접 기재 (AU 위탁/유지보수 이후는 보호)
  if (category === "reception_copier_new" && column > 46) return undefined;
  // 업체담당자 헤더가 P열·AK열에 중복 — 신규는 열 위치로 구분해 기입
  if (category === "reception_copier_new" && String(header).replace(/\s+/g, "") === "업체담당자") {
    return column <= 20 ? (data["receiverName"] || undefined) : (data["vendorManager"] || undefined);
  }

  const submittedAt = new Date(request.submittedAt || new Date());
  const copierPeriod = category === "expansion_copier" ? {
    "년월": Utilities.formatDate(submittedAt, "Asia/Seoul", "yy년 MM월"),
    "주차": `${isoWeek_(submittedAt)}주차`,
  } : {};
  const contactPeriod = category === "contact_change" ? {
    "날짜": Utilities.formatDate(submittedAt, "Asia/Seoul", "yyyy-MM-dd"),
    "년월": Utilities.formatDate(submittedAt, "Asia/Seoul", "yy-MM"),
    "유입": "웹앱",
  } : {};
  const complaintPeriod = category === "complaint" ? {
    "날짜": Utilities.formatDate(submittedAt, "Asia/Seoul", "yyyy-MM-dd"),
  } : {};
  // 칭찬: 분기·월 열은 시트의 ARRAYFORMULA가 날짜(C열)로 자동 계산하므로 건드리지 않는다.
  // 날짜(yyyy.MM.dd)·직원·분류만 기입.
  const praisePeriod = category === "praise" ? (function () {
    var d = data["date"] ? new Date(String(data["date"]) + "T09:00:00+09:00") : submittedAt;
    if (isNaN(d.getTime())) d = submittedAt;
    return {
      "날짜": Utilities.formatDate(d, "Asia/Seoul", "yyyy.MM.dd"),
      "직원": request.author,
      "분류": "칭찬",
    };
  })() : {};
  // 접수(복합기 기존): 날짜·시간·접수자는 접수 시각 기준.
  // 행 갱신(처리완료 기입)일 땐 건드리지 않는다 — 접수시간이 완료시간으로 덮이면 안 됨.
  const receptionPeriod = (category === "reception_copier" || category === "reception_copier_new") && !data["_updateRow"] ? {
    "날짜": Utilities.formatDate(submittedAt, "Asia/Seoul", "M월 d일"),
    "접수시간": Utilities.formatDate(submittedAt, "Asia/Seoul", "HH:mm"),
    "접수자": request.author,
  } : {};
  // 원격·IT 접수: 접수일(B)·접수시각(D)·접수자(J).
  // 웹앱이 접수 당시 값을 보내주면 그것을 쓴다 — 처리 단계에서 갱신하거나 새 행으로 빠져도
  // 접수 시각이 처리 시각으로 덮이지 않는다.
  const remotePeriod = category === "reception_remote" ? {
    "접수일": data["receiptDate"] || Utilities.formatDate(submittedAt, "Asia/Seoul", "M월 d일"),
    "접수": data["receiptTime"] || Utilities.formatDate(submittedAt, "Asia/Seoul", "HH:mm"),
    "접수자": data["receiptAuthor"] || request.author,
  } : {};
  const base = {
    "웹앱 전송ID": request.jobId,
    "날짜": request.submittedAt,
    "등록일": request.submittedAt,
    "작성자": request.author,
    ...copierPeriod,
    ...contactPeriod,
    ...complaintPeriod,
    ...praisePeriod,
    ...receptionPeriod,
    ...remotePeriod,
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
      "담당자": "_author", "등급": "grade", "업체명": "company", "지역": "region",
      "구분": "category", "사유": "reason", "변경전": "before", "변경후": "after",
    },
    complaint: {
      "접수/처리": "_complaintReceipt", "등급": "등급", "업체명": "업체명", "거래처담당자": "_contactName",
      "거래처연락처": "_contactPhone", "불만내용": "불편내용", "불만유형": "불만유형", "불만항목": "불만정도",
    },
    praise: {
      "등급": "grade", "거래처명": "company", "담당자": "manager", "연락처": "contact",
      "전화번호": "phone", "칭찬이유": "reason", "간단": "short",
    },
    reception_copier: {
      "퍼스트순": "firstNo", "접수유형": "route", "접수분야": "field", "유상/무상": "paid",
      "업체담당자": "receiverName", "전화번호": "receiverPhone", "제목(짧게)": "title", "내용": "symptom",
      "처리완료": "complete",   // BD열 — 일정리스트 완료 시 행 갱신으로 기입
    },
    reception_remote: {
      "시작": "start", "종료": "end", "처리여부": "result", "유입경로": "route", "처리자": "handler",
      "한조처리": "hanjo", "순": "leaseNo", "연락처": "contact", "증상": "symptom",
      "추가대수": "extraCount", "처리내용": "handled", "연동완료": "linked",
      // 신규 거래처(순번 없음)는 함수가 못 채우므로 웹앱이 직접 기입 — 기존 접수는 이 키를 안 보내 수식 유지
      "상호": "company", "등급": "grade", "미수": "misuMonths", "특이사항": "notes", "지역": "region",
      "마감일": "dueDate", "기종": "series", "브랜드": "brand", "자산번호": "assetNo", "시리얼번호": "serialNo",
    },
    reception_copier_new: {
      "퍼스트순": "firstNo", "임대여부": "leaseStatus", "업체명": "company", "접수유형": "route", "접수분야": "field",
      "유상/무상": "paid", "보증여부": "warranty", "자산번호": "assetNo", "미수개월": "misuMonths",
      "일반전화": "tel", "전화번호": "receiverPhone", "제목(짧게)": "title", "내용": "symptom",
      "등급": "grade", "특이사항": "notes", "한조/틴텍코드": "hanjoCode", "모델명": "model", "품목": "item",
      "제조사": "maker", "기종": "series", "기본임대료": "baseRent", "평균임대료": "avgRent",
      "계약일": "contractStart", "종료일": "contractEnd", "남은개월수": "monthsLeft", "주소": "address",
      "기기상태": "deviceState", "시": "city", "구": "district", "방문주기": "visitCycle", "설치업체": "installer",
      "키맨": "keyman", "추가조건": "extraTerms", "장비소유주": "owner", "기번": "serialNo", "자산기번": "assetSerial",
    },
  };
  let key = maps[category] && maps[category][header];
  if (!key && maps[category]) key = maps[category][String(header).trim()];
  if (!key) return undefined;
  if (key === "_author") return request.author;
  if (key === "_webInput") return "웹앱 직접입력";
  if (key === "_complaintReceipt") return "불만접수";
  if (key === "_contactName" || key === "_contactPhone") {
    var contact = String(data["담당자"] || labels["담당자/연락처"] || "").trim();
    var phone = (contact.match(/01[016-9][-\s.]?\d{3,4}[-\s.]?\d{4}/) || [""])[0];
    return key === "_contactPhone" ? phone : (contact.replace(phone, "").trim() || contact);
  }
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
