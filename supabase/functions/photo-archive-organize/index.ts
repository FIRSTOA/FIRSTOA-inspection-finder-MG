const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

type Album = { category?: string; vendor?: string; source_type?: string };
type Asset = {
  id: number;
  album_id: string;
  storage_path: string;
  file_name?: string;
  photo_albums?: Album | Album[] | null;
};

function folderName(value: string) {
  const current = String(value || "미기재").trim().normalize("NFKC") || "미기재";
  return current.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) || "미기재";
}

function sourceFolder(sourceType: string, category: string) {
  const known: Record<string, string> = {
    inspection: "점검",
    as: "AS",
    expansion_it: "확장성_IT",
    expansion_copier: "확장성_복합기",
    contact_change: "담당자_주소변경",
    logistics: "물류",
    complaint: "불만",
    misu: "미수",
    recontract: "재계약",
    "overage-adjust": "초과조정",
    replacement: "교체",
  };
  return known[sourceType] || folderName(category || "기존미분류");
}

async function patchAsset(rest: string, headers: HeadersInit, id: number, patch: Record<string, unknown>) {
  const res = await fetch(`${rest}/photo_assets?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`사진 목록 갱신 실패(${res.status})`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");

    const rest = `${supabaseUrl}/rest/v1`;
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const assetRes = await fetch(`${rest}/photo_assets?organized_path=is.null&select=id,album_id,storage_path,file_name,photo_albums(category,vendor,source_type)&order=id.asc&limit=${limit}`, { headers });
    if (!assetRes.ok) throw new Error(`사진 목록 조회 실패(${assetRes.status})`);
    const assets = await assetRes.json() as Asset[];

    let copied = 0;
    let failed = 0;
    const errors: Array<{ id: number; error: string }> = [];
    for (const asset of assets) {
      const album = Array.isArray(asset.photo_albums) ? asset.photo_albums[0] || {} : asset.photo_albums || {};
      const sourceType = String(album.source_type || "legacy");
      const filename = String(asset.file_name || asset.storage_path.split("/").pop() || "photo.jpg").replace(/[\\/:*?"<>|]/g, "_");
      const destination = `archive/${sourceFolder(sourceType, String(album.category || ""))}/${folderName(String(album.vendor || "미기재"))}/${asset.album_id}/${filename}`;
      try {
        const copyRes = await fetch(`${supabaseUrl}/storage/v1/object/copy`, {
          method: "POST",
          headers,
          body: JSON.stringify({ bucketId: "photos", sourceKey: asset.storage_path, destinationKey: destination }),
        });
        if (!copyRes.ok && copyRes.status !== 409) {
          const detail = await copyRes.text().catch(() => "");
          throw new Error(`Storage 복사 실패(${copyRes.status}): ${detail.slice(0, 120)}`);
        }
        await patchAsset(rest, headers, asset.id, { organized_path: destination, archived_at: new Date().toISOString(), archive_error: null });
        copied += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ id: asset.id, error: message });
        await patchAsset(rest, headers, asset.id, { archive_error: message }).catch(() => undefined);
      }
    }
    return Response.json({ ok: true, processed: assets.length, copied, failed, remainingHint: assets.length === limit, errors }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
