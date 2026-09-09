/**
 * 조회탭 기록 수정·숨김 대행 (2026-09-09)
 *
 * 왜 있나: 8/17 보안 강화로 anon 역할의 UPDATE가 이력 테이블(jeomgeom·as_records·bulman 등)에서
 * 회수됐다. 조회탭의 기록 수정·숨김이 그 벽에 걸려 401이 났다(실사고: "GRANT UPDATE ... TO anon").
 * anon 권한을 다시 넓히는 대신, 이 함수가 서비스 키로 대신 쓴다 — 대신 테이블·컬럼을
 * 화이트리스트로 좁히고, 수정은 _edit_log가 반드시 붙어 있어야 받는다(감사 추적 강제).
 *
 * action=edit : { table, id, patch }  — 점검·AS 기록의 칸 수정 (+_원문 동기화, _edit_log 필수)
 * action=hide : { table, id, hidden, by } — 잘못된 기록 숨김/복원 (soft delete)
 */
const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 수정을 허용하는 테이블·컬럼 — 조회탭 화면(src/DataLookup.tsx RECORD_FIELDS)과 거울
const RECORD_FIELDS = [
  "작성일", "작성자", "구분", "레벨", "등급", "업체명", "부서명", "지역", "키맨/접수자",
  "모델명", "시리얼넘버", "자산기번", "내용", "처리내용", "매수", "토너잔량", "폐통", "여분",
  "한틴이카유무", "주차비지원유무", "특이사항",
];
const EDIT_TABLES: Record<string, Set<string>> = {
  jeomgeom: new Set([...RECORD_FIELDS, "_업체명", "_원문", "_edit_log"]),
  as_records: new Set([...RECORD_FIELDS, "_업체명", "_원문", "_edit_log"]),
};

// 숨김을 허용하는 테이블 — 조회탭 HIDEABLE과 거울
const HIDE_TABLES = new Set([
  "jeomgeom", "as_records", "logistics_records", "bulman", "misu", "overage", "overage_adjust",
  "recontract", "churn_defense", "mgmt_support", "pc_expansion", "mfp_expansion", "contact_changes", "stock_items",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "edit");
    const table = String(body.table || "");
    const id = String(body.id ?? "").trim();
    if (!id) return Response.json({ error: "id가 필요합니다" }, { status: 400, headers: jsonHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" };

    let patch: Record<string, unknown> = {};
    if (action === "hide") {
      if (!HIDE_TABLES.has(table)) return Response.json({ error: `숨김을 지원하지 않는 테이블: ${table}` }, { status: 400, headers: jsonHeaders });
      patch = body.hidden === false
        ? { _hidden: false }
        : { _hidden: true, _hidden_by: String(body.by || "미지정").slice(0, 40), _hidden_at: new Date().toISOString() };
    } else {
      const allowed = EDIT_TABLES[table];
      if (!allowed) return Response.json({ error: `수정을 지원하지 않는 테이블: ${table}` }, { status: 400, headers: jsonHeaders });
      const raw = (body.patch && typeof body.patch === "object" ? body.patch : {}) as Record<string, unknown>;
      const rejected = Object.keys(raw).filter((key) => !allowed.has(key));
      if (rejected.length) return Response.json({ error: `허용되지 않는 컬럼: ${rejected.join(", ")}` }, { status: 400, headers: jsonHeaders });
      // 감사 추적 강제 — 수정 이력 없이 값만 바꾸는 호출은 받지 않는다
      if (!Array.isArray(raw["_edit_log"]) || !(raw["_edit_log"] as unknown[]).length) {
        return Response.json({ error: "_edit_log(수정 이력)가 필요합니다" }, { status: 400, headers: jsonHeaders });
      }
      patch = raw;
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers, body: JSON.stringify(patch),
    });
    if (!res.ok) return Response.json({ error: `저장 실패(${res.status}) ${(await res.text()).slice(0, 200)}` }, { status: 502, headers: jsonHeaders });
    return Response.json({ ok: true }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: jsonHeaders });
  }
});
