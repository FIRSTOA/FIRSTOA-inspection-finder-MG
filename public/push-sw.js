/*
 * 푸시 전용 서비스워커 — fetch 핸들러가 없다(캐싱 일절 안 함).
 * 예전 SW가 낡은 자산을 캐시해 "배포해도 옛 화면" 문제를 만든 적이 있어
 * index.html에서 전 SW를 강제 해제했었다. 이 워커는 알림 수신·클릭만 담당하므로
 * 그 문제와 무관하다. 캐싱 기능을 추가하려면 그 역사를 먼저 볼 것.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "FIELD 알림", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "FIELD 알림";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const win of wins) {
      if ("focus" in win) { await win.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});
