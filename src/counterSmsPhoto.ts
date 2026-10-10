/**
 * 마감 카운터 사진 한 장으로 끝내기 (2026-10-10)
 *
 * 흐름: 카드의 [📷 카운터 전송] → 사진 고르기 → 확인창(방·경로·글) → [보내기] → 사진 올리기(storage photos/counter/…)
 *   → ① 노트북 작업 실행기가 살아 있으면 worker_jobs(kakao_photo)에 넣어 카톡 PC가 마감방에 글+사진을 올린다
 *     ② 아니면 발신 큐(outbox)에 글+사진 링크를 넣어 봇이 올린다(봇은 글자만 보낼 수 있다)
 *   → 카드를 "완료 · 카운터 사진"으로 표시.
 * 글은 관리부가 올린 목록 블록 그대로(기종·시리얼·자산기번·주소) — 관리부 목록 원문(배치 raw·도착함 글)에서 그 업체 블록을 찾아 채우고,
 *   모자라면 임대리스트(vendor_info)로 보완한다(2026-10-10 "자산기번·시리얼·주소 못 불러와? 리스트에 다 있을 텐데").
 * 마감방 이름은 다른 방들과 같이 관리 탭 → 카톡방 매핑(room_map)에서 — 업무 종류 "마감", 지역은 팀 또는 * 공통.
 * (옛 app_config.COUNTER_KAKAO_ROOM 은 매핑이 없을 때만 읽는다 — 한 곳에서 관리, 2026-10-10 사용자 지적)
 */
import { prepareImageForUpload } from "./imageUpload";
import { getConfig, getRoomMap, insertRow, selectRows, uploadPhoto } from "./supabase";
import { detectAddress, findVendorBlocks, parseDeviceLine } from "../supabase/functions/_shared/counter-sms/parser.ts";

export const COUNTER_ROOM_KEY = "COUNTER_KAKAO_ROOM";
export const COUNTER_ROOM_CATEGORY = "마감";

export type CounterTargetLike = {
  id: string; vendor: string; team: string; machines: string[];
  batch_id?: string | null;
  lease_code?: string | null; serials?: string[] | null; assets?: string[] | null; list_kind?: string | null; cms_day?: number | null;
};
/** 글에 들어갈 기기·주소 — 여러 대면 쉼표로 잇는다 */
export type LeaseInfo = { address: string; model: string; serial: string; asset: string; leaseCode: string };

