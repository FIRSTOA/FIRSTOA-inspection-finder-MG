/**
 * gas-admin 엣지의 순수 규칙 (Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음).
 * 설계: docs/tasks/kakao-collect-expand.md 3-7.
 *  - 허용 목록: ingestnow·retryheld·kakaoclear 만. 행 삭제·초기화류(celltrim·dedupe·seenreset·cursorreset·rebuildindex …)는
 *    엣지로도 열지 않는다 — 운영자가 GAS 편집기에서 직접.
 *  - 분당 제한: 인스턴스 안 IP 별(대략적 — 인스턴스가 여러 개면 각자 센다).
 *  - 응답 가림: GAS 응답 글에 관리 토큰이 섞여 나오면 "***" 로 바꾼다.
 */

export const GAS_ADMIN_ACTIONS = ["ingestnow", "retryheld", "kakaoclear"] as const;
export type GasAdminAction = (typeof GAS_ADMIN_ACTIONS)[number];

/** 대소문자·앞뒤 공백을 무시하고 허용 목록에 있으면 정규화한 이름, 아니면 null. */
export function allowedGasAction(raw: unknown): GasAdminAction | null {
  const a = String(raw ?? "").trim().toLowerCase();
  return (GAS_ADMIN_ACTIONS as readonly string[]).includes(a) ? (a as GasAdminAction) : null;
}

/**
 * 고정 창(최근 60초) 횟수 제한기. hit(key, now) 가 true 면 "제한 걸림".
 * 걸린 호출도 기록에 넣지 않는다(계속 두드려도 1분 뒤 풀리게).
 */
export function createRateLimiter(perMinute: number, windowMs = 60_000, maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string, now = Date.now()): boolean {
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= perMinute) { hits.set(key, list); return true; }
      list.push(now);
      hits.set(key, list);
      if (hits.size > maxKeys) hits.clear(); // 메모리 보호
      return false;
    },
  };
}

/** GAS 부를 주소. 토큰은 쿼리에 붙는다(GAS 웹앱은 헤더를 못 읽는다). */
export function gasAdminUrl(base: string, action: GasAdminAction, token: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
}

/** 응답 글에서 토큰(그대로·URL 인코딩 둘 다)을 가린다. 토큰이 비었거나 4자 미만이면 손대지 않는다. */
export function redactSecret(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  let out = text.split(secret).join("***");
  const enc = encodeURIComponent(secret);
  if (enc !== secret) out = out.split(enc).join("***");
  return out;
}
