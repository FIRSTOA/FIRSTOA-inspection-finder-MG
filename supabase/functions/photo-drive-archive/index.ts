/**
 * 사진 분기 아카이브 — Supabase Storage(photos 버킷) → 구글 드라이브 이관.
 *
 * 왜: photos 버킷이 2주 반 만에 2.7GB(9,200장) — 분기마다 오래된 사진을 드라이브로
 * 옮기고 스토리지를 비워 용량을 유지한다. 앨범 링크(?album=)는 get_photo_album이
 * 드라이브 링크로 폴백하므로 이관 후에도 계속 열린다.
 *
 * 필요 설정:
 *  - Secrets: GOOGLE_SERVICE_ACCOUNT (field-sheet-sync와 공용)
 *  - app_config: PHOTO_DRIVE_FOLDER = 드라이브 폴더 ID
 *    (드라이브에서 폴더를 만들고 서비스 계정 이메일을 "편집자"로 공유,
 *     팀이 링크로 보려면 폴더를 "링크가 있는 모든 사용자 — 뷰어"로)
 *
 * 액션(POST JSON):
 *  - { action: "status" }                    설정·드라이브 접근·대상 수 확인 (변경 없음)
 *  - { action: "archive", days?, limit? }    days(기본 90)일 지난 사진을 limit(기본 40)장 이관
 *    → 드라이브 업로드 성공 → 매핑 기록(drive_file_id) → 스토리지 삭제 순서.
 *      매핑 기록 전에는 절대 지우지 않는다.
 *
 * 주의: 서비스 계정 소유 파일은 계정당 15GB 한도 — 연 10GB+ 쌓이면 이듬해쯤
 * 새 서비스 계정으로 교체(또는 워크스페이스 공유드라이브)가 필요하다.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// ── 구글 인증 (sheets-api.ts와 같은 패턴, scope만 drive) ──
let tokenCache: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}");
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT 시크릿이 없거나 형식이 다릅니다");
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`구글 토큰 발급 실패: ${JSON.stringify(data).slice(0, 200)}`);
  tokenCache = { token: data.access_token, exp: Date.now() + 55 * 60 * 1000 };
  return data.access_token;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";

async function driveGet(token: string, path: string) {
  const res = await fetch(`${DRIVE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`드라이브 조회 실패(${res.status}): ${JSON.stringify(data).slice(0, 160)}`);
  return data;
}

// 월별 하위 폴더("2026-07") 찾거나 생성 — 한 번의 실행 안에서는 캐시
const folderCache = new Map<string, string>();
async function monthFolder(token: string, root: string, ym: string): Promise<string> {
  const hit = folderCache.get(ym);
  if (hit) return hit;
  const q = encodeURIComponent(`name='${ym}' and '${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await driveGet(token, `/files?q=${q}&fields=files(id)`);
  let id = found.files?.[0]?.id as string | undefined;
  if (!id) {
    const res = await fetch(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: ym, mimeType: "application/vnd.google-apps.folder", parents: [root] }),
    });
    const data = await res.json();
    if (!res.ok || !data.id) throw new Error(`월 폴더 생성 실패: ${JSON.stringify(data).slice(0, 160)}`);
    id = data.id;
  }
  folderCache.set(ym, id!);
  return id!;
}

async function driveUpload(token: string, parent: string, name: string, contentType: string, bytes: ArrayBuffer, props: Record<string, string>): Promise<string> {
  const boundary = `b${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ name, parents: [parent], appProperties: props });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, bytes, tail]);
  const res = await fetch(DRIVE_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(`드라이브 업로드 실패(${res.status}): ${JSON.stringify(data).slice(0, 160)}`);
  return data.id;
}

function sanitize(v: string) {
  return String(v || "").replace(/[\\/:*?"<>|#\s]+/g, " ").trim().slice(0, 60);
}

type Asset = {
  id: number; album_id: string; storage_path: string; file_name?: string; mime_type?: string;
  created_at: string; photo_albums?: { vendor?: string; source_type?: string } | Array<{ vendor?: string; source_type?: string }> | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");
    const rest = `${supabaseUrl}/rest/v1`;
    const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    // 설정: 드라이브 루트 폴더
    const cfgRes = await fetch(`${rest}/app_config?key=eq.PHOTO_DRIVE_FOLDER&select=value`, { headers: restHeaders });
    const cfg = (await cfgRes.json().catch(() => [])) as Array<{ value: string }>;
    const rootFolder = (cfg[0]?.value || "").trim();

    const days = Math.min(Math.max(Number(body.days) || 90, 7), 3650);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    if (action === "status") {
      const candRes = await fetch(`${rest}/photo_assets?drive_file_id=is.null&created_at=lt.${cutoff}&select=id`, {
        headers: { ...restHeaders, Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
      });
      const candidates = Number((candRes.headers.get("content-range") || "0/0").split("/")[1] || 0);
      let drive = "미설정";
      if (rootFolder) {
        try {
          const token = await accessToken();
          const info = await driveGet(token, `/files/${rootFolder}?fields=id,name`);
          drive = `연결됨: ${info.name}`;
        } catch (e) {
          drive = `오류: ${(e as Error).message.slice(0, 140)}`;
        }
      }
      return Response.json({ ok: true, folder: rootFolder || null, drive, days, candidates }, { headers: jsonHeaders });
    }

    if (action !== "archive") throw new Error(`알 수 없는 action: ${action}`);
    if (!rootFolder) throw new Error("app_config PHOTO_DRIVE_FOLDER가 비어 있습니다 — 드라이브 폴더를 만들고 ID를 넣어 주세요.");

    const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 200);
    const listRes = await fetch(
      `${rest}/photo_assets?drive_file_id=is.null&created_at=lt.${cutoff}&select=id,album_id,storage_path,file_name,mime_type,created_at,photo_albums(vendor,source_type)&order=created_at.asc&limit=${limit}`,
      { headers: restHeaders },
    );
    if (!listRes.ok) throw new Error(`대상 조회 실패(${listRes.status})`);
    const assets = (await listRes.json()) as Asset[];

    const token = await accessToken();
    const deadline = Date.now() + 100_000; // 엣지 실행 한도 전에 멈추고 남은 건 다음 호출로
    let archived = 0, failed = 0;
    const errors: Array<{ id: number; error: string }> = [];

    for (const asset of assets) {
      if (Date.now() > deadline) break;
      try {
        const album = Array.isArray(asset.photo_albums) ? asset.photo_albums[0] || {} : asset.photo_albums || {};
        const dl = await fetch(`${supabaseUrl}/storage/v1/object/photos/${asset.storage_path}`, { headers: restHeaders });
        if (dl.status === 404) {
          // 스토리지에 이미 없음(과거 수동 정리) — 매핑만 남기고 넘어간다
          await fetch(`${rest}/photo_assets?id=eq.${asset.id}`, {
            method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ archive_error: "storage 404 — 원본 없음" }),
          });
          failed += 1; errors.push({ id: asset.id, error: "storage 404" });
          continue;
        }
        if (!dl.ok) throw new Error(`스토리지 다운로드 실패(${dl.status})`);
        const bytes = await dl.arrayBuffer();

        const ym = String(asset.created_at).slice(0, 7);
        const parent = await monthFolder(token, rootFolder, ym);
        const base = asset.file_name || asset.storage_path.split("/").pop() || "photo.jpg";
        const name = [sanitize(album.vendor || ""), sanitize(album.source_type || ""), base].filter(Boolean).join("_");
        const fileId = await driveUpload(token, parent, name, asset.mime_type || "image/jpeg", bytes, {
          album_id: asset.album_id, storage_path: asset.storage_path,
        });

        // 매핑 기록이 성공한 뒤에만 스토리지에서 지운다
        const patch = await fetch(`${rest}/photo_assets?id=eq.${asset.id}`, {
          method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ drive_file_id: fileId, archived_at: new Date().toISOString(), archive_error: null }),
        });
        if (!patch.ok) throw new Error(`매핑 기록 실패(${patch.status}) — 스토리지 삭제 보류`);
        await fetch(`${supabaseUrl}/storage/v1/object/photos/${asset.storage_path}`, { method: "DELETE", headers: restHeaders });
        archived += 1;
      } catch (e) {
        failed += 1;
        const message = (e as Error).message || String(e);
        errors.push({ id: asset.id, error: message.slice(0, 160) });
        await fetch(`${rest}/photo_assets?id=eq.${asset.id}`, {
          method: "PATCH", headers: { ...restHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ archive_error: message.slice(0, 300) }),
        }).catch(() => undefined);
      }
    }

    return Response.json({
      ok: true, processed: assets.length, archived, failed,
      remainingHint: assets.length === limit, errors: errors.slice(0, 10),
    }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
