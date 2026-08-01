/**
 * 복합기 데일리 퀴즈 생성 — copier_notes 실기록을 OpenAI로 4지선다 문제로 정제.
 *   action=quizgen&date=YYYY-MM-DD&brand=삼성
 * 같은 (날짜, 브랜드)는 한 번만 생성해 copier_quiz_daily 에 캐시 — 첫 호출자가
 * 만들고(10~30초) 이후 모두 즉시 받는다. 프롬프트가 고객 말투를 걷어내고
 * 오답 보기를 창작하므로 원시 로그 그대로보다 문제 품질이 훨씬 낫다.
 */
var QUIZ_MAIN_BRANDS = ['삼성', '신도', '제록스', '교세라', '오키', '브라더'];

function copierQuizGen_(dateStr, brand) {
  var date = String(dateStr || '').slice(0, 10);
  var b = String(brand || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !b) return { error: 'date/brand 파라미터가 필요합니다' };

  var cached = quizDailyGet_(date, b);
  if (cached && cached.length) return { items: cached, cached: true };

  var notes = quizFetchNotes_(b);
  var usable = notes.filter(quizNoteUsable_);
  if (usable.length < 6) return { error: '문제로 쓸 기록 부족 (' + usable.length + '건)' };
  var seed = Number(date.replace(/-/g, ''));
  var picked = quizSeededShuffle_(usable, seed).slice(0, 12);

  var items = quizGenerateWithAI_(picked, b);
  if (!items.length) return { error: 'AI 문제 생성 실패' };

  quizDailyPut_(date, b, items);
  return { items: items, cached: false };
}

function quizFetchNotes_(brand) {
  var url = SUPABASE_URL + '/rest/v1/copier_notes?select=brand,model,title,content&title=neq.&content=neq.&order=created_at.desc&limit=300';
  if (QUIZ_MAIN_BRANDS.indexOf(brand) >= 0) url += '&brand=eq.' + encodeURIComponent(brand);
  else url += '&brand=not.in.(' + QUIZ_MAIN_BRANDS.map(encodeURIComponent).join(',') + ')'; // "기타" 묶음
  var res = UrlFetchApp.fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('copier_notes 조회 ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function quizNoteUsable_(n) {
  var t = String(n.title || '').trim();
  var c = String(n.content || '').trim();
  if (!t || !c) return false;
  if (t.length < 6 || t.length > 120) return false;
  if (c.length < 20 || c.length > 800) return false;
  if (/^(정기\s*점검|기본\s*점검|점검|방문|납품|설치)\s*$/.test(t)) return false;
  return true;
}

function quizSeededShuffle_(arr, seed) {
  var list = arr.slice();
  var state = seed || 1;
  var rnd = function () { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  for (var i = list.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  }
  return list;
}

function quizGenerateWithAI_(notes, brand) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY 스크립트 속성 미설정');
  var source = notes.map(function (n, i) {
    return '[기록' + (i + 1) + '] 기종: ' + (n.model || n.brand || '-') + '\n증상: ' + n.title + '\n처리: ' + n.content;
  }).join('\n\n');
  var schema = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            model: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answer_index: { type: 'integer' },
            explain: { type: 'string' }
          },
          required: ['question', 'model', 'options', 'answer_index', 'explain'],
          additionalProperties: false
        }
      }
    },
    required: ['questions'],
    additionalProperties: false
  };
  var payload = {
    model: KAKAO_AI_MODEL,
    messages: [
      {
        role: 'system',
        content: '너는 복합기(사무기기) 수리 기술 교육 퀴즈 출제자다. 실제 현장 처리 기록을 바탕으로 4지선다 문제 5개를 만들어라.\n규칙:\n- question: 증상을 고객 말투·인사말 없이 기술 용어의 한 문장으로 다듬고 "~할 때 올바른 조치는?" 형태로 끝낸다. 기종명을 문장에 넣지 말 것(별도 model 필드).\n- 정답 보기: 해당 기록의 실제 처리를 "1. ~ 2. ~" 번호 단계 2~4개로 요약.\n- 오답 보기 3개: 같은 브랜드 장비에서 그럴듯하지만 이 증상에는 틀린 조치를 창작(다른 기록의 처리를 변형해도 좋다). 길이는 정답과 비슷하게, 명백히 우스꽝스러운 보기는 금지.\n- options는 정확히 4개, answer_index는 0~3에서 무작위 위치.\n- explain: 왜 그 처리가 정답인지 한 문장.\n- 기록 중 품질이 낮은 것은 건너뛰고 서로 다른 기록 5개로 문제 5개를 만들어라.\n- 모든 텍스트는 한국어.'
      },
      { role: 'user', content: '브랜드: ' + brand + '\n\n' + source }
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'copier_quiz', strict: true, schema: schema } }
  };
  if (/^(gpt-5|o\d)/.test(KAKAO_AI_MODEL)) payload.max_completion_tokens = 5000;
  else { payload.max_tokens = 5000; payload.temperature = 0.4; }

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('OpenAI ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  var data = JSON.parse(res.getContentText());
  var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  var parsed = JSON.parse(content || '{}');
  var out = [];
  (parsed.questions || []).forEach(function (q) {
    if (!q || !q.question || !q.options || q.options.length !== 4) return;
    var idx = Number(q.answer_index);
    if (!(idx >= 0 && idx <= 3)) return;
    out.push({
      question: String(q.question), model: String(q.model || ''),
      options: q.options.map(String), answer_index: idx, explain: String(q.explain || '')
    });
  });
  return out.slice(0, 5);
}

function quizDailyGet_(date, brand) {
  var url = SUPABASE_URL + '/rest/v1/copier_quiz_daily?select=items&quiz_date=eq.' + date + '&brand=eq.' + encodeURIComponent(brand) + '&limit=1';
  var res = UrlFetchApp.fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var rows = JSON.parse(res.getContentText());
  return rows.length ? rows[0].items : null;
}

function quizDailyPut_(date, brand, items) {
  UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/copier_quiz_daily?on_conflict=quiz_date,brand', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, Prefer: 'resolution=merge-duplicates' },
    payload: JSON.stringify([{ quiz_date: date, brand: brand, items: items }]),
    muteHttpExceptions: true
  });
}
