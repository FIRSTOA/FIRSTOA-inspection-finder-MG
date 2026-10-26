/**
 * 재계약 보낸 뒤 "다음 확인일로 일정 만들까요?" — 상태·저장(겉모양은 RecontractScheduleSheet.view.tsx).
 * [일정 만들기] → createRecontractSchedule: as_tickets(일정리스트·웹캘린더·ICS) 1행 + 네이버 미러.
 * 실패 처리: 일정 저장 실패 → 오류 토스트·제안 유지(다시 물음) / 네이버만 실패 → 경고 + [네이버 다시 시도].
 */
import { useEffect, useState } from "react";
import { notify } from "./toast";
import { leaseAddressOf } from "./api";
import { getConfig } from "./supabase";
import { kstDate } from "./visits";
import {
  assigneeForRecontract, buildRecontractSummary, clearScheduleOffer, createRecontractSchedule, defaultScheduleTitle,
  naverEnabledOf, runNaverJob, scheduleResultMessage, teamForRecontract, validateScheduleInput, vendorOf,
  type NaverJob, type OpenRecontractTicket, type ScheduleChoice, type ScheduleOffer,
} from "./recontractSchedule";
import RecontractScheduleSheetView, { type ScheduleSheetPhase } from "./RecontractScheduleSheet.view";

type Props = {
  offer: ScheduleOffer;
  book: Partial<Record<string, string[]>>;
  names: string[];
  onDone: () => void;
  /** 자동 만들기(CategoryForm) 뒤에 열 때 — 같은 업체 열린 일정이 있으면 "dup", 네이버만 실패면 "naverFailed" 로 바로 연다 */
  initial?: { phase: "dup"; duplicates: OpenRecontractTicket[] } | { phase: "naverFailed"; naverJob: NaverJob; naverError: string };
};

export default function RecontractScheduleSheet({ offer, book, names, onDone, initial }: Props) {
  const today = kstDate();
  const vendor = vendorOf(offer.form);
  const writtenOn = kstDate(new Date(offer.at));
  const [date, setDate] = useState(String(offer.form["다음확인일"] || ""));
  const [team, setTeam] = useState(() => teamForRecontract(offer.form, offer.author, book));
  const [title, setTitle] = useState(() => defaultScheduleTitle(vendor, offer.testMode));
  const [address, setAddress] = useState("");
  const [noteEdit, setNoteEdit] = useState<string | null>(null); // null = 기본 문장(날짜 바꾸면 같이 바뀜)
  const [naverOn, setNaverOn] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<ScheduleSheetPhase>(initial?.phase || "form");
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<OpenRecontractTicket[]>(initial?.phase === "dup" ? initial.duplicates : []);
  const [naverJob, setNaverJob] = useState<NaverJob | null>(initial?.phase === "naverFailed" ? initial.naverJob : null);
  const [naverError, setNaverError] = useState(initial?.phase === "naverFailed" ? initial.naverError : "");

  const note = noteEdit ?? buildRecontractSummary(offer.form, offer.author, date, offer.text, writtenOn);

  useEffect(() => {
    let alive = true;
    // 장소 기본값 = 임대리스트 실납품 주소. 못 찾으면 빈칸(손으로)
    void leaseAddressOf(vendor).then((a) => { if (alive && a) setAddress((cur) => cur || a); }, (e) => console.warn("장소 기본값 조회 실패", e));
    void getConfig().then((cfg) => { if (alive) setNaverOn(naverEnabledOf(cfg)); }, () => { if (alive) setNaverOn(null); });
    return () => { alive = false; };
  }, [vendor]);

  const naverLine = offer.testMode
    ? "테스트 모드 — 제목에 [테스트]를 붙여 일정리스트·캘린더에만 만들고, 네이버에는 올리지 않습니다"
    : naverOn === false
      ? "네이버는 꺼져 있어 일정리스트·캘린더에만 만들어집니다"
      : "일정리스트·캘린더·네이버 캘린더에 함께 만들어집니다";
  const error = validateScheduleInput({ date, team, title }, today);

  const finish = () => { clearScheduleOffer(offer.dupKey); onDone(); };

  const run = async (choice: ScheduleChoice) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await createRecontractSchedule({
        dupKey: offer.dupKey, form: offer.form, author: offer.author, testMode: offer.testMode,
        date, team, title, address, note,
        assignee: assigneeForRecontract(offer.form, offer.author, names),
      }, choice, today);
      if (r.kind === "duplicate") { setDups(r.existing); setPhase("dup"); return; }
      clearScheduleOffer(offer.dupKey); // 일정은 저장됨 — 다시 묻지 않는다
      if (r.naver === "failed" && r.naverJob) {
        setNaverJob(r.naverJob);
        setNaverError(r.naverError || "");
        setPhase("naverFailed");
        notify(`네이버 등록 실패(일정리스트·캘린더는 정상): ${r.naverError || "알 수 없는 오류"}`, "error");
        return;
      }
      notify(scheduleResultMessage(r), "success");
      onDone();
    } catch (e) {
      // 제안은 기기에 남아 있다 — 다음 진입 때 다시 묻는다(24시간)
      notify(`일정 저장 실패 — 신호 확인 후 다시 시도해 주세요 (${(e as Error).message || "네트워크 오류"})`, "error");
      setPhase("form");
    } finally {
      setBusy(false);
    }
  };

  const retryNaver = async () => {
    if (!naverJob || busy) return;
    setBusy(true);
    try {
      await runNaverJob(naverJob);
      notify("네이버 캘린더에도 등록됐습니다 ✓", "success");
      onDone();
    } catch (e) {
      setNaverError((e as Error).message || "알 수 없는 오류");
      notify(`네이버 다시 시도 실패: ${(e as Error).message || "알 수 없는 오류"}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <RecontractScheduleSheetView
      phase={phase} vendor={vendor} today={today} date={date} team={team} title={title} address={address} note={note}
      naverLine={naverLine} error={error} busy={busy} duplicates={dups} naverError={naverError}
      onDate={setDate} onTeam={setTeam} onTitle={setTitle}
      onAddress={setAddress} onNote={setNoteEdit}
      onCreate={() => void run("auto")} onSkip={finish}
      onMove={(id) => void run({ moveId: id })} onCreateAnyway={() => void run("new")} onBackToForm={() => setPhase("form")}
      onRetryNaver={() => void retryNaver()} onFinish={onDone}
    />
  );
}
