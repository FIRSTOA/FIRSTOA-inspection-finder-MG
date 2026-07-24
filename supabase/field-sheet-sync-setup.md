# FIELD 시트 자동화 설정

이 설정은 확장성 IT, 확장성 복합기, 담당자/주소 변경, 불만에만 적용한다.
카카오 메시지는 기존 양식 원문 그대로 보내며, 시트 저장은 별도로 처리한다.

## 1. Supabase SQL 실행

Supabase SQL Editor에서 `supabase/field-sheet-sync.sql` 전체를 한 번 실행한다.

실행 직후에는 두 기능이 모두 꺼져 있다.

```sql
select key, value
from public.app_config
where key in ('FIELD_SHEET_SYNC_ENABLED', 'FIELD_KAKAO_SEND_ENABLED');
```

## 2. Google Apps Script 배포

1. 새 Apps Script 프로젝트를 만든다.
2. `apps-script/field-sheet-sync.gs` 전체를 붙여넣는다.
3. 프로젝트 설정 → Script properties에 `FIELD_SYNC_SECRET`를 추가한다.
   - 값은 충분히 긴 임의 문자열로 정한다.
4. 배포 → 새 배포 → 웹 앱으로 배포한다.
5. 실행 사용자: 본인, 액세스 권한: 모든 사용자로 설정한다.
6. 배포된 `/exec` 주소를 복사한다.

스크립트는 기존 시트의 수식 열을 이전 행에서 복사하고, 웹앱이 입력한 열만 채운다.
수식/AI 열은 덮어쓰지 않는다.

## 3. Supabase Edge Function 배포

Supabase Dashboard → Edge Functions → Deploy a new function에서 함수 이름을
`field-sheet-sync`로 만든다.

`supabase/functions/field-sheet-sync/index.ts` 전체를 붙여넣고 Deploy한다.

Secrets에 아래 두 개를 추가한다.

| Secret | 값 |
| --- | --- |
| `FIELD_SHEETS_WEBHOOK_URL` | 2단계의 Apps Script `/exec` 주소 |
| `FIELD_SHEETS_WEBHOOK_SECRET` | 2단계에서 만든 `FIELD_SYNC_SECRET`와 동일한 값 |

## 4. 시트만 먼저 활성화

테스트용 양식 한 건을 작성하기 전에 아래 SQL을 실행한다.

```sql
update public.app_config
set value = 'true'
where key = 'FIELD_SHEET_SYNC_ENABLED';

update public.app_config
set value = 'false'
where key = 'FIELD_KAKAO_SEND_ENABLED';

update public.app_config
set value = 'true'
where key = 'FIELD_SHEET_TEST_MODE';
```

이 상태에서는 시트만 저장되고 카카오 방에는 아무 메시지도 올라가지 않는다.
또한 실제 업무 탭이 아니라 각 스프레드시트의 `웹앱_테스트_종류` 탭에 저장된다.
테스트 탭은 자동 생성되므로 실제 데이터나 수식 행을 삭제할 필요가 없다.

실제 시트 탭에 넣기 전에는 테스트 탭의 헤더, 날짜, 작성자, 업체명, 원문 매핑을 확인한다.

```sql
update public.app_config
set value = 'false'
where key = 'FIELD_SHEET_TEST_MODE';
```

## 5. 카카오 전송 활성화

근무 시간에 시트 저장 결과를 확인한 뒤에만 실행한다.

```sql
update public.app_config
set value = 'true'
where key = 'FIELD_KAKAO_SEND_ENABLED';
```

카카오 메시지는 웹앱에서 보던 양식 원문을 수정하지 않고 그대로 `outbox`에 적재한다.
기존 메신저봇 폴러가 해당 방으로 보낸다.

## 시트별 처리 원칙

- 확장성 IT: 분기, 월, 포인트, 차수는 기존 시트 수식에 맡긴다.
- 확장성 복합기: 순번, 년월, 주차, 다음 체크 예정일, AI 자동 열은 기존 수식/흐름을 보존한다.
- 담당자/주소 변경: 번호, 날짜, 년월, 등록요청의 기존 계산 흐름을 보존한다.
- 불만: 기본 접수값만 저장한다. AI 불만 유형/항목과 사실확인·대안제시·재발방지는 다음 단계에서 검토형 AI 작성으로 추가한다.
