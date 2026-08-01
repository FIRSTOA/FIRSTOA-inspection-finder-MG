# Apps Script 프로젝트 모음

웹앱과 연동되는 구글 Apps Script 4종의 소스를 여기서 관리한다.
**GitHub에 올려도 GAS에 자동 반영되지 않는다** — 아래 배포 방법대로 반영해야 한다.

| 폴더/파일 | GAS 프로젝트 | 하는 일 | 배포 방법 |
|---|---|---|---|
| `first-data/` | First-DATA (독립 프로젝트) | 시트↔Supabase 동기화(임대·미수·초과·재계약·CS체크), 카톡 메시지 파싱 기록 | **clasp push** (아래) |
| `field-sheet-sync.gs` | FIELD 시트 동기화 (웹앱) | FIELD·서비스접수 → 구글시트 기입 (4종 + 접수 3종) | GAS 편집기에 붙여넣기 → 새 버전 배포 |
| `customer-message-webhook.gs` | 고객 메시지 웹훅 (웹앱) | 메신저봇 → 카톡 메시지 수신 | GAS 편집기에 붙여넣기 → 새 버전 배포 |
| `it-tech-api-adapter.gs` | 퍼스트전산 PC_DB (독립 웹앱) | IT 학습·처리이력 API 어댑터 | GAS 편집기에 붙여넣기 → 새 버전 배포 |
| (소스 미보관) | 퍼스트전산 DB통합시트 GAS | 시트 부착 스크립트 — 웹앱 GAS_GET_URL(api.ts)이 호출 | 시트 → 확장 프로그램 → Apps Script |

## first-data 배포 (clasp)

```bash
cd apps-script/first-data
npx clasp login          # 최초 1회 (브라우저 인증)
npx clasp pull           # ⚠️ 먼저 pull로 GAS 편집기 쪽 수동 수정과 어긋남이 없는지 확인
npx clasp push           # 저장소 → GAS 반영
```

- `clasp pull`은 로컬 파일을 **덮어쓴다**. pull 후 `git diff`로 편집기에만 있던
  수정이 발견되면 커밋으로 흡수한 뒤 push할 것.
- 토큰이 만료되면(`invalid_grant`) `clasp login`을 다시 하면 된다.

## 원본 저장소

`first-data/`는 원래 별도 저장소(FIRSTOA/First-DATA-MG)였고 2026-08-01에
커밋 이력째 이 저장소로 합쳤다. 옛 저장소는 읽기용으로만 남아 있다.
