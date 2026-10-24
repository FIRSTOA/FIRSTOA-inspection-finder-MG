/**
 * 숨은 화면 조회 차단 (2026-10-24 위험 점검 8번)
 *
 * 왜: 화면 유지(KeepAlive)로 숨어 있는 화면이 15·60초 주기와 창 focus 때마다 계속 읽고 있었다.
 *     홈을 한 번 연 사람은 다른 화면에 있어도 분당 ~30요청, 네이버 동기화 엣지 함수는 하루 ~4,300회(클라이언트 몫).
 * 규칙: 화면이 보일 때(useScreenActive) + 브라우저 탭이 보일 때만 읽는다.
 *       focus·화면 복귀처럼 몰리는 신호는 최소 간격(기본 15초, 홈 MIN_GAP_MS 와 같은 값) 안에 다시 읽지 않는다.
 */

export const FOCUS_MIN_GAP_MS = 15_000;
/** 네이버 일정 당기기 — cron 이 매분 당기므로 화면 focus 때는 5분에 한 번이면 충분하다 */
export const NAVER_PULL_GAP_MS = 5 * 60_000;

type VisibilityDoc = { visibilityState?: string } | undefined;

/** 브라우저 탭이 보이는지 — document 가 없으면(테스트·SSR) 보인다고 본다 */
export function pageVisible(doc: VisibilityDoc = typeof document !== "undefined" ? document : undefined): boolean {
  return !doc || doc.visibilityState === undefined || doc.visibilityState === "visible";
}

/** 지금 읽어도 되는가 — 화면 활성 + 탭 보임 */
export function canPoll(screenActive: boolean, visible: boolean = pageVisible()): boolean {
  return screenActive && visible;
}

export type GapGate = {
  /** 마지막 통과 뒤 최소 간격이 지났으면 통과(그리고 시각 기록). force 면 간격 무시 */
  tryPass: (force?: boolean) => boolean;
  /** 다른 길(주기 조회·단추)로 읽었을 때 시각만 기록 */
  mark: () => void;
};

export function createGapGate(minGapMs: number = FOCUS_MIN_GAP_MS, clock: () => number = () => Date.now()): GapGate {
  let last = Number.NEGATIVE_INFINITY;
  return {
    tryPass(force = false) {
      const now = clock();
      if (!force && now - last < minGapMs) return false;
      last = now;
      return true;
    },
    mark() { last = clock(); },
  };
}

/**
 * focus·visibilitychange 같은 이벤트 핸들러를 만든다 — 화면이 숨어 있거나 탭이 안 보이거나 간격 안이면 아무것도 안 한다.
 * isActive 는 ref 로 읽는 함수(이벤트 등록은 한 번, 값은 최신).
 */
export function gatedHandler(isActive: () => boolean, gate: GapGate, run: () => unknown, visible: () => boolean = () => pageVisible()): () => boolean {
  return () => {
    if (!canPoll(isActive(), visible())) return false;
    if (!gate.tryPass()) return false;
    void run();
    return true;
  };
}
