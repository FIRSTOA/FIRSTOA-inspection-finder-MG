/** 홈 — 퍼스트전산 메인 + 상세 사용설명서. 컬러 아이콘 타일 + 실제 버튼 미리보기로 가독성 강화. */
import { useState } from "react";

function Section({ title, sub, children, defaultOpen }: { title: string; sub?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <div className="text-[15px] font-bold text-slate-900">{title}</div>
          {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
        </div>
        <span className={`text-slate-300 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="space-y-1 border-t border-slate-100 px-4 py-3">{children}</div>}
    </div>
  );
}

// 컬러 아이콘 타일 행
function Row({ icon, tone, name, children }: { icon: string; tone: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl px-1.5 py-2.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: tone }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold text-slate-900">{name}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{children}</div>
      </div>
    </div>
  );
}

// 실제 버튼 모양 미리보기 행
function BtnRow({ chip, children }: { chip: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-1.5 py-2.5">
      <div className="flex w-[68px] shrink-0 justify-center">{chip}</div>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-500">{children}</div>
    </div>
  );
}

const chipBase = "rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm whitespace-nowrap";

export default function Home({ onGoField }: { onGoField: () => void }) {
  const cats: { icon: string; name: string; tone: string }[] = [
    { icon: "🔧", name: "점검", tone: "#EEF3F8" },
    { icon: "🛠", name: "AS", tone: "#EEF3F8" },
    { icon: "💻", name: "확장성", tone: "#ECFEFF" },
    { icon: "💢", name: "불만", tone: "#FEF2F2" },
    { icon: "💰", name: "미수", tone: "#FFF7ED" },
    { icon: "📈", name: "초과조정", tone: "#FEFCE8" },
    { icon: "📝", name: "재계약", tone: "#F0FDF4" },
  ];
  return (
    <div className="space-y-4 pb-10">
      {/* 메인 박스 */}
      <div className="rounded-3xl bg-gradient-to-br from-[#1E3A5F] to-[#142C49] p-6 text-white shadow-lg shadow-slate-900/20">
        <div className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold">퍼스트전산 CS팀</div>
        <h2 className="mt-3 text-[26px] font-bold leading-tight tracking-tight">현장의 모든 보고를<br />한 곳에서, 한 번에</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-white/85">
          점검·AS·확장성·불만·재계약까지 현장에서 작성하면 <b>카톡방 전송</b> + <b>데이터 저장·검색</b>까지 되는 통합 업무 앱이에요.
        </p>
        <button onClick={onGoField} className="mt-5 w-full rounded-2xl bg-white py-3.5 text-sm font-bold text-[#1E3A5F] transition active:scale-[0.98]">
          FIELD 시작하기 →
        </button>
      </div>

      {/* 기능 한눈에 — 카테고리 타일 */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 px-1 text-[13px] font-bold text-slate-900">무엇을 작성하나요?</div>
        <div className="grid grid-cols-4 gap-2">
          {cats.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-1.5 rounded-xl py-2.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ background: c.tone }}>{c.icon}</span>
              <span className="text-[11px] font-semibold text-slate-600">{c.name}</span>
            </div>
          ))}
          <button onClick={onGoField} className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 text-[#1E3A5F]">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1E3A5F] text-xl text-white">→</span>
            <span className="text-[11px] font-bold">바로가기</span>
          </button>
        </div>
      </div>

      <div className="px-1 pt-1 text-[12px] font-bold text-slate-400">📖 사용 설명서</div>

      {/* 상단 아이콘 */}
      <Section title="상단 아이콘" sub="화면 맨 위 버튼들" defaultOpen>
        <Row icon="≡" tone="#F1F5F9" name="메뉴 (좌측)">홈 · FIELD · 해피콜 · IT 견적 화면을 전환해요.</Row>
        <Row icon="🔍" tone="#EEF3F8" name="거래처검색">거래처명으로 지난 점검/AS 양식을 찾아 불러와요. 결과는 <b>지역(A~E)·계열</b>로 묶여 보이고, 확장성 탭에선 청정기/PC 기록을 검색해요.</Row>
        <Row icon="📝" tone="#EEF3F8" name="원본입력">카톡 원본 글을 붙여넣으면 자동으로 양식으로 변환돼요. (점검/AS)</Row>
        <Row icon="📷" tone="#EEF3F8" name="사진양식">모바일 <b>워킹맵 캡처 사진</b>을 올리면 AI가 점검/청정기 양식을 자동으로 만들어줘요.</Row>
        <Row icon="🗂️" tone="#EEF3F8" name="통합이력">그 거래처의 점검·AS·초과·미수·불만·재계약 등 <b>전체 이력</b>을 한눈에 봐요.</Row>
      </Section>

      {/* 탭 안내 */}
      <Section title="탭 안내" sub="점검 / AS / 확장성 / 더보기">
        <Row icon="🔧" tone="#EEF3F8" name="점검">복합기/프린터 점검. 위 토글로 <b>복합기 ↔ 청정기</b> 전환. 거래처검색·사진양식 지원.</Row>
        <Row icon="🛠" tone="#EEF3F8" name="AS">AS 접수내용을 붙여넣으면 깔끔한 양식으로 변환돼요.</Row>
        <Row icon="💻" tone="#ECFEFF" name="확장성">PC·IT·복합기·네트워크 확장성(영업). 점검/AS 갔다가 바로 작성 — <b>불러오기</b>로 업체명·지역·키맨 자동 채움.</Row>
        <Row icon="📋" tone="#F1F5F9" name="더보기 (불만·미수·초과조정·재계약)">상단 <b>더보기 ▾</b> 안에 있어요. 폼 작성 → 카톡방 전송 + 저장. 불만/초과조정/재계약은 점검/AS 불러오기 지원. (미수는 준비중)</Row>
      </Section>

      {/* 버튼 — 실제 모양 미리보기 */}
      <Section title="보내기 · 자가 · 부품" sub="맨 아래 버튼 (실제 모양)">
        <BtnRow chip={<span className={chipBase} style={{ background: "#1E3A5F", color: "#fff" }}>보내기</span>}>
          작성 양식을 <b>담당 카톡방 게시 + Supabase 저장</b>. 지역에 맞는 방으로 자동 전송.
        </BtnRow>
        <BtnRow chip={<span className={chipBase} style={{ background: "#0f766e", color: "#fff" }}>자가</span>}>
          같은 양식을 <b>여분토너요청방</b>으로. (자가/토너/폐통 여분 요청 시)
        </BtnRow>
        <BtnRow chip={<span className={chipBase} style={{ background: "#b45309", color: "#fff" }}>부품</span>}>
          같은 양식을 <b>부품요청방</b>으로. (부품 신청 시)
        </BtnRow>
        <BtnRow chip={<span className={`${chipBase} border border-slate-200`} style={{ background: "#fff", color: "#475569" }}>복사</span>}>
          결과 전체를 복사해요.
        </BtnRow>
        <BtnRow chip={<span className={`${chipBase} border border-slate-200`} style={{ background: "#fff", color: "#475569" }}>초기화</span>}>
          입력한 내용을 모두 비워요.
        </BtnRow>
      </Section>

      {/* 사진·연동 */}
      <Section title="사진 첨부 · 불러오기" sub="현장에서 유용한 기능">
        <Row icon="📷" tone="#EEF3F8" name="사진 첨부 (폼 하단)">현장 사진을 여러 장(수십 장도) 선택 → 보내기 하면 <b>링크 1개</b>로 모아져 카톡에 전송돼요. 링크 누르면 사진 갤러리.</Row>
        <Row icon="🔗" tone="#F0FDF4" name="불러오기 연동">점검/AS를 먼저 작성하면, 확장성·불만 등에서 <b>[점검에서 불러오기]</b>로 업체명·지역·키맨을 그대로 가져와요. 키맨이 여러 명이면 골라서.</Row>
      </Section>

      <div className="px-2 pt-2 text-center text-[11px] text-slate-400">© 퍼스트전산 CS팀 · FIELD</div>
    </div>
  );
}
