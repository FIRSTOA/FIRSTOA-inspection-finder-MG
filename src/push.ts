/**
 * 웹푸시 구독 관리 — 접수·공지·요청·배정을 폰/PC 알림으로.
 *
 * 구조: 알림 허용 → push-sw.js 구독 → push_subscriptions에 저장(endpoint PK, 이름 연동)
 *       → 발송은 push-send Edge Function(VAPID 서명)이 대상 이름의 구독으로 밀어넣는다.
 * 알림음은 웹 표준이 지정을 막아 OS 기본음이 난다(받는 사람이 폰 설정에서 변경은 가능).
 * 아이폰은 "홈 화면에 추가"한 PWA에서만 구독 가능(iOS 16.4+ 제약).
 */
import { deleteRows, upsertRow } from "./supabase";

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
