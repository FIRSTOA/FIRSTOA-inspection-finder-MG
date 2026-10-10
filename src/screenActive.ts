/**
 * 화면 유지(keep-alive) 신호 (2026-10-11 속도)
 *
 * 왜: 탭을 누를 때마다 화면을 새로 만들어(언마운트→마운트) 0.5초쯤 빈 채로 있다가 값이 나오던 것이 싫다는 요청.
 *     자주 쓰는 화면은 한 번 열면 숨겨 두기만 하고(App.tsx KeepAlive) 다시 누르면 있던 값이 즉시 보이고 뒤에서 조용히 새로 읽는다.
 *     숨어 있는 동안에는 주기 조회를 쉬어야 하므로, 화면이 "지금 보이는지"를 이 컨텍스트로 알려 준다(기본값 true — 감싸지 않은 곳은 예전과 같다).
 */
import { createContext, useContext } from "react";

export const ScreenActiveContext = createContext(true);
export const useScreenActive = () => useContext(ScreenActiveContext);
