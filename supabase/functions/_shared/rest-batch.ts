/**
 * 큰 적재를 나눠 넣기 — statement timeout(57014)이면 반으로 쪼개 다시 (2026-10-31)
 * Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API 없음.
 *
 * 왜: kakao-ingest 가 500행씩 kakao_messages 에 넣는데, 표가 27만 행을 넘고 글자 가림 트리거 + pg_trgm GIN 인덱스가 붙어
 *     한 번에 500행이 service_role 의 statement_timeout(8초, authenticator 상속)을 넘었다
 *     (kakao_import_log 실측: 10/29~10/31 강남C as·강남C 점검방 4건 "57014 canceling statement due to statement timeout", 0행 적재).
 * 어떻게: 묶음을 보내다 57014 가 나면 그 묶음만 반으로 나눠 다시 보낸다(최소 크기까지). 그 밖 오류는 그대로 던진다.
 *     같은 글 두 번 넣기는 on_conflict=hash + ignore-duplicates 라 안전하다(쪼개 다시 보내도 중복 없음).
 */

/** PostgREST/Postgres statement timeout 오류인가 */
export function isStatementTimeout(error: unknown): boolean {
  const msg = String((error as { message?: unknown })?.message ?? error ?? "");
  return /57014|statement timeout/i.test(msg);
}

/**
 * rows 를 size 씩 send 로 보낸다. send 는 넣은 행 수를 돌려준다.
 * 57014 면 그 묶음을 반으로 나눠 다시(묶음이 minSize 이하면 더 쪼개지 않고 던진다).
 */
export async function insertInChunks<T>(
  rows: T[],
  send: (chunk: T[]) => Promise<number>,
  opts: { size?: number; minSize?: number } = {},
): Promise<number> {
  const size = Math.max(1, opts.size ?? 250);
  const minSize = Math.max(1, opts.minSize ?? 25);
  const sendSplitting = async (chunk: T[]): Promise<number> => {
    try {
      return await send(chunk);
    } catch (error) {
      if (!isStatementTimeout(error) || chunk.length <= minSize) throw error;
      const half = Math.ceil(chunk.length / 2);
      return (await sendSplitting(chunk.slice(0, half))) + (await sendSplitting(chunk.slice(half)));
    }
  };
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) inserted += await sendSplitting(rows.slice(i, i + size));
  return inserted;
}
