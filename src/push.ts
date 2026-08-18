/**
 * 웹푸시 구독 관리 — 접수·공지·요청·배정을 폰/PC 알림으로.
 *
 * 구조: 알림 허용 → push-sw.js 구독 → push_subscriptions에 저장(endpoint PK, 이름 연동)
 *       → 발송은 push-send Edge Function(VAPID 서명)이 대상 이름의 구독으로 밀어넣는다.
 * 알림음은 웹 표준이 지정을 막아 OS 기본음이 난다(받는 사람이 폰 설정에서 변경은 가능).
 * 아이폰은 "홈 화면에 추가"한 PWA에서만 구독 가능(iOS 16.4+ 제약).
 */
import { deleteRows, selectRows, updateRows, upsertRow } from "./supabase";

/** 알림 종류 — false로 저장된 종류는 push-send가 걸러서 안 보낸다 (기본은 전부 켜짐) */
export type PushCategory = "reception" | "notice" | "request" | "assign";
export const PUSH_CATEGORIES: Array<{ key: PushCategory; label: string; hint: string }> = [
  { key: "reception", label: "새 접수", hint: "내 팀 지역으로 접수가 들어올 때" },
  { key: "notice", label: "공지사항", hint: "나를 대상으로 공지가 올라올 때" },
  { key: "request", label: "부서 요청", hint: "나에게 온 요청·내 요청의 진행 소식" },
  { key: "assign", label: "일정 배정", hint: "내 이름으로 일정이 배정될 때" },
];

// VAPID 공개키(applicationServerKey) — 비밀키는 Supabase Secrets(VAPID_KEYS_JWK)에만 있다.
// 이 값을 바꾸면 기존 구독이 전부 무효가 되니 재발급 금지.
export const PUSH_PUBLIC_KEY = "BCx-wex0pGy_pZ9MWqhuUUuP5H5rfKOpBVwDacgBuJ2MC3AHNgYX1P1H_EqFx2S7-Du6-nj14SWVezYFk0tEdF8";

const SW_PATH = "/push-sw.js";
const ENABLED_KEY = "cs_push_enabled_v1"; // "1"이면 이 기기에서 켠 적 있음 — 로드 시 재등록 시도

function b64uToUint8(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

export function pushSupport(): "ok" | "ios-need-install" | "unsupported" {
  const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (iosSafari && !standalone) return "ios-need-install"; // iOS는 홈 화면 추가 후에만 푸시 가능
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

/** 예전 캐싱 SW 잔재는 걷어내고(스코프 불문) 푸시 전용 워커만 남긴다 — index.html의 전체 해제 스크립트 대체 */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs
    .filter((reg) => {
      const url = (reg.active || reg.waiting || reg.installing)?.scriptURL || "";
      return url && !url.endsWith(SW_PATH);
    })
    .map((reg) => reg.unregister().catch(() => false)));
  return navigator.serviceWorker.register(SW_PATH);
}

async function saveSubscription(sub: PushSubscription, person: string) {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("구독 정보가 비었습니다");
  await upsertRow("push_subscriptions", {
    endpoint: json.endpoint, person: person || "", team: "",
    p256dh: json.keys.p256dh, auth: json.keys.auth,
    ua: navigator.userAgent.slice(0, 200), updated_at: new Date().toISOString(),
  }, "endpoint");
}

/** 알림 켜기 — 권한 요청부터 서버 저장까지. 실패 사유를 그대로 던진다(호출부가 안내). */
export async function enablePush(person: string): Promise<void> {
  const support = pushSupport();
  if (support === "ios-need-install") throw new Error("아이폰은 사파리 공유 → \"홈 화면에 추가\" 후, 그 앱에서 알림을 켤 수 있어요.");
  if (support === "unsupported") throw new Error("이 브라우저는 알림을 지원하지 않습니다.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("알림 권한이 거부됐습니다 — 브라우저 주소창 왼쪽 자물쇠에서 허용으로 바꿔주세요.");
  const reg = await ensureRegistration();
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(PUSH_PUBLIC_KEY).buffer as ArrayBuffer });
  await saveSubscription(sub, person);
  localStorage.setItem(ENABLED_KEY, "1");
}

export async function disablePush(): Promise<void> {
  localStorage.removeItem(ENABLED_KEY);
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await deleteRows("push_subscriptions", `endpoint=eq.${encodeURIComponent(sub.endpoint)}`).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}

export async function isPushOn(): Promise<boolean> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => undefined);
  return !!(await reg?.pushManager.getSubscription());
}

async function currentEndpoint(): Promise<string> {
  if (!("serviceWorker" in navigator)) return "";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint || "";
}

/** 이 기기 구독의 종류별 설정 읽기 — 구독이 없으면 null */
export async function getPushPrefs(): Promise<Record<string, boolean> | null> {
  const endpoint = await currentEndpoint();
  if (!endpoint) return null;
  const rows = await selectRows<{ prefs: Record<string, boolean> | null }>(
    "push_subscriptions", `select=prefs&endpoint=eq.${encodeURIComponent(endpoint)}&limit=1`);
  return rows.length ? (rows[0].prefs || {}) : null;
}

export async function setPushPref(category: PushCategory, on: boolean): Promise<void> {
  const endpoint = await currentEndpoint();
  if (!endpoint) throw new Error("먼저 알림을 켜주세요.");
  const prefs = (await getPushPrefs()) || {};
  prefs[category] = on;
  await updateRows("push_subscriptions", `endpoint=eq.${encodeURIComponent(endpoint)}`, { prefs, updated_at: new Date().toISOString() });
  // PATCH는 0행이 맞아도 성공(204)이다 — 브라우저가 구독을 갈아끼웠거나 행이 지워졌으면 저장된 척만 하고
  // 새로고침하면 되돌아간다. 실제로 남았는지 확인해서 아니면 알린다.
  const after = await getPushPrefs();
  if (!after || after[category] !== on) throw new Error("이 기기의 알림 등록이 만료됐어요 — 알림을 껐다 다시 켜주세요.");
}

/**
 * 앱 로드·작성자 변경 시 호출 — 켜둔 기기라면 구독을 살리고 서버의 이름 연동을 최신화한다.
 * (구독 endpoint는 브라우저가 수시로 갈아끼울 수 있어 로드마다 upsert가 안전)
 */
export async function syncPush(person: string): Promise<void> {
  try {
    if (localStorage.getItem(ENABLED_KEY) !== "1") return;
    if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
    const reg = await ensureRegistration();
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(PUSH_PUBLIC_KEY).buffer as ArrayBuffer });
    await saveSubscription(sub, person);
  } catch { /* 알림 연동 실패가 앱 사용을 막으면 안 된다 */ }
}
