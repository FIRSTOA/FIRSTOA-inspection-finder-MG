# 작업 B · 고객용 QR AS 접수 페이지 (Codex 담당)

워크트리 이름 제안: `qr-reception`
건드리는 범위: `src/QrReception.tsx`(신규), `src/qrReception.ts`(신규), `src/qrCode.ts`(신규, QR 생성), `src/main.tsx` 또는 `App.tsx` 라우팅 1곳, 거래처검색 결과 카드에 버튼 1개(`VendorSearch.tsx` 최소 수정), `supabase/qr-reception.sql`(신규), `AGENTS.md`.
**건드리지 말 것:** `ServiceReception.tsx` 내부 로직(재사용만), `service_receptions` 기존 컬럼, SSO 게이트(`SsoGate.tsx`) 동작.

## 배경
고객이 복합기에 붙은 QR을 찍으면 로그인 없이 AS를 접수하는 페이지. 접수는 기존 `service_receptions` 테이블로 들어가서 CS팀 서비스접수 화면에 그대로 보인다.

## 1. 라우트
- `/r/:deviceKey` — deviceKey는 **자산번호**(예: `C1887`) 또는 **시리얼**. 
- 이 라우트만 **SSO 게이트를 통과하지 않고** 열려야 한다. 현재 앱 진입 구조(`Boot.tsx`/`SsoGate.tsx`)를 읽고, 경로가 `/r/`로 시작하면 게이트 전에 `QrReception`을 렌더하도록 분기. 다른 경로 동작은 그대로.
- Vercel SPA라 `vercel.json` rewrite가 이미 있는지 확인. 없으면 `/r/*` → `/index.html` 추가.

## 2. 기기 조회 (읽기 전용 표시)
- `vendor_info`에서 `자산번호 = key` 또는 `기번 = key` 또는 `"시리얼번호(기번)" = key` (컬럼명 괄호 때문에 PostgREST select/filter에 큰따옴표 필요). 여러 건이면 `계약일` 최신.
- 없으면 `jeomgeom`/`as_records`에서 `자산기번`/`시리얼넘버` 최신 1건.
- 표시: 업체명, 모델명, 자산번호. **전화번호·주소·계약 정보는 표시하지 않는다**(외부 노출 금지).
- 조회 실패 시: "기기를 찾지 못했어요" + 업체명 직접 입력란.

## 3. 접수 폼 (모바일 우선, 큰 버튼)
- 증상 선택(단일): 용지걸림 / 인쇄 불량(줄·번짐) / 토너 부족 / 스캔 안 됨 / 전원·오류 코드 / 기타
- 추가 메모(선택), 연락처(필수, 숫자만), 사진 1~3장(선택, `imageUpload.ts` 재사용, Storage 버킷은 기존 `photos` 사용하되 `qr/` 접두사).
- 간단 스팸 방지: 같은 deviceKey로 10분 내 2회 이상이면 "이미 접수되었어요" 안내 (`localStorage` + 서버 측 최근 1건 조회).

## 4. 저장
`service_receptions`에 insert:
- `route='카카오'` 대신 새 값이 필요하면 **check 제약을 건드리지 말고** `notes` 앞에 `[QR] ` 접두사로 출처 표시.
- `type='복합기 AS'`, `vendor`, `asset_no`, `serial`, `model`, `region`(vendor_info/점검기록에서 가져올 수 있으면), `title=증상`, `symptom=증상+메모`, `notes='[QR] 연락처 010-...'`, `status='접수'`, `author='고객(QR)'`.
- 사진 URL은 `report_text` 끝에 줄바꿈으로 붙인다.
- 성공 화면: "접수되었습니다 · 접수번호(앞 8자) · 담당자가 연락드립니다".

## 5. 알림 (선택, 시간 남으면)
insert 성공 후 `outbox`에 `{room:'테스트 전용방', text:'[QR 접수] 업체명 · 모델 · 증상 · 연락처'}` 1행. 방 이름은 나중에 바꿀 수 있게 상수로.

## 6. 관리자용 QR 만들기
- 거래처검색 결과 카드(`VendorSearch.tsx`)에 "QR" 버튼 1개. 누르면 `https://firstoa-inspection-finder-mg.vercel.app/r/{자산번호 or 시리얼}` 를 QR PNG로 만들어 다운로드(파일명 `QR_{업체명}_{자산번호}.png`). 하단에 업체명·자산번호 텍스트 포함.
- QR 생성은 의존성 추가 없이 가능하면 그렇게(작은 QR 라이브러리 1개 추가는 허용, `package.json` 변경 시 AGENTS.md에 기록).

## 완료 조건
- `npm run build` 통과. 모바일 폭(390px)에서 깨지지 않을 것.
- `/r/C1887` 로 열었을 때 로그인 없이 폼이 뜨고, 제출하면 `service_receptions`에 행이 생기고 CS팀 서비스접수 화면에 보일 것.
- `AGENTS.md` 작업 기록 추가. 화면 캡처 `docs/tasks/qr-reception-done.png`.
