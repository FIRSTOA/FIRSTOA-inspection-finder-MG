/** 날짜 입력 어디를 눌러도 달력이 열리게(onClick 에만 — onFocus 는 키보드 포커스 때 반복 열림). */
export function openNativePicker(e: { currentTarget: { showPicker?: () => void } }): void {
  try { e.currentTarget.showPicker?.(); } catch { /* 지원 안 하는 브라우저 */ }
}