const str = (v: unknown) => String(v ?? "").replace(/_x000d_|\r/g, "").trim();
const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));
const kst = (d: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(/\. /g, "-").replace(/\.$/, "").replace(/-(\d{2}):/, " $1:");

/** 카드 업체명 → 글에 쓰는 이름: 파서가 붙인 등급 접두("N ")와 꼬리 기호("-", "/")를 뗀다 */
export function cleanVendorName(vendor: string): string {
  return str(vendor).replace(/^(?:SS|NN|V|S|N)\s+/i, "").replace(/[\s\-–—/／·,]+$/, "").trim();
}

/** 관리부 목록 원문(배치 raw·도착함 글)에서 이 업체 블록들을 찾아 기기 줄·주소를 읽는다 */
export function infoFromRaw(t: CounterTargetLike, raws: string[]): Partial<LeaseInfo> {
  const models: string[] = []; const serials: string[] = []; const assets: string[] = []; let address = ""; let leaseCode = "";
  for (const raw of raws) {
    for (const block of findVendorBlocks(str(raw), t.vendor, t.lease_code || "", (t.serials || [])[0] || "")) {
      const d = parseDeviceLine(block);
      if (d.model) models.push(d.model);
      if (d.serial) serials.push(d.serial);
      if (d.asset) assets.push(d.asset);
      if (d.leaseCode && !leaseCode) leaseCode = d.leaseCode;
      if (!address) address = detectAddress(block);
    }
    if (models.length || serials.length) break;   // 첫 원문(배치 raw)에서 찾았으면 그걸로
  }
  return { model: uniq(models).join(", "), serial: uniq(serials).join(", "), asset: uniq(assets).join(", "), address, leaseCode };
}

/** 마감방에 올릴 글 — 관리부가 바로 알아보게 목록 블록과 같은 항목을 한 줄씩. 빈 항목도 줄은 남긴다(2026-10-10 사용자 요청 형식) */
export function buildCounterCaption(t: CounterTargetLike, opts: { author: string; info?: Partial<LeaseInfo>; now?: Date; withLink?: string }): string {
  const vendor = cleanVendorName(t.vendor);
  const model = str(opts.info?.model) || (t.machines || []).filter((m) => m && m !== "기본 기종").join(", ");
  const serial = str(opts.info?.serial) || (t.serials || []).join(", ");
  const asset = str(opts.info?.asset) || (t.assets || []).join(", ");
  return [
    "[마감 카운터]",
    `${vendor}${t.list_kind === "CMS" ? ` (CMS${t.cms_day ? ` ${t.cms_day}일` : ""})` : ""}`,
    `기종: ${model}`,
    `시리얼넘버: ${serial}`,
    `자산기번: ${asset}`,
    `주소: ${str(opts.info?.address)}`,
    `전송: ${opts.author || "미지정"} · ${kst(opts.now || new Date())} · ${t.team}팀`,
    opts.withLink ? `사진: ${opts.withLink}` : "카운터 사진 첨부",
  ].join("\n");
}

/** 기기·주소 채우기 — ① 관리부 목록 원문 블록 ② 임대리스트(임대 코드 → 업체명 순) */
export async function lookupLeaseInfo(t: CounterTargetLike, raws: string[] = []): Promise<Partial<LeaseInfo>> {
  const fromRaw = infoFromRaw(t, raws);
  if (fromRaw.model && fromRaw.serial && fromRaw.address) return fromRaw;
  const enc = encodeURIComponent;
  const leaseCode = t.lease_code || fromRaw.leaseCode || "";
  const core = cleanVendorName(t.vendor).replace(/\s*\(.*$/, "").slice(0, 12);
  const filter = leaseCode ? `${enc('"코드"')}=eq.${enc(leaseCode)}` : `${enc('"_업체명"')}=ilike.*${enc(core)}*`;
  const rows = core || leaseCode
    ? await selectRows<Record<string, unknown>>("vendor_info", `select=${enc('"주소상세주소","시/구","모델명","기종","기번","시리얼번호(기번)","자산번호"')}&${filter}&_hidden=not.is.true&limit=5`).catch(() => [] as Record<string, unknown>[])
    : [];
  const pick = (k: string) => rows.map((r) => str(r[k])).find(Boolean) || "";
  return {
    model: fromRaw.model || pick("모델명") || pick("기종"),
    serial: fromRaw.serial || pick("기번") || pick("시리얼번호(기번)"),
    asset: fromRaw.asset || pick("자산번호"),
    address: fromRaw.address || pick("주소상세주소") || pick("시/구"),
    leaseCode,
  };
}

/** room_map(카테고리|지역 → 방)에서 마감방 고르기 — 팀 방이 있으면 팀 방, 없으면 * 공통 */
export function pickCounterRoom(map: Record<string, string>, team: string): string {
  const t = str(team).toUpperCase();
  return str((t && map[`${COUNTER_ROOM_CATEGORY}|${t}`]) || map[`${COUNTER_ROOM_CATEGORY}|*`]);
}

/** 관리 탭에 등록된 마감방들(표시용) — 지역 순 */
export async function counterRoomEntries(): Promise<Array<{ region: string; room: string }>> {
  const map = await getRoomMap().catch(() => ({} as Record<string, string>));
  const prefix = `${COUNTER_ROOM_CATEGORY}|`;
  return Object.entries(map).filter(([k, v]) => k.startsWith(prefix) && str(v)).map(([k, v]) => ({ region: k.slice(prefix.length), room: str(v) }))
    .sort((a, b) => (a.region === "*" ? -1 : b.region === "*" ? 1 : a.region.localeCompare(b.region)));
}

export async function counterRoomName(team = ""): Promise<string> {
  const map = await getRoomMap().catch(() => ({} as Record<string, string>));
  const fromMap = pickCounterRoom(map, team);
  if (fromMap) return fromMap;
  const cfg = await getConfig().catch(() => ({} as Record<string, string>));
  return str(cfg[COUNTER_ROOM_KEY]);
}

/** 노트북 작업 실행기가 최근 5분 안에 심박을 찍었나 — 그래야 카톡 PC로 사진을 붙일 수 있다 */
export async function workerAlive(): Promise<boolean> {
  const rows = await selectRows<{ last_seen: string }>("worker_heartbeat", "select=last_seen&order=last_seen.desc&limit=1").catch(() => [] as { last_seen: string }[]);
  const t = rows[0]?.last_seen ? new Date(rows[0].last_seen).getTime() : 0;
  return Date.now() - t < 5 * 60_000;
}

export type SendPlan = { room: string; channel: "pc" | "bot"; caption: string; info: Partial<LeaseInfo> };
export type SendResult = { channel: "pc" | "bot"; url: string; caption: string; room: string };

/** 관리부 목록 원문들 — 배치 raw(처음 목록) + 그 뒤 도착함으로 들어온 글(자동 반영분) */
async function rawSourcesFor(t: CounterTargetLike, given?: { raw?: string | null; batchId?: string | null }): Promise<string[]> {
  const batchId = given?.batchId || t.batch_id || "";
  const enc = encodeURIComponent;
  const [batchRaw, inboxRows] = await Promise.all([
    given?.raw ? Promise.resolve(given.raw) : batchId ? selectRows<{ raw: string }>("counter_sms_batches", `select=raw&id=eq.${enc(batchId)}&limit=1`).then((r) => r[0]?.raw || "").catch(() => "") : Promise.resolve(""),
    batchId ? selectRows<{ text: string }>("counter_sms_inbox", `select=text&batch_id=eq.${enc(batchId)}&order=id.desc&limit=20`).catch(() => [] as { text: string }[]) : Promise.resolve([] as { text: string }[]),
  ]);
  return [batchRaw, ...inboxRows.map((r) => r.text)].filter(Boolean);
}

/** 보내기 전에 보여 줄 것 — 방·경로·글. 사람이 확인창에서 글을 고칠 수 있다(2026-10-10 "확인 버튼이 꼭 나오게") */
export async function prepareCounterSend(t: CounterTargetLike, author: string, src?: { raw?: string | null; batchId?: string | null }): Promise<SendPlan> {
  const room = await counterRoomName(t.team);
  if (!room) throw new Error("마감 카톡방이 아직 없습니다 — 관리 탭 → 카톡방 매핑에서 업무 종류 '마감'(지역 * 공통 또는 팀)에 카톡 방 제목을 등록해 주세요");
  const raws = await rawSourcesFor(t, src);
  const [info, alive] = await Promise.all([lookupLeaseInfo(t, raws), workerAlive()]);
  const channel = alive ? "pc" : "bot";
  // 봇 경로는 사진 링크 줄이 붙는데 링크는 올린 뒤에 생긴다 → 확인창엔 자리만 보여 주고 보낼 때 실제 주소로 바꾼다
  return { room, channel, info, caption: buildCounterCaption(t, { author, info, withLink: channel === "bot" ? "(올린 뒤 주소가 들어갑니다)" : undefined }) };
}

export async function sendCounterPhoto(t: CounterTargetLike, file: File, author: string, plan: SendPlan): Promise<SendResult> {
  // 카운터 숫자가 읽혀야 한다 — 4MB 아래 원본은 그대로, 그보다 크면 2400px·0.9
  const prepared = await prepareImageForUpload(file, 2400, { quality: 0.9, keepOriginalUnderBytes: 4_000_000 });
  const url = await uploadPhoto(`counter/${t.team || "X"}/${Date.now()}-${t.id}.${prepared.ext}`, prepared.blob, prepared.contentType);
  if (plan.channel === "pc") {
    await insertRow("worker_jobs", { kind: "kakao_photo", payload: { room: plan.room, image_url: url, caption: plan.caption, target_id: t.id, vendor: t.vendor }, created_by: author || "미지정" });
    return { channel: "pc", url, caption: plan.caption, room: plan.room };
  }
  // 확인창에서 글을 고쳤어도 "사진:" 줄은 실제 주소로 바꾼다. 줄을 지웠으면 끝에 붙인다
  const caption = /^사진: .*$/m.test(plan.caption) ? plan.caption.replace(/^사진: .*$/m, `사진: ${url}`) : `${plan.caption.trim()}\n사진: ${url}`;
  await insertRow("outbox", { room: plan.room, text: caption });
  return { channel: "bot", url, caption, room: plan.room };
}
