/** 홈 — 퍼스트전산 메인 + 상세 사용설명서(상단아이콘/탭/버튼 전부). 아코디언으로 정리. */
import { useState } from "react";

function Section({ title, sub, children, defaultOpen }: { title: string; sub?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <div className="text-sm font-bold text-slate-900">{title}</div>
          {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
        </div>
        <span className={`text-slate-400 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-4">{children}</div>}
    </div>
  );
}

function Item({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm">{icon}</span>
      <div className="text-sm leading-relaxed text-slate-600">
        <b className="text-slate-900">{name}</b><br />{children}
      </div>
    </div>
  );
}

export default function Home({ onGoField }: { onGoField: () => void }) {
  return (
    <div className="space-y-3 pb-10">
      {/* 메인 박스 — 퍼스트전산 */}
      <div className="rounded-3xl bg-gradient-to-br from-[#3182F6] to-[#1B64DA] p-6 text-white shadow-sm">
        <div className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold">퍼스트전산 CS팀</div>
        <h2 className="mt-3 text-2xl font-bold leading-tight tracking-tight">현장의 모든 보고를<br />한 곳에서, 한 번에</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          점검·AS·확장성·불만·재계약까지 현장에서 작성하면 <b>카톡방 전송</b> + <b>데이터 저장·검색</b>까지 되는 통합 업무 앱이에요.
        </p>
        <button onClick={onGoField} className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#3182F6] transition active:scale-[0.98]">
          FIELD 시작하기 →
        </button>
      </div>

      <div className="px-1 pt-1 text-[11px] font-bold text-slate-400">사용 설명서</div>

      {/* 상단 아이콘 */}
      <Section title="상단 아이콘" sub="화면 맨 위 버튼들" defaultOpen>
        <Item icon="≡" name="메뉴 (좌측)">홈 · FIELD · 해피콜 · IT 견적 화면을 전환해요.</Item>
        <Item icon="🔍" name="거래처검색">거래처명으로 지난 점검/AS 양식을 찾아 불러와요. 결과는 지역(A~E)·계열로 묶여 보이고, 확장성 탭에선 청정기/PC 기록을 검색해요.</Item>
        <Item icon="📝" name="원본입력">카톡 원본 글을 붙여넣으면 자동으로 양식으로 변환돼요. (점검/AS)</Item>
        <Item icon="📷" name="사진양식">현장 사진을 찍으면 AI가 점검/청정기 양식을 자동으로 만들어줘요.</Item>
        <Item icon="🗂️" name="통합이력">그 거래처의 점검·AS·초과·미수·불만·재계약 등 전체 이력을 한눈에 봐요.</Item>
      </Section>

      {/* 탭 안내 */}
      <Section title="탭 안내" sub="점검 / AS / 확장성 / 더보기">
        <Item icon="🔧" name="점검">복합기/프린터 점검. 위 토글로 <b>복합기 ↔ 청정기</b> 전환. 거래처검색·사진양식 지원.</Item>
        <Item icon="🛠" name="AS">AS 접수내용을 붙여넣으면 깔끔한 양식으로 변환돼요.</Item>
        <Item icon="💻" name="확장성">PC·IT·복합기·네트워크 확장성(영업). 점검/AS 갔다가 바로 작성 — <b>불러오기</b>로 업체명·지역·키맨 자동 채움.</Item>
        <Item icon="📋" name="더보기 (불만·미수·초과조정·재계약)">상단 더보기 ▾ 안에 있어요. 폼 작성 → 카톡방 전송 + 저장. 불만/초과조정/재계약은 점검/AS 불러오기 지원. (미수는 준비중)</Item>
      </Section>

      {/* 보내기·자가·부품 */}
      <Section title="보내기 · 자가 · 부품" sub="맨 아래 버튼">
        <Item icon="📤" name="보내기">작성한 양식을 <b>담당 카톡방에 게시 + Supabase에 저장</b>해요. 지역에 맞는 방으로 자동 전송.</Item>
        <Item icon="🧴" name="자가">같은 양식을 <b>여분토너요청방</b>으로 보내요. (자가/토너/폐통 여분 요청 시)</Item>
        <Item icon="🔧" name="부품">같은 양식을 <b>부품요청방</b>으로 보내요. (부품 신청 시)</Item>
        <Item icon="📋" name="복사">결과 전체를 복사해요.</Item>
        <Item icon="🗑" name="초기화">입력한 내용을 모두 비워요.</Item>
      </Section>

      {/* 사진·연동 팁 */}
      <Section title="사진 첨부 · 불러오기" sub="현장에서 유용한 기능">
        <Item icon="📷" name="사진 첨부 (폼 하단)">현장 사진을 여러 장(수십 장도) 선택 → 보내기 하면 <b>링크 1개</b>로 모아져 카톡에 전송돼요. 링크 누르면 사진 갤러리.</Item>
        <Item icon="🔗" name="불러오기 연동">점검/AS를 먼저 작성하면, 확장성·불만 등에서 <b>[점검에서 불러오기]</b>로 업체명·지역·키맨을 그대로 가져와요. 키맨이 여러 명이면 골라서.</Item>
      </Section>

      <div className="px-2 pt-2 text-center text-[11px] text-slate-400">© 퍼스트전산 CS팀 · FIELD</div>
    </div>
  );
}
