/* מדברים – offline-first language trainer. Plain JS, no build step.
   Content: courses/index.json lists courses; each course is courses/<id>/course.json
   (generated from course.txt by tools/build-course.mjs). Progress lives in localStorage. */
'use strict';

const APP_VERSION = '1.6.0';
const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('backBtn');
const $banner = document.getElementById('banner');
const $net = document.getElementById('net');

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => Date.now();
const MIN = 60e3, DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const HARAKAT = /[ً-ٰٟـ]/g;
const stripHarakat = (s) => s.replace(HARAKAT, '');
const normAr = (s) => stripHarakat(s).replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[؟?!،,.\-…]/g, '').replace(/\s+/g, ' ').trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const isOnline = () => navigator.onLine !== false;

// ---------- Arabic letters ----------
const NON_CONNECTORS = new Set([...'اأإآدذرزوؤةىء']);
const LETTER_NAMES = {
  'ا': 'أَلِف', 'ب': 'باء', 'ت': 'تاء', 'ث': 'ثاء', 'ج': 'جيم', 'ح': 'حاء', 'خ': 'خاء', 'د': 'دال', 'ذ': 'ذال',
  'ر': 'راء', 'ز': 'زاي', 'س': 'سين', 'ش': 'شين', 'ص': 'صاد', 'ض': 'ضاد', 'ط': 'طاء', 'ظ': 'ظاء', 'ع': 'عَين',
  'غ': 'غَين', 'ف': 'فاء', 'ق': 'قاف', 'ك': 'كاف', 'ل': 'لام', 'م': 'ميم', 'ن': 'نون', 'ه': 'هاء', 'و': 'واو',
  'ي': 'ياء', 'ة': 'تاء مَربوطة', 'ى': 'أَلِف مَقصورة', 'ء': 'هَمزة', 'لا': 'لام أَلِف', 'ال': 'أَل',
};
const isSingleLetter = (ch) => [...ch].length === 1 && /[ء-ي]/.test(ch);
function letterForms(ch) {
  if (!isSingleLetter(ch) || ch === 'ء') return null;
  const joins = !NON_CONNECTORS.has(ch);
  return {
    isolated: ch,
    initial: joins ? ch + 'ـ' : ch,
    medial: joins ? 'ـ' + ch + 'ـ' : 'ـ' + ch,
    final: 'ـ' + ch,
  };
}
// split an Arabic word into tiles: base letter + its diacritics
function graphemes(s) {
  const out = [];
  for (const c of s.replace(/ـ/g, '')) {
    if (/[ً-ٰٟ]/.test(c) && out.length) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

// ---------- speech ----------
const Speech = {
  voices: [],
  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(course?.lang || 'ar'));
    };
    load();
    speechSynthesis.onvoiceschanged = load;
  },
  available() { return 'speechSynthesis' in window && this.voices.length > 0; },
  voice() {
    const want = settings.voiceURI;
    return this.voices.find((v) => v.voiceURI === want) || this.voices.find((v) => v.localService) || this.voices[0];
  },
  token: 0,
  speak(text, opts = {}) {
    if (!('speechSynthesis' in window) || !text) { opts.onend?.(); return; }
    if (opts.queue) return this.utter(text, opts);
    // cancel() is asynchronous on some phones: an utterance queued right after it can be dropped, or an
    // older one can play instead. Wait a moment and only speak if nothing newer was requested meanwhile.
    const token = ++this.token;
    speechSynthesis.cancel();
    setTimeout(() => { if (token === this.token) this.utter(text, opts); }, 70);
  },
  // speak after a delay unless anything else was spoken or stopped in between (autoplay)
  later(text, ms) {
    const token = ++this.token;
    setTimeout(() => { if (token === this.token) this.speak(text); }, ms);
  },
  utter(text, opts) {
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) u.voice = v;
    u.lang = v?.lang || 'ar';
    u.rate = (opts.rate || 1) * settings.rate;
    u.onend = () => opts.onend?.();
    u.onerror = () => opts.onend?.();
    speechSynthesis.speak(u);
  },
  stop() { this.token++; if ('speechSynthesis' in window) speechSynthesis.cancel(); },
};
const spokenText = (e) => (e.kind === 'letter' ? (LETTER_NAMES[e.ar] || e.ar) : e.ar);
const speakEntry = (e, opts) => Speech.speak(spokenText(e), opts);

// online-only: pronunciation check with the browser's speech recognition
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listenOnce(lang) {
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = lang; r.interimResults = false; r.maxAlternatives = 5;
    r.onresult = (ev) => resolve([...ev.results[0]].map((a) => a.transcript));
    r.onerror = (ev) => reject(ev.error);
    r.onend = () => resolve([]);
    r.start();
  });
}
function similarity(a, b) {
  a = normAr(a).replace(/\s/g, ''); b = normAr(b).replace(/\s/g, '');
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

// ---------- state ----------
let courses = [];
let course = null;
let courseId = store.get('lingo:course', 'ar-he');
const settings = Object.assign(
  { rate: 0.85, voiceURI: '', autoplay: true, showTr: true, harakat: true, theme: 'auto', claudeKey: '' },
  store.get('lingo:settings', {}),
);
const saveSettings = () => store.set('lingo:settings', settings);
let P = null; // progress of current course
const progKey = () => `lingo:progress:${courseId}`;
const saveP = () => store.set(progKey(), P);
const loadP = () => { P = Object.assign({ items: {}, lessons: {}, days: {}, mistakes: {} }, store.get(progKey(), {})); };

let LESSONS = [];         // flat list of lessons with unit ref
const ENTRY = new Map();  // id -> entry
const EXTRA = new Map();  // id -> generated entry (verb forms) that isn't part of a lesson
const anyEntry = (id) => ENTRY.get(id) || EXTRA.get(id);

function indexCourse() {
  LESSONS = []; ENTRY.clear(); CLOZE_WORDS = null;
  course.units.forEach((u, ui) => u.lessons.forEach((l) => {
    l.unit = u; l.unitIndex = ui; l.index = LESSONS.length; LESSONS.push(l);
    l.entries = [];
    for (const L of l.letters || []) {
      const mark = L.ch.startsWith('ـ');
      const e = mark
        ? { id: L.id, kind: 'mark', ar: L.ex.ar, tr: L.ex.tr, he: `${L.sound} (${L.name})`, letter: L, lesson: l }
        : { id: L.id, kind: 'letter', ar: L.ch, tr: L.name, he: L.sound, letter: L, lesson: l };
      l.entries.push(e);
    }
    for (const it of l.items || []) l.entries.push({ ...it, kind: 'word', lesson: l });
    (l.lines || []).forEach((ln, idx) => l.entries.push({ ...ln, kind: 'line', lesson: l, idx }));
    for (const e of l.entries) if (!ENTRY.has(e.id)) ENTRY.set(e.id, e);
  }));
}

// ---------- spaced repetition (Leitner boxes) ----------
const INTERVAL = [0, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY];
const KNOWN_BOX = 5;
function grade(id, ok) {
  const r = P.items[id] || (P.items[id] = { b: 0, d: 0, c: 0, w: 0 });
  if (ok) { r.b = Math.min(r.b + 1, INTERVAL.length - 1); r.c++; } else { r.b = 1; r.w++; }
  r.d = now() + INTERVAL[r.b];
  r.t = now();
  P.days[today()] = (P.days[today()] || 0) + 1;
  saveP();
}
function markKnown(id, known = true) {
  const r = P.items[id] || (P.items[id] = { b: 0, d: 0, c: 0, w: 0 });
  r.b = known ? KNOWN_BOX : 1; r.d = now() + INTERVAL[r.b]; r.t = now();
  saveP();
}
const status = (id) => {
  const r = P.items[id];
  if (!r) return 'new';
  if (r.b >= KNOWN_BOX) return 'known';
  if (r.b <= 2 && r.w > 0) return 'hard';
  return 'learning';
};
const STATUS_LABEL = { new: 'חדש', hard: 'קשה לי', learning: 'בלמידה', known: 'יודע' };
const STATUS_CLASS = { new: '', hard: 'bad', learning: '', known: 'good' };
const dueEntries = () => [...ENTRY.values()].filter((e) => P.items[e.id] && P.items[e.id].d <= now()).sort((a, b) => P.items[a.id].d - P.items[b.id].d);
function streak() {
  let n = 0; const d = new Date();
  if (!P.days[today()]) d.setDate(d.getDate() - 1);
  while (P.days[d.toISOString().slice(0, 10)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
const lessonDone = (l) => (P.lessons[l.id]?.best ?? 0) >= 70;
const lessonKnownPct = (l) => {
  if (!l.entries.length) return 0;
  const k = l.entries.filter((e) => (P.items[e.id]?.b ?? 0) >= 3).length;
  return Math.round((k / l.entries.length) * 100);
};

// ---------- rendering helpers ----------
const arText = (s) => (settings.harakat ? s : stripHarakat(s));
const arSpan = (s, cls = '') => `<span class="ar ${cls}" lang="ar">${esc(arText(s))}</span>`;
const playBtn = (id, cls = '') => `<button class="play ${cls}" data-play="${esc(id)}" aria-label="השמע">🔊</button>`;
const trLine = (e) => (settings.showTr && e.tr ? `<div class="tr">${esc(e.tr)}</div>` : '');
function setHeader(title, back) {
  $title.textContent = title;
  $back.hidden = !back;
  $back.onclick = () => (typeof back === 'string' ? (location.hash = back) : history.back());
}
function setTab(name) {
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}
function bindPlay(root = $app) {
  root.querySelectorAll('[data-play]').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); const e = anyEntry(b.dataset.play); if (e) speakEntry(e); else Speech.speak(b.dataset.play); };
  });
  root.querySelectorAll('[data-explain]').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); const e = anyEntry(b.dataset.explain); if (e) explain(e); };
  });
}
// transliteration kept hidden behind a button (used when the task is to produce the Arabic)
const hintTr = (tr) => (tr ? `<button class="hint-btn" onclick="this.hidden=true;this.nextElementSibling.hidden=false">💡 הצג תעתיק</button><div class="tr" hidden>${esc(tr)}</div>` : '');
// for listening questions when you can't play sound: show what is said
const revealSaid = (html) => (html ? `<div><button class="hint-btn" onclick="this.hidden=true;this.nextElementSibling.hidden=false">👁 הצג מה נאמר</button><div hidden>${html}</div></div>` : '');
const explainBtn = (e) => (isOnline() ? `<button class="btn ghost mini-btn" data-explain="${esc(e.id)}">✨ הסבר עם Claude</button>` : '');
function renderTable(rows) {
  if (!rows?.length) return '';
  const [head, ...body] = rows;
  const cell = (c) => (/[؀-ۿ]/.test(c) ? arSpan(c) : esc(c));
  return `<table class="grid"><tr>${head.map((h) => `<th>${cell(h)}</th>`).join('')}</tr>${
    body.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
function renderIntro(l) {
  const intro = (l.intro || []).map((p) => `<p>${esc(p).replace(/([؀-ۿ][؀-ۿً-ْ\s]*[؀-ۿً-ْ])/g, '<span class="ar">$1</span>')}</p>`).join('');
  if (!intro && !l.table) return '';
  return `<div class="card intro">${intro}${renderTable(l.table)}</div>`;
}

// ---------- views ----------
function viewHome() {
  setHeader(course.title, null); setTab('home');
  const due = dueEntries().length;
  const known = [...ENTRY.values()].filter((e) => status(e.id) === 'known').length;
  const nextLesson = LESSONS.find((l) => !lessonDone(l));
  const picker = courses.length > 1 ? `<div class="course-pick">${courses.map((c) =>
    `<button data-course="${esc(c.id)}" class="${c.id === courseId ? 'on' : ''}" ${c.file ? '' : 'disabled'}>${esc(c.flag || '')} ${esc(c.title)}${c.file ? '' : ' · בקרוב'}</button>`).join('')}</div>` : '';
  let html = `${picker}
  <div class="stats">
    <div class="stat"><b>${known}</b><span>מילים שאני יודע</span></div>
    <div class="stat"><b>${due}</b><span>לחזרה עכשיו</span></div>
    <div class="stat"><b>${streak()}🔥</b><span>ימים ברצף</span></div>
  </div>
  <div class="btns" style="margin-bottom:16px">
    ${nextLesson ? `<a class="btn" href="#/lesson/${nextLesson.id}">▶ להמשיך: ${esc(nextLesson.title)}</a>` : ''}
    <a class="btn secondary" href="#/review">🔁 חזרה (${due})</a>
    ${mistakeList().length ? `<a class="btn secondary" href="#/quiz/daily">📅 טעויות לתרגול (${mistakeList().length})</a>` : ''}
  </div>`;
  for (const u of course.units) {
    const done = u.lessons.filter(lessonDone).length;
    html += `<section class="unit"><div class="unit-head"><h2>${esc(u.title)}</h2><span class="muted small">${done}/${u.lessons.length}</span></div>
      ${u.desc ? `<div class="muted small" style="margin:-6px 4px 8px">${esc(u.desc)}</div>` : ''}`;
    for (const l of u.lessons) {
      const isDone = lessonDone(l), rec = P.lessons[l.id];
      const pct = lessonKnownPct(l);
      html += `<a class="lesson ${isDone ? 'done' : ''} ${l === nextLesson ? 'next' : ''}" href="#/lesson/${l.id}" data-lesson="${l.id}">
        <span class="dot">${isDone ? '✓' : l.index + 1}</span>
        <span class="grow"><h3>${esc(l.title)}</h3><span class="muted small">${l.entries.length} פריטים${rec?.at ? ` · ציון ${rec.best}%` : rec ? ' · התחלתי' : ''}</span>
        <div class="bar"><i style="width:${pct}%"></i></div></span></a>`;
    }
    html += '</section>';
  }
  $app.innerHTML = html;
  $app.querySelectorAll('[data-course]').forEach((b) => (b.onclick = () => switchCourse(b.dataset.course)));
}

function viewLesson(id) {
  const l = LESSONS.find((x) => x.id === id);
  if (!l) return viewHome();
  setHeader(l.title, '#/'); setTab('home');
  const isDialogue = l.type === 'dialogue';
  const buildable = l.entries.filter(canBuild).length >= 3;
  let html = `<div class="muted small" style="margin-bottom:6px">${esc(l.unit.title)}</div>${renderIntro(l)}
  <div class="btns">
    <a class="btn" href="#/learn/${l.id}">📖 ללמוד</a>
    <a class="btn" href="#/quiz/${l.id}">✏️ תרגול מלא</a>
  </div>
  <p class="small muted" style="margin:6px 4px 8px">התרגול המלא מתחיל קל (לזהות ולבחור מילים), ממשיך לכתיבה באותיות${l.cat === 'conj' || ['adj', 'feel'].includes(l.cat) || lessonAdjs(l).length ? ' ולהטיות' : ''}, ונגמר בבניית משפטים וכתיבת משפט שלם.</p>
  <details class="card focused"><summary>🎯 תרגולים ממוקדים</summary><div class="btns" style="margin-top:10px">
    ${buildable ? `<a class="btn secondary" href="#/quiz/${l.id}/build">🔤 כתיבה באותיות</a>` : ''}
    ${l.entries.some((e) => e.kind !== 'line') ? `<a class="btn secondary" href="#/quiz/${l.id}/listen">👂 הקשבה</a>` : ''}
    ${sentencesFor(l).length ? `<a class="btn secondary" href="#/quiz/${l.id}/sent">🧩 בניית משפטים</a><a class="btn secondary" href="#/quiz/${l.id}/write">⌨️ כתיבת משפט שלם</a>` : ''}
    ${l.cat === 'conj' && tensesUpTo(l).length ? `<a class="btn secondary" href="#/quiz/conj/${l.id}">🔁 הטיות פעלים</a>` : ''}
    ${['adj', 'feel'].includes(l.cat) && (course.adjs || []).length ? `<a class="btn secondary" href="#/quiz/conj/t:adj">🔁 תארים: זכר/נקבה/רבים</a>` : ''}
  </div></details>`;
  if (isDialogue) {
    html += `<div class="card"><div class="row" style="margin-bottom:10px"><button class="btn secondary" id="playAll">▶ השמע את כל השיחה</button>
      <label class="small muted row" style="gap:6px"><input type="checkbox" class="switch" id="hideHe"> הסתר תרגום</label></div>
      <div class="dialogue" id="dlg">${renderDialogue(l)}</div></div>`;
  } else {
    html += `<div class="card">${l.entries.map((e) => entryRow(e)).join('')}</div>`;
  }
  html += `<a class="btn ghost block" href="#/quiz/${l.id}">✏️ לתרגל את השיעור</a>`;
  $app.innerHTML = html;
  bindPlay();
  if (isDialogue) {
    const whos = [...new Set(l.lines.map((x) => x.who))];
    document.getElementById('playAll').onclick = () => {
      let i = 0;
      const lines = [...$app.querySelectorAll('.dialogue .line')];
      const next = () => {
        lines.forEach((x) => (x.style.outline = ''));
        if (i >= l.lines.length) return;
        lines[i].style.outline = '2px solid var(--brand)';
        lines[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        Speech.speak(l.lines[i].ar, { onend: () => { i++; setTimeout(next, 350); } });
      };
      next();
    };
    document.getElementById('hideHe').onchange = (ev) => $app.querySelectorAll('.dialogue .he').forEach((x) => (x.hidden = ev.target.checked));
    void whos;
  }
}
function renderDialogue(l) {
  const first = l.lines[0]?.who;
  return l.lines.map((x) => `<div class="line ${x.who === first ? '' : 'b'}"><div class="who">${esc(x.who)}</div>
    <div class="bubble">${arSpan(x.ar)} ${playBtn(x.id)}${trLine(x)}<div class="he">${esc(x.he)}</div></div></div>`).join('');
}
function entryRow(e) {
  const st = status(e.id);
  return `<div class="word-row">${playBtn(e.id)}
    <div class="grow">${arSpan(e.ar, e.kind === 'letter' ? 'mid-ar' : '')}${trLine(e)}<div>${esc(e.he)}${e.note ? ` <span class="muted small">(${esc(e.note)})</span>` : ''}</div></div>
    ${st !== 'new' ? `<span class="tag ${STATUS_CLASS[st]}">${STATUS_LABEL[st]}</span>` : ''}</div>`;
}

// ---- learn (flashcards) ----
function viewLearn(id) {
  const l = LESSONS.find((x) => x.id === id);
  if (!l) return viewHome();
  setHeader('לומדים: ' + l.title, `#/lesson/${id}`); setTab('home');
  P.lessons[l.id] = P.lessons[l.id] || { best: 0 }; saveP();
  let i = 0;
  const show = () => {
    const e = l.entries[i];
    const forms = e.kind === 'letter' ? letterForms(e.ar) : null;
    $app.innerHTML = `<div class="quiz-top"><span class="small muted">${i + 1}/${l.entries.length}</span><div class="bar"><i style="width:${((i + 1) / l.entries.length) * 100}%"></i></div></div>
      <div class="card center">
        <div class="big-ar">${arSpan(e.ar)}</div>
        ${playBtn(e.id, 'lg')}
        ${e.tr ? `<div class="tr" style="font-size:20px;margin-top:8px">${esc(e.tr)}</div>` : ''}
        <div style="font-size:21px;font-weight:600;margin-top:4px">${esc(e.he)}</div>
        ${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}
        ${e.who ? `<div class="muted small">אומר/ת: ${esc(e.who)}</div>` : ''}
      </div>
      ${forms ? `<div class="card"><h3>צורות האות</h3><div class="forms">
        <div>${arSpan(forms.isolated)}<small>לבד</small></div><div>${arSpan(forms.initial)}<small>בהתחלה</small></div>
        <div>${arSpan(forms.medial)}<small>באמצע</small></div><div>${arSpan(forms.final)}<small>בסוף</small></div></div></div>` : ''}
      ${e.letter && e.kind === 'letter' ? `<div class="card row"><button class="play" data-say="${esc(e.letter.ex.ar)}">🔊</button>
        <div class="grow">${arSpan(e.letter.ex.ar, 'mid-ar')}${settings.showTr ? `<div class="tr">${esc(e.letter.ex.tr)}</div>` : ''}<div>${esc(e.letter.ex.he)}</div></div></div>` : ''}
      ${e.kind === 'letter' || canBuild(e) ? `<details class="card"><summary>✍️ תרגול כתיבה ביד</summary><div style="margin-top:10px">${traceHtml(e.ar)}</div></details>` : ''}
      <div id="online-extras"></div>
      <div class="btns">
        <button class="btn ghost" id="prev" ${i === 0 ? 'disabled' : ''}>→ הקודם</button>
        <button class="btn secondary" id="knowIt">✓ כבר יודע</button>
        <button class="btn" id="next">${i === l.entries.length - 1 ? 'לתרגול ✏️' : 'הבא ←'}</button>
      </div>`;
    bindPlay();
    $app.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => Speech.speak(b.dataset.say)));
    bindTrace();
    renderOnlineExtras(e, document.getElementById('online-extras'));
    if (!P.items[e.id]) { P.items[e.id] = { b: 0, d: now() + INTERVAL[1], c: 0, w: 0, t: now() }; saveP(); }
    if (settings.autoplay) Speech.later(spokenText(e), 250); else Speech.stop();
    const go = (d) => { i += d; if (i >= l.entries.length) location.hash = `#/quiz/${l.id}`; else show(); };
    document.getElementById('prev').onclick = () => go(-1);
    document.getElementById('next').onclick = () => go(1);
    document.getElementById('knowIt').onclick = () => { markKnown(e.id); go(1); };
  };
  show();
}
function renderOnlineExtras(e, el) {
  if (!el || !isOnline()) return;
  const parts = [];
  if (SR && e.kind !== 'letter') parts.push(`<button class="btn secondary" id="srBtn">🎤 בדיקת הגייה</button>`);
  if (e.kind !== 'letter') parts.push(`<button class="btn ghost" data-explain="${esc(e.id)}">✨ הסבר עם Claude</button>`);
  parts.push(`<a class="btn ghost" target="_blank" rel="noopener" href="https://translate.google.com/?sl=ar&tl=iw&op=translate&text=${encodeURIComponent(e.ar)}">🌐 Google Translate</a>`);
  el.innerHTML = `<div class="card"><div class="small muted" style="margin-bottom:6px">כלים שעובדים רק עם אינטרנט</div><div class="btns">${parts.join('')}</div><div id="srOut" class="small" style="margin-top:8px"></div></div>`;
  bindPlay(el);
  const b = document.getElementById('srBtn');
  if (b) b.onclick = async () => {
    const out = document.getElementById('srOut');
    out.textContent = 'מקשיב... תגיד/י את המילה';
    try {
      const alts = await listenOnce('ar-JO');
      if (!alts.length) { out.textContent = 'לא שמעתי כלום, נסה שוב.'; return; }
      const best = Math.max(...alts.map((a) => similarity(a, e.ar)));
      const pct = Math.round(best * 100);
      out.innerHTML = `${pct >= 75 ? '🎉 מעולה!' : pct >= 50 ? '👍 קרוב!' : '🔁 נסה שוב'} · התאמה ${pct}% · שמעתי: <span class="ar">${esc(alts[0])}</span>`;
    } catch (err) { out.textContent = 'זיהוי דיבור לא זמין כרגע (' + err + ')'; }
  };
}

// ---- trace (handwriting practice) ----
const traceHtml = (text) => `<div class="trace-wrap"><div class="ghost ar">${esc(stripHarakat(text))}</div><canvas></canvas></div>
  <div class="btns" style="margin-top:8px"><button class="btn ghost" data-clear>🧽 נקה</button><button class="btn ghost" data-toggle-ghost>👁 הצג/הסתר דוגמה</button></div>`;
function bindTrace() {
  $app.querySelectorAll('.trace-wrap').forEach((wrap) => {
    const cv = wrap.querySelector('canvas');
    const ghost = wrap.querySelector('.ghost');
    const len = [...stripHarakat(ghost.textContent)].length;
    ghost.style.fontSize = Math.max(50, Math.min(160, 520 / Math.max(1, len))) + 'px';
    const ctx = cv.getContext('2d');
    const fit = () => { const r = wrap.getBoundingClientRect(); if (!r.width) return; cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio); ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand'); };
    const details = wrap.closest('details');
    if (details) details.addEventListener('toggle', fit, { once: true }); else fit();
    let drawing = false;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    cv.onpointerdown = (ev) => { drawing = true; cv.setPointerCapture(ev.pointerId); ctx.beginPath(); ctx.moveTo(...pos(ev)); };
    cv.onpointermove = (ev) => { if (!drawing) return; ctx.lineTo(...pos(ev)); ctx.stroke(); };
    cv.onpointerup = cv.onpointercancel = () => (drawing = false);
    const btns = wrap.nextElementSibling;
    btns.querySelector('[data-clear]').onclick = () => ctx.clearRect(0, 0, cv.width, cv.height);
    btns.querySelector('[data-toggle-ghost]').onclick = () => (ghost.hidden = !ghost.hidden);
  });
}

// ---------- quiz ----------
function canBuild(e) {
  if (e.kind !== 'word' && e.kind !== 'mark') return false;
  const clean = e.ar.replace(/[؟?!.،]/g, '').trim();
  if (/\s|\//.test(clean) || /\.\.\./.test(e.ar) || /\d|[٠-٩]/.test(clean)) return false;
  const g = graphemes(clean);
  return g.length >= 2 && g.length <= 8;
}
function distractorPool(e) {
  const same = (x) => x.kind === e.kind || (e.kind !== 'letter' && x.kind !== 'letter');
  const lessonPool = e.lesson.entries.filter((x) => x.id !== e.id && same(x));
  const unitPool = e.lesson.unit.lessons.flatMap((l) => l.entries).filter((x) => x.id !== e.id && same(x));
  const all = [...ENTRY.values()].filter((x) => x.id !== e.id && same(x));
  return [lessonPool, unitPool, all];
}
function choicesFor(e, field, n = 4) {
  const used = new Set([field(e)]);
  const out = [e];
  for (const pool of distractorPool(e)) {
    for (const x of shuffle(pool)) {
      if (out.length >= n) break;
      const v = field(x);
      if (!v || used.has(v)) continue;
      used.add(v); out.push(x);
    }
    if (out.length >= n) break;
  }
  return shuffle(out);
}
// ---- sentence building ----
const sentWords = (ar) => ar.replace(/[؟?!.،,…:]/g, ' ').split(/\s+/).filter(Boolean);
function canSentence(e) {
  if (e.kind !== 'word' && e.kind !== 'line') return false;
  if (/\/|\d|[٠-٩]/.test(e.ar)) return false;
  const n = sentWords(e.ar).length;
  return n >= 3 && n <= 9;
}
function sentencePool() {
  const reached = LESSONS.filter((l) => P.lessons[l.id]);
  let list = reached.flatMap((l) => l.entries).filter(canSentence);
  if (list.length < 5) list = LESSONS.flatMap((l) => l.entries).filter(canSentence);
  return list;
}

// ---- verb conjugation drills (paradigms from course.verbs, unlocked by course.tenses) ----
const PERSONS = [['אני', 'أنا'], ['אתה', 'إنتَ'], ['את', 'إنتِ'], ['הוא', 'هو'], ['היא', 'هي'], ['אנחנו', 'إحنا'], ['אתם', 'إنتو'], ['הם', 'هُمّ']];
// tenses taught up to a lesson, or (no lesson) in lessons the learner has opened
function tensesUpTo(lesson) {
  return (course.tenses || []).map((t) => ({ ...t, l: LESSONS.find((x) => x.id === t.lesson) }))
    .filter((t) => t.l && (lesson ? t.l.index <= lesson.index : P.lessons[t.l.id]));
}
function conjEntry(v, tense, p) {
  const [ar, tr] = v.forms[tense.id][p];
  const id = `V:${v.id}:${tense.id}:${p}`;
  const e = { id, kind: 'conj', ar, tr, he: `${PERSONS[p][0]} · ${v.he} · ${tense.title}`, verb: v, tense, p };
  EXTRA.set(id, e);
  return e;
}
function conjQuestions(tenses, n) {
  const qs = [];
  for (let i = 0; i < n; i++) {
    const tense = pick(tenses);
    const verbs = (course.verbs || []).filter((v) => v.forms[tense.id]);
    if (!verbs.length) break;
    const types = ['conjPick', 'conjPick', 'conjWho', tenses.length > 1 && 'conjTense'].filter(Boolean);
    qs.push({ e: conjEntry(pick(verbs), tense, Math.floor(Math.random() * PERSONS.length)), type: pick(types), tenses });
  }
  return qs;
}
// ---- adjective drills: masculine / feminine / plural (course.adjs) ----
const ADJ_FORM = ['זכר', 'נקבה', 'רבים'];
const ADJ_SUBJ = { 1: 0, 2: 1, 3: 0, 4: 1, 5: 2, 6: 2, 7: 2 }; // person index -> form (אני can be either, so it is skipped)
function adjEntry(a, p) {
  const f = ADJ_SUBJ[p];
  const [ar, tr] = a.forms[f];
  const id = `A:${a.id}:${p}`;
  const e = { id, kind: 'adj', ar, tr, he: `${PERSONS[p][0]} · ${a.he} (${ADJ_FORM[f]})`, adj: a, p, f };
  EXTRA.set(id, e);
  return e;
}
function adjQuestions(n, adjs = course.adjs || []) {
  const qs = [];
  const persons = Object.keys(ADJ_SUBJ).map(Number);
  for (let i = 0; i < n && adjs.length; i++) qs.push({ e: adjEntry(pick(adjs), pick(persons)), type: pick(['adjPick', 'adjPick', 'adjForm']) });
  return qs;
}
// adjectives whose forms appear in a lesson's words
function lessonAdjs(l) {
  const words = new Set(l.entries.flatMap((e) => sentWords(e.ar).map(normAr)));
  return (course.adjs || []).filter((a) => a.forms.some(([ar]) => words.has(normAr(ar))));
}

// ---- daily practice of mistakes: every wrong answer waits here until it is answered right in the daily drill ----
const mistakeList = () => Object.entries(P.mistakes || {}).sort((a, b) => a[1].d.localeCompare(b[1].d));
function addMistake(e) {
  if (!ENTRY.has(e.id) && e.kind !== 'conj' && e.kind !== 'adj') return;
  P.mistakes = P.mistakes || {};
  const m = P.mistakes[e.id];
  P.mistakes[e.id] = { d: m?.d || today(), n: (m?.n || 0) + 1 };
  saveP();
}
function clearMistake(id) { if (P.mistakes?.[id]) { delete P.mistakes[id]; saveP(); } }
function entryFromId(id) {
  if (ENTRY.has(id)) return ENTRY.get(id);
  if (id.startsWith('A:')) {
    const [, aid, ap] = id.split(':');
    const a = (course.adjs || []).find((x) => x.id === aid);
    return a && ADJ_SUBJ[ap] !== undefined ? adjEntry(a, +ap) : null;
  }
  const [, vid, tid, p] = id.split(':');
  const v = (course.verbs || []).find((x) => x.id === vid);
  const t = (course.tenses || []).find((x) => x.id === tid);
  return v && t && v.forms[tid] ? conjEntry(v, t, +p) : null;
}
function dailyQuestions() {
  return mistakeList().slice(0, 20).map(([id]) => entryFromId(id)).filter(Boolean)
    .map((e) => (e.kind === 'conj' ? { e, type: 'conjPick', tenses: (course.tenses || []).filter((t) => e.verb.forms[t.id]) } : e.kind === 'adj' ? { e, type: 'adjPick' } : makeQuestion(e)));
}

// ---- "which form fits the sentence?" (cloze): a verb or adjective in a sentence is blanked out ----
let CLOZE_WORDS = null; // normalized word -> how to inflect it
function clozeWords() {
  if (CLOZE_WORDS) return CLOZE_WORDS;
  CLOZE_WORDS = new Map();
  for (const v of course.verbs || []) for (const tid of Object.keys(v.forms)) {
    v.forms[tid].forEach(([ar], p) => { if (!ar.includes(' ') && !CLOZE_WORDS.has(normAr(ar))) CLOZE_WORDS.set(normAr(ar), { v, tid, p }); });
  }
  const bidd = ['بِدّي', 'بِدَّك', 'بِدِّك', 'بِدُّه', 'بِدّها', 'بِدّنا', 'بِدّكُم', 'بِدّهُم'];
  for (const b of bidd) CLOZE_WORDS.set(normAr(b), { list: bidd });
  for (const a of course.adjs || []) {
    const list = a.forms.map(([ar]) => ar);
    for (const w of list) if (!CLOZE_WORDS.has(normAr(w))) CLOZE_WORDS.set(normAr(w), { list });
  }
  for (const e of ENTRY.values()) {
    if (e.kind !== 'word' || /\s/.test(e.ar.trim()) || CLOZE_WORDS.has(normAr(e.ar))) continue;
    const w = stripHarakat(e.ar).replace(/[؟?!.،]/g, '');
    const elative = /^ا[^ا]{3}$/.test(normAr(w)); // أكبَر, أحلى... don't inflect
    if (['adj', 'feel'].includes(e.cat) && w.length >= 3 && !elative && !['كتير', 'شوي', 'شويه'].includes(normAr(w))) CLOZE_WORDS.set(normAr(w), { kind: 'adj' });
    else if (['verb', 'conj'].includes(e.cat) && /^ب/.test(w) && w.length >= 4 && !/אות|אתכם/.test(e.he)) CLOZE_WORDS.set(normAr(w), { kind: 'verb' }); // not verb+object (بَحِبَّك)
  }
  return CLOZE_WORDS;
}
// other gender/number/person forms of a word, built from its prefix and suffix
function inflections(word, kind) {
  const w = stripHarakat(word);
  const out = new Set();
  if (kind === 'verb') {
    const p = ['بي', 'بت', 'بن', 'ب'].find((x) => w.startsWith(x) && w.length - x.length >= 2);
    let stem = w.slice(p.length);
    const sf = ['ي', 'و'].find((x) => stem.endsWith(x) && stem.length >= 3) || '';
    stem = stem.slice(0, stem.length - sf.length);
    // verbs ending in a vowel (بَصحى, بَحكي) only change the prefix
    const forms = /[ىاي]$/.test(stem) ? [['ب', ''], ['بت', ''], ['بي', ''], ['بن', '']]
      : [['ب', ''], ['بت', ''], ['بت', 'ي'], ['بي', ''], ['بن', ''], ['بت', 'و'], ['بي', 'و']];
    for (const [a, b] of forms) out.add(a + stem + b);
  } else {
    const sf = ['ين', 'ات', 'ة', 'ه'].find((x) => w.endsWith(x) && w.length - x.length >= 2) || '';
    const stem = w.slice(0, w.length - sf.length);
    for (const b of ['', 'ة', 'ين', 'ات']) out.add(stem + b);
  }
  return [...out].filter((x) => normAr(x) !== normAr(w));
}
function clozeSlots(e) {
  if (e._cloze === undefined) {
    const idx = clozeWords();
    // past forms (نام, شاف...) look like other words, so only blank them in the past-tense unit
    const fits = (info) => !info || info.tid !== 'past' || LESSONS.find((l) => l.id === course.tenses.find((t) => t.id === 'past')?.lesson)?.unit === e.lesson.unit;
    e._cloze = canSentence(e) ? sentWords(e.ar).map((w, i) => (idx.has(normAr(w)) && fits(idx.get(normAr(w))) ? i : -1)).filter((i) => i >= 0) : [];
  }
  return e._cloze;
}
const canCloze = (e) => clozeSlots(e).length > 0;
function makeCloze(e) {
  const words = sentWords(e.ar);
  const i = pick(clozeSlots(e));
  const info = clozeWords().get(normAr(words[i]));
  let correct = words[i], others;
  if (info.v) {
    others = info.v.forms[info.tid].map((f) => f[0]);
  } else if (info.list) {
    others = info.list;
  } else {
    correct = stripHarakat(correct);
    others = inflections(correct, info.kind);
  }
  const options = [correct];
  for (const o of shuffle(others)) if (options.length < 4 && !options.some((x) => normAr(x) === normAr(o))) options.push(o);
  return { words, i, correct, options: shuffle(options) };
}
const LEVEL_TYPES = { easy: ['ar2he', 'listen', 'letterName'], mid: ['he2ar', 'listenAr', 'letterPick', 'letterForm', 'next'], build: ['build'] };
function questionTypes(e) {
  const tts = Speech.available();
  let types;
  if (e.kind === 'letter') types = letterForms(e.ar) ? ['letterName', 'letterPick', 'letterForm'] : ['letterName', 'letterPick'];
  else if (e.kind === 'line') types = ['ar2he', 'he2ar', 'next', tts && 'listen', canSentence(e) && 'sent', canCloze(e) && 'cloze'];
  else types = ['ar2he', 'he2ar', tts && 'listen', tts && 'listenAr', canBuild(e) && 'build', canSentence(e) && 'sent', canCloze(e) && 'cloze'];
  types = types.filter(Boolean);
  if (e.kind === 'line' && e.idx === 0) types = types.filter((t) => t !== 'next');
  return types;
}
// sentences to practise in a lesson: its own, else sentences elsewhere that use its words
function sentencesFor(l) {
  const own = l.entries.filter(canSentence);
  if (own.length >= 3) return own;
  const words = new Set(l.entries.filter((e) => e.kind === 'word').map((e) => normAr(e.ar)));
  const seenKeys = new Set(own.map((e) => e.id));
  const more = LESSONS.flatMap((x) => x.entries).filter((x) => !seenKeys.has(x.id) && canSentence(x) && sentWords(x.ar).some((w) => words.has(normAr(w))) && seenKeys.add(x.id));
  const unit = l.unit.lessons.flatMap((x) => x.entries).filter((x) => !seenKeys.has(x.id) && canSentence(x));
  return [...own, ...shuffle(more), ...shuffle(unit)].slice(0, 12);
}
// the full lesson quiz goes from easy to hard: recognise → recall → spell → conjugate → fill the form → build → write a sentence
function lessonQuiz(l) {
  const weak = (x) => (P.items[x.id]?.b ?? 0);
  const E = shuffle(l.entries).sort((a, b) => weak(a) - weak(b));
  const stage = (level, k) => {
    const out = [];
    for (const e of [...E, ...shuffle(E)]) {
      if (out.length >= k) break;
      const t = questionTypes(e).filter((x) => LEVEL_TYPES[level].includes(x));
      if (t.length) out.push({ e, type: pick(t) });
    }
    return out;
  };
  const S = sentencesFor(l);
  const cloze = shuffle(S.filter(canCloze)).slice(0, 2).map((e) => ({ e, type: 'cloze' }));
  const sent = shuffle(S).slice(0, 2).map((e) => ({ e, type: 'sent' }));
  const short = S.filter((e) => sentWords(e.ar).length <= 5);
  const write = (short.length ? [pick(short)] : S.slice(0, 1)).map((e) => ({ e, type: 'type' }));
  const tenses = l.cat === 'conj' ? tensesUpTo(l) : [];
  const conj = tenses.length ? conjQuestions(tenses, 3).sort((a, b) => (a.type === 'conjPick') - (b.type === 'conjPick')) : [];
  const adjs = ['adj', 'feel'].includes(l.cat) ? course.adjs || [] : lessonAdjs(l);
  conj.push(...adjQuestions(adjs.length ? (['adj', 'feel'].includes(l.cat) ? 3 : 2) : 0, adjs));
  const build = stage('build', 2);
  const rest = cloze.length + sent.length + write.length + conj.length + build.length;
  const fill = Math.max(0, 12 - rest - 8);
  return [...stage('easy', 4 + Math.ceil(fill / 2)), ...stage('mid', 4 + Math.floor(fill / 2)), ...build, ...conj, ...cloze, ...sent, ...write];
}

function makeQuestion(e, mode) {
  const tts = Speech.available();
  let types = questionTypes(e);
  if (mode === 'build') types = canBuild(e) ? ['build'] : ['he2ar'];
  if (mode === 'sent') types = canSentence(e) ? ['sent', 'sent', canCloze(e) && 'cloze'].filter(Boolean) : ['he2ar'];
  if (mode === 'write') types = canSentence(e) ? ['type'] : ['he2ar'];
  if (mode === 'listen') types = tts ? (e.kind === 'letter' ? ['letterPick'] : ['listen', 'listenAr']) : ['ar2he'];
  return { e, type: pick(types) };
}
function buildQuiz(entries, n, mode) {
  let list = mode === 'build' ? entries.filter(canBuild) : mode === 'sent' || mode === 'write' ? entries.filter(canSentence) : entries.slice();
  if (!list.length) list = entries.slice();
  // prioritise entries that are new or weak
  const weight = (x) => (P.items[x.id]?.b ?? 0);
  let order = shuffle(list).sort((a, b) => weight(a) - weight(b));
  const qs = [];
  while (qs.length < n && order.length) {
    qs.push(...order.slice(0, n - qs.length).map((x) => makeQuestion(x, mode)));
    order = shuffle(list);
  }
  return shuffle(qs);
}

function viewQuiz(id, mode) {
  let entries = [], title, back, n = 12, lesson = null, extra = [], ordered = null;
  if (id === 'conj' && !mode) return viewConjPicker();
  if (id === 'daily') {
    extra = dailyQuestions(); n = 0; title = 'תרגול טעויות יומי'; back = '#/review';
  } else if (id === 'conj') {
    const upTo = mode.startsWith('t:') ? null : LESSONS.find((x) => x.id === mode);
    const ids = mode.slice(2).split(',');
    const tenses = upTo ? tensesUpTo(upTo) : (course.tenses || []).filter((t) => ids.includes(t.id));
    const withAdj = !upTo && ids.includes('adj') && (course.adjs || []).length;
    setHeader('תרגול הטיות', upTo ? `#/lesson/${upTo.id}` : '#/review'); setTab(upTo ? 'home' : 'review');
    if (!tenses.length && !withAdj) {
      const first = LESSONS.find((l) => l.id === course.tenses?.[0]?.lesson);
      $app.innerHTML = `<div class="empty">תרגול ההטיות נפתח כשמגיעים לשיעור על נטיית הפועל בהווה.${first ? `<br><br><a class="btn" href="#/lesson/${first.id}">לשיעור: ${esc(first.title)}</a>` : ''}</div>`;
      return;
    }
    title = 'תרגול הטיות'; back = upTo ? `#/lesson/${upTo.id}` : '#/quiz/conj';
    const nAdj = withAdj ? (tenses.length ? 4 : 12) : 0;
    extra = [...(tenses.length ? conjQuestions(tenses, 12 - nAdj) : []), ...(nAdj ? adjQuestions(nAdj) : [])]; n = 0;
  } else if (id === 'sent') {
    entries = sentencePool(); title = 'בניית משפטים'; back = '#/review'; n = 10; mode = 'sent';
  } else if (id === 'review') {
    entries = dueEntries();
    title = 'חזרה'; back = '#/review';
    if (mode === 'hard') entries = [...ENTRY.values()].filter((e) => status(e.id) === 'hard');
    if (mode === 'mix') entries = shuffle([...ENTRY.values()].filter((e) => P.items[e.id])).slice(0, 40);
    entries = entries.slice(0, 15); n = Math.min(15, Math.max(entries.length, 1));
  } else if (id === 'dict') {
    const cat = (course.categories || []).find((c) => c.id === mode);
    if (!cat) return viewDict();
    entries = dictEntries(cat.id); title = 'תרגול: ' + cat.title; back = `#/dict/${cat.id}`;
    n = Math.min(15, Math.max(8, entries.length)); mode = null;
  } else {
    lesson = LESSONS.find((x) => x.id === id);
    if (!lesson) return viewHome();
    entries = lesson.entries; title = 'תרגול: ' + lesson.title; back = `#/lesson/${id}`;
    n = Math.min(14, Math.max(8, Math.round(entries.length * 1.2)));
    P.lessons[lesson.id] = P.lessons[lesson.id] || { best: 0 }; saveP();
    if (!mode) ordered = lessonQuiz(lesson);
    else if (mode === 'sent' || mode === 'write') entries = sentencesFor(lesson);
  }
  setHeader(title, back); setTab(['review', 'sent', 'daily'].includes(id) || (id === 'conj' && mode.startsWith('t:')) ? 'review' : id === 'dict' ? 'dict' : 'home');
  if (!entries.length && !extra.length) {
    $app.innerHTML = `<div class="empty">${id === 'daily' ? '🎉 אין טעויות שמחכות לתרגול. כל הכבוד!' : 'אין מה לתרגל כאן כרגע.'}</div>`;
    return;
  }
  const qs = ordered || shuffle([...(entries.length && n ? buildQuiz(entries, n, mode === 'hard' || mode === 'mix' ? null : mode) : []), ...extra]);
  let qi = 0, correct = 0;
  const mistakes = [];
  const next = () => {
    if (qi >= qs.length) return finish();
    renderQuestion(qs[qi], qi, qs.length, (ok) => {
      const e = qs[qi].e;
      if (ok) { correct++; if (id === 'daily') clearMistake(e.id); } else { mistakes.push(e); addMistake(e); }
      qi++;
    }, next);
  };
  const finish = () => {
    const pct = Math.round((correct / qs.length) * 100);
    if (lesson) {
      const rec = P.lessons[lesson.id];
      rec.best = Math.max(rec.best || 0, pct); rec.at = now(); saveP();
    }
    const nextL = lesson && pct >= 70 ? LESSONS[lesson.index + 1] : null;
    const uniqueMistakes = [...new Map(mistakes.map((m) => [m.id, m])).values()];
    $app.innerHTML = `<div class="card center"><div class="celebrate">${pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : '💪'}</div>
      <h2>${pct}% נכון (${correct}/${qs.length})</h2>
      <p class="muted">${pct >= 70 ? (lesson ? 'השיעור עבר! המילים נכנסו לחזרות.' : 'כל הכבוד!') : 'כדאי לתרגל שוב, זה מתקבע עם חזרות.'}</p>
      ${id === 'daily' ? `<p class="small">${mistakeList().length ? `נשארו ${mistakeList().length} לתרגל. הן יחכו לך גם מחר.` : 'סיימת את כל הטעויות 🎉'}</p>` : mistakes.length ? '<p class="small muted">הטעויות נשמרו לתרגול היומי (בכרטיסיית "חזרה").</p>' : ''}</div>
      ${uniqueMistakes.length ? `<div class="card"><h3>לחזור על אלה</h3>${uniqueMistakes.map((e) => entryRow(e)).join('')}</div>` : ''}
      <div class="btns">
        <button class="btn secondary" id="again">🔁 שוב</button>
        ${nextL ? `<a class="btn" href="#/lesson/${nextL.id}">לשיעור הבא ←</a>` : `<a class="btn" href="#/">לשיעורים</a>`}
      </div>`;
    bindPlay();
    document.getElementById('again').onclick = () => viewQuiz(id, mode);
  };
  next();
}

function viewConjPicker() {
  setHeader('תרגול הטיות', '#/review'); setTab('review');
  const all = [...(course.tenses || []), ...((course.adjs || []).length ? [{ id: 'adj', title: 'תארים: זכר / נקבה / רבים' }] : [])];
  const learned = tensesUpTo().map((t) => t.id);
  let chosen = new Set(store.get('lingo:conjTenses', null) || [...learned, ...all.filter((t) => t.id === 'adj').map((t) => t.id)]);
  const render = () => {
    $app.innerHTML = `<div class="card"><h3>מה לתרגל?</h3>
      <p class="small muted">מסומנים הזמנים מהשיעורים שכבר פתחת. אפשר לבחור כל שילוב.</p>
      ${all.map((t) => `<label class="field"><span>${esc(t.title)}${learned.includes(t.id) || t.id === 'adj' ? '' : ' <span class="muted small">(עוד לא נלמד)</span>'}</span>
        <input type="checkbox" class="switch" data-t="${t.id}" ${chosen.has(t.id) ? 'checked' : ''}></label>`).join('')}
      <button class="btn block" id="go" style="margin-top:12px" ${chosen.size ? '' : 'disabled'}>▶ להתחיל</button></div>`;
    $app.querySelectorAll('[data-t]').forEach((c) => (c.onchange = () => {
      if (c.checked) chosen.add(c.dataset.t); else chosen.delete(c.dataset.t);
      store.set('lingo:conjTenses', [...chosen]); render();
    }));
    document.getElementById('go').onclick = () => { location.hash = '#/quiz/conj/t:' + [...chosen].join(','); };
  };
  render();
}

function renderQuestion(q, qi, total, record, next) {
  const { e, type } = q;
  const top = `<div class="quiz-top"><span class="small muted">${qi + 1}/${total}</span><div class="bar"><i style="width:${(qi / total) * 100}%"></i></div></div>`;
  let prompt = '', choices = [], choiceAr = false, label, autoplay = false, isRight = (c) => c === e;
  const forms = letterForms(e.ar);
  switch (type) {
    case 'ar2he':
      prompt = `<div class="q">מה הפירוש?</div><div class="big-ar">${arSpan(e.ar)}</div>${playBtn(e.id)}${trLine(e)}`;
      label = (x) => x.he; choices = choicesFor(e, label); autoplay = true; break;
    case 'he2ar':
      prompt = `<div class="q">איך אומרים בערבית?</div><div class="he-big">${esc(e.he)}</div>`;
      label = (x) => x.ar; choices = choicesFor(e, label); choiceAr = true; break;
    case 'read':
      prompt = `<div class="q">קריאה: איך קוראים את זה?</div><div class="big-ar">${arSpan(e.ar)}</div>`;
      label = (x) => x.tr; choices = choicesFor(e, label); break;
    case 'listen':
      prompt = `<div class="q">הקשב/י – מה שמעת?</div>${playBtn(e.id, 'lg')}${revealSaid(`${arSpan(e.ar, 'mid-ar')}${e.tr ? `<div class="tr">${esc(e.tr)}</div>` : ''}`)}`;
      label = (x) => x.he; choices = choicesFor(e, label); autoplay = true; break;
    case 'listenAr':
      prompt = `<div class="q">הקשב/י – איזו מילה שמעת?</div>${playBtn(e.id, 'lg')}${revealSaid(e.tr ? `<div class="tr" style="font-size:20px">${esc(e.tr)}</div>` : '')}`;
      label = (x) => x.ar; choices = choicesFor(e, label); choiceAr = true; autoplay = true; break;
    case 'next': {
      const prev = e.lesson.lines[e.idx - 1];
      prompt = `<div class="q">${esc(prev.who)} אומר/ת:</div><div class="mid-ar">${arSpan(prev.ar)}</div><div class="muted small">${esc(prev.he)}</div><div class="q" style="margin-top:10px">מה ${esc(e.who)} עונה?</div>`;
      label = (x) => x.ar; choices = choicesFor(e, label, 3); choiceAr = true; break;
    }
    case 'letterName': {
      const shown = forms ? pick(Object.values(forms)) : e.ar;
      prompt = `<div class="q">איזו אות זאת?</div><div class="big-ar" style="font-size:80px">${arSpan(shown)}</div>`;
      label = (x) => `${x.tr} – ${x.he}`; choices = choicesFor(e, label); break;
    }
    case 'letterPick':
      prompt = `<div class="q">מצא/י את האות</div><div class="he-big">${esc(e.tr)}</div><div class="muted">${esc(e.he)}</div>${playBtn(e.id)}`;
      label = (x) => x.ar; choices = choicesFor(e, label); choiceAr = true; autoplay = true; break;
    case 'letterForm': {
      const kind = pick(['initial', 'medial', 'final'].filter((k) => forms[k] !== forms.isolated));
      const names = { initial: 'בתחילת מילה', medial: 'באמצע מילה', final: 'בסוף מילה' };
      prompt = `<div class="q">הצורה ${names[kind] || ''} – של איזו אות?</div><div class="big-ar" style="font-size:80px">${arSpan(forms[kind] || e.ar)}</div>`;
      label = (x) => x.ar; choices = choicesFor(e, label); choiceAr = true; break;
    }
    case 'conjPick': {
      const forms = e.verb.forms[e.tense.id];
      const pool = shuffle(forms.map((_, p) => conjEntry(e.verb, e.tense, p)));
      const other = q.tenses.filter((t) => t.id !== e.tense.id && e.verb.forms[t.id]);
      if (other.length) pool.splice(1, 0, conjEntry(e.verb, pick(other), e.p));
      choices = [e];
      for (const x of pool) if (choices.length < 4 && !choices.some((c) => c.ar === x.ar)) choices.push(x);
      choices = shuffle(choices);
      prompt = `<div class="q">בחר/י את הצורה הנכונה</div><div class="he-big">${esc(PERSONS[e.p][0])} ${arSpan(PERSONS[e.p][1])}</div>
        <div>${esc(e.verb.he)} · <b>${esc(e.tense.title)}</b></div>${hintTr(e.tr)}`;
      label = (x) => x.ar; choiceAr = true; break;
    }
    case 'conjWho': {
      const forms = e.verb.forms[e.tense.id];
      const others = shuffle(PERSONS.map((_, p) => p).filter((p) => forms[p][0] !== e.ar)).slice(0, 3);
      choices = shuffle([e.p, ...others].map((p) => ({ p })));
      prompt = `<div class="q">מי עושה את זה?</div><div class="big-ar">${arSpan(e.ar)}</div>${playBtn(e.id)}<div class="muted small">${esc(e.verb.he)} · ${esc(e.tense.title)}</div>`;
      label = (c) => `${PERSONS[c.p][0]} (${PERSONS[c.p][1]})`; isRight = (c) => forms[c.p][0] === e.ar; autoplay = true; break;
    }
    case 'conjTense': {
      choices = shuffle([e.tense, ...shuffle(q.tenses.filter((t) => t.id !== e.tense.id)).slice(0, 3)]);
      prompt = `<div class="q">באיזה זמן?</div><div class="big-ar">${arSpan(e.ar)}</div>${playBtn(e.id)}<div class="muted small">${esc(PERSONS[e.p][0])} · ${esc(e.verb.he)}</div>`;
      label = (t) => t.title; isRight = (t) => t.id === e.tense.id; autoplay = true; break;
    }
    case 'adjPick': {
      choices = shuffle(e.adj.forms.map(([ar], f) => ({ ar, f })));
      prompt = `<div class="q">בחר/י את הצורה הנכונה של התואר</div><div class="he-big">${esc(PERSONS[e.p][0])} ${arSpan(PERSONS[e.p][1])}</div>
        <div><b>${esc(e.adj.he)}</b></div>${hintTr(e.tr)}`;
      label = (c) => c.ar; choiceAr = true; isRight = (c) => c.ar === e.ar; break;
    }
    case 'adjForm': {
      choices = ADJ_FORM.map((t, f) => ({ t, f })).filter((c) => c.f === e.f || e.adj.forms[c.f][0] !== e.ar);
      prompt = `<div class="q">זכר, נקבה או רבים?</div><div class="big-ar">${arSpan(e.ar)}</div>${playBtn(e.id)}<div class="muted small">${esc(e.adj.he)}</div>`;
      label = (c) => c.t; isRight = (c) => c.f === e.f; autoplay = true; break;
    }
    case 'cloze': {
      const c = q.cloze || (q.cloze = makeCloze(e));
      const shown = c.words.map((w, i) => (i === c.i ? '<span class="blank">______</span>' : esc(arText(w)))).join(' ');
      prompt = `<div class="q">איזו צורה מתאימה למשפט?</div><div style="font-size:19px;font-weight:600">${esc(e.he)}</div>
        <div class="mid-ar ar" lang="ar" style="margin-top:6px">${shown}</div>`;
      choices = c.options; label = (x) => x; choiceAr = true; isRight = (x) => x === c.correct; break;
    }
    case 'type': return renderType(q, top, record, next);
    case 'build': return renderBuild(q, top, record, next);
    case 'sent': return renderSentence(q, top, record, next);
  }
  $app.innerHTML = `${top}<div class="card"><div class="prompt">${prompt}</div>
    <div class="choices">${choices.map((c, i) => `<button class="choice ${choiceAr ? 'ar' : ''}" data-i="${i}" ${choiceAr ? 'lang="ar"' : ''}>${esc(choiceAr ? arText(label(c)) : label(c))}</button>`).join('')}</div>
    <div id="fb"></div></div>`;
  bindPlay();
  if (autoplay && settings.autoplay) Speech.later(spokenText(e), 200); else Speech.stop();
  const buttons = [...$app.querySelectorAll('.choice')];
  buttons.forEach((b) => (b.onclick = () => {
    const ok = isRight(choices[+b.dataset.i]);
    buttons.forEach((x) => { x.disabled = true; if (isRight(choices[+x.dataset.i])) x.classList.add('correct'); });
    if (!ok) b.classList.add('wrong');
    if (ENTRY.has(e.id)) grade(e.id, ok);
    record(ok);
    showFeedback(e, ok, next, !['ar2he', 'listen', 'letterPick', 'listenAr', 'conjWho', 'conjTense', 'adjForm'].includes(type));
  }));
}
// after a wrong conjugation answer: the whole tense of that verb, the asked person highlighted
function conjFeedbackTable(e) {
  const forms = e.verb.forms[e.tense.id];
  return `<div style="margin-top:10px"><div class="small"><b>${esc(e.verb.he)} · ${esc(e.tense.title)}</b></div>
    <table class="grid conj-table">${PERSONS.map((p, i) => `<tr class="${forms[i][0] === e.ar ? 'hl' : ''}"><td>${esc(p[0])} ${arSpan(p[1])}</td>
      <td data-play="${esc(forms[i][0])}">${arSpan(forms[i][0])}</td><td class="tr small">${esc(forms[i][1])}</td></tr>`).join('')}</table></div>`;
}
function adjFeedbackTable(e) {
  return `<div style="margin-top:10px"><div class="small"><b>${esc(e.adj.he)}</b></div>
    <table class="grid conj-table">${e.adj.forms.map(([ar, tr], f) => `<tr class="${f === e.f ? 'hl' : ''}"><td>${ADJ_FORM[f]}</td>
      <td data-play="${esc(ar)}">${arSpan(ar)}</td><td class="tr small">${esc(tr)}</td></tr>`).join('')}</table></div>`;
}
function showFeedback(e, ok, next, speakNow) {
  const fb = document.getElementById('fb');
  // "continue" sits above the explanation so it is reachable without scrolling
  fb.innerHTML = `<button class="btn block" style="margin-top:14px" id="nextQ">המשך ←</button>
    <div class="feedback ${ok ? 'good' : 'bad'}" style="margin-top:10px">
    <div class="row"><b class="grow">${ok ? '✓ נכון!' : '✗ לא בדיוק'}</b>${playBtn(e.id)}</div>
    <div>${arSpan(e.ar, 'mid-ar')}</div>${e.tr ? `<div class="tr">${esc(e.tr)}</div>` : ''}<div>${esc(e.he)}</div>
    ${!ok && e.kind === 'conj' ? conjFeedbackTable(e) : ''}${!ok && e.kind === 'adj' ? adjFeedbackTable(e) : ''}
    ${e.kind !== 'letter' ? `<div style="margin-top:6px">${explainBtn(e)}</div>` : ''}</div>`;
  bindPlay(fb);
  if (settings.autoplay && (speakNow || !ok)) speakEntry(e);
  const btn = document.getElementById('nextQ');
  btn.focus({ preventScroll: true });
  btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
  btn.onclick = () => { Speech.stop(); next(); };
}
function renderBuild(q, top, record, next) {
  const { e } = q;
  const target = graphemes(e.ar.replace(/[؟?!.،]/g, '').trim());
  const letters = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
  const extra = shuffle([...letters].filter((c) => !target.some((t) => t.startsWith(c)))).slice(0, Math.min(3, Math.max(1, 9 - target.length)));
  const tiles = shuffle([...target, ...extra].map((t, i) => ({ t, i })));
  const chosen = [];
  $app.innerHTML = `${top}<div class="card"><div class="prompt"><div class="q">כתוב/י בערבית (לחץ על האותיות לפי הסדר)</div>
    <div class="he-big">${esc(e.he)}</div>${hintTr(e.tr)}</div>
    <div class="build-answer ar" id="ans" lang="ar">&nbsp;</div>
    <div class="tiles">${tiles.map((x, k) => `<button class="tile ar" data-k="${k}" lang="ar">${esc(arText(x.t))}</button>`).join('')}</div>
    <div class="btns" style="margin-top:12px"><button class="btn ghost" id="undo">⌫ מחק</button><button class="btn" id="check" disabled>בדיקה</button></div>
    <div id="fb"></div></div>`;
  bindPlay();
  const ans = document.getElementById('ans');
  const checkBtn = document.getElementById('check');
  const refresh = () => {
    ans.textContent = chosen.length ? arText(chosen.map((k) => tiles[k].t).join('')) : ' ';
    $app.querySelectorAll('.tile').forEach((b) => b.classList.toggle('used', chosen.includes(+b.dataset.k)));
    checkBtn.disabled = !chosen.length;
  };
  $app.querySelectorAll('.tile').forEach((b) => (b.onclick = () => { if (!chosen.includes(+b.dataset.k)) { chosen.push(+b.dataset.k); refresh(); } }));
  document.getElementById('undo').onclick = () => { chosen.pop(); refresh(); };
  checkBtn.onclick = () => {
    const ok = normAr(chosen.map((k) => tiles[k].t).join('')) === normAr(target.join(''));
    $app.querySelectorAll('.tile, #undo, #check').forEach((b) => (b.disabled = true));
    ans.style.borderColor = ok ? 'var(--good)' : 'var(--bad)';
    if (ENTRY.has(e.id)) grade(e.id, ok);
    record(ok);
    showFeedback(e, ok, next, true);
  };
}

// hardest step: write the whole sentence (Arabic keyboard); small typos are forgiven
function renderType(q, top, record, next) {
  const { e } = q;
  $app.innerHTML = `${top}<div class="card"><div class="prompt"><div class="q">כתוב/י את המשפט בערבית</div>
    <div class="he-big">${esc(e.he)}</div>${hintTr(e.tr)}</div>
    <textarea id="typed" class="ar type-box" lang="ar" dir="rtl" rows="2" placeholder="اكتب هنا..." autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
    <p class="small muted" style="margin:4px 0 10px">צריך מקלדת ערבית בטלפון (הגדרות ← מקלדת ← הוספת מקלדת ← ערבית). אין צורך בניקוד.</p>
    <button class="btn block" id="check" disabled>בדיקה</button>
    <div id="fb"></div></div>`;
  const box = document.getElementById('typed');
  const checkBtn = document.getElementById('check');
  box.oninput = () => (checkBtn.disabled = !box.value.trim());
  checkBtn.onclick = () => {
    const said = box.value.trim();
    const score = similarity(said, e.ar);
    const ok = score >= 0.85;
    box.disabled = true; checkBtn.disabled = true;
    box.style.borderColor = ok ? 'var(--good)' : 'var(--bad)';
    if (ENTRY.has(e.id)) grade(e.id, ok);
    record(ok);
    showFeedback(e, ok, next, true);
    if (score < 1) document.querySelector('#fb .feedback').insertAdjacentHTML('afterbegin',
      `<div class="small" style="margin-bottom:6px">${ok ? 'כמעט מושלם' : 'כתבת'}: <span class="ar">${esc(said)}</span> (${Math.round(score * 100)}% התאמה)</div>`);
  };
}
function renderSentence(q, top, record, next) {
  const { e } = q;
  const target = sentWords(e.ar);
  const tset = new Set(target.map(normAr));
  const want = target.length <= 5 ? 3 : 2;
  const extras = [];
  for (const pool of distractorPool(e)) {
    for (const x of shuffle(pool)) {
      if (extras.length >= want) break;
      if (x.kind !== 'word' && x.kind !== 'line') continue;
      const w = pick(sentWords(x.ar));
      if (w && !tset.has(normAr(w)) && !extras.some((y) => normAr(y) === normAr(w))) extras.push(w);
    }
    if (extras.length >= want) break;
  }
  const tiles = shuffle([...target, ...extras]);
  const chosen = [];
  $app.innerHTML = `${top}<div class="card"><div class="prompt"><div class="q">בנה/י את המשפט בערבית (לחץ על המילים לפי הסדר)</div>
    <div class="he-big">${esc(e.he)}</div>${hintTr(e.tr)}</div>
    <div class="sent-answer" id="ans"></div>
    <div class="tiles">${tiles.map((t, k) => `<button class="tile word-tile ar" data-k="${k}" lang="ar">${esc(arText(t))}</button>`).join('')}</div>
    <div class="btns" style="margin-top:12px"><button class="btn ghost" id="undo">⌫ מחק</button><button class="btn" id="check" disabled>בדיקה</button></div>
    <div id="fb"></div></div>`;
  const ans = document.getElementById('ans');
  const checkBtn = document.getElementById('check');
  let done = false;
  const refresh = () => {
    ans.innerHTML = chosen.map((k, i) => `<button class="tile word-tile ar" data-i="${i}" lang="ar">${esc(arText(tiles[k]))}</button>`).join('');
    ans.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { if (!done) { chosen.splice(+b.dataset.i, 1); refresh(); } }));
    $app.querySelectorAll('.tiles .tile').forEach((b) => b.classList.toggle('used', chosen.includes(+b.dataset.k)));
    checkBtn.disabled = !chosen.length;
  };
  $app.querySelectorAll('.tiles .tile').forEach((b) => (b.onclick = () => { if (!chosen.includes(+b.dataset.k)) { chosen.push(+b.dataset.k); refresh(); } }));
  document.getElementById('undo').onclick = () => { chosen.pop(); refresh(); };
  checkBtn.onclick = () => {
    const ok = normAr(chosen.map((k) => tiles[k]).join(' ')) === normAr(target.join(' '));
    done = true;
    $app.querySelectorAll('.tile, #undo, #check').forEach((b) => (b.disabled = true));
    ans.style.borderColor = ok ? 'var(--good)' : 'var(--bad)';
    if (ENTRY.has(e.id)) grade(e.id, ok);
    record(ok);
    showFeedback(e, ok, next, true);
  };
  refresh();
}

// ---------- review ----------
function viewReview() {
  setHeader('חזרה', null); setTab('review');
  const due = dueEntries();
  const hard = [...ENTRY.values()].filter((e) => status(e.id) === 'hard');
  const seen = [...ENTRY.values()].filter((e) => P.items[e.id]);
  const nextDue = Math.min(...seen.map((e) => P.items[e.id].d).filter((d) => d > now()));
  const tenses = tensesUpTo();
  const ml = mistakeList();
  const fromToday = ml.filter(([, m]) => m.d === today()).length;
  const when = isFinite(nextDue) ? new Date(nextDue).toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  $app.innerHTML = `<div class="card center">
      <div class="celebrate">${due.length ? '🔁' : '✅'}</div>
      <h2>${due.length ? `${due.length} פריטים מחכים לחזרה` : 'אין חזרות כרגע'}</h2>
      <p class="muted small">האפליקציה זוכרת כל מילה: מה שאתה יודע חוזר לעתים רחוקות, ומה שקשה לך חוזר מהר.${!due.length && when ? `<br>החזרה הבאה: ${esc(when)}` : ''}</p>
      ${due.length ? `<a class="btn block" href="#/quiz/review">▶ להתחיל חזרה</a>` : ''}
    </div>
    <div class="btns">
      <a class="btn secondary ${hard.length ? '' : 'disabled'}" href="${hard.length ? '#/quiz/review/hard' : '#/review'}">😬 המילים הקשות (${hard.length})</a>
      <a class="btn secondary" href="${seen.length ? '#/quiz/review/mix' : '#/review'}">🎲 תרגול מעורב (${seen.length})</a>
    </div>
    <div class="card" style="margin-top:12px"><h3>📅 סיכום יום: תרגול הטעויות</h3>
      <p class="small muted" style="margin:0 0 8px">${ml.length ? `${ml.length} טעויות מחכות (${fromToday} מהיום${ml.length - fromToday ? `, ${ml.length - fromToday} מימים קודמים` : ''}). מה שלא תתרגל עובר למחר, וכל טעות יורדת מהרשימה כשעונים עליה נכון.` : 'אין טעויות שמחכות 🎉 כל טעות בתרגולים תופיע כאן.'}</p>
      ${ml.length ? `<a class="btn block" href="#/quiz/daily">▶ לתרגל את הטעויות (${Math.min(20, ml.length)})</a>` : ''}
    </div>
    <div class="card"><h3>תרגולים נוספים</h3>
      <p class="small muted" style="margin:0 0 8px">${tenses.length ? `הטיות לפי מה שלמדת: ${tenses.map((t) => esc(t.title)).join(', ')}. אפשר לבחור גם זמנים אחרים.` : 'אפשר לבחור אילו זמנים לתרגל.'}</p>
      <div class="btns"><a class="btn secondary" href="#/quiz/conj">🔁 הטיות פעלים ותארים</a><a class="btn secondary" href="#/quiz/sent">🧩 בניית משפטים</a></div>
    </div>
    ${!seen.length ? `<div class="empty">עוד לא למדת מילים. התחל מהשיעור הראשון 🙂<br><br><a class="btn" href="#/">לשיעורים</a></div>` : ''}`;
}

// ---------- my words ----------
function viewWords() {
  setHeader('המילים שלי', null); setTab('words');
  let filter = store.get('lingo:wordsFilter', 'hard');
  let q = '';
  const render = () => {
    const all = [...ENTRY.values()].filter((e) => e.kind !== 'line');
    const counts = { hard: 0, learning: 0, known: 0, all: all.length };
    all.forEach((e) => { const s = status(e.id); if (counts[s] !== undefined) counts[s]++; });
    let list = filter === 'all' ? all : all.filter((e) => status(e.id) === filter);
    if (q) { const nq = normAr(q); list = list.filter((e) => e.he.includes(q) || e.tr.includes(q) || (nq && normAr(e.ar).includes(nq))); }
    const seg = (k, t) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${t} (${counts[k]})</button>`;
    $app.innerHTML = `<div class="seg">${seg('hard', '😬 לא יודע')}${seg('learning', '📚 בלמידה')}${seg('known', '✅ יודע')}${seg('all', 'הכל')}</div>
      <input type="search" id="q" placeholder="חיפוש בעברית או בערבית" value="${esc(q)}">
      ${list.length ? `<div class="card">${list.slice(0, 300).map((e) => `${entryRow(e)}
        <div class="btns small" style="margin:-4px 0 8px">${status(e.id) === 'known'
          ? `<button class="btn ghost" style="min-height:34px;padding:4px 10px" data-unknown="${esc(e.id)}">↺ עוד לא יודע</button>`
          : `<button class="btn ghost" style="min-height:34px;padding:4px 10px" data-known="${esc(e.id)}">✓ אני יודע</button>`}</div>`).join('')}</div>`
        : `<div class="empty">${filter === 'hard' ? 'אין מילים קשות כרגע 🎉' : 'אין כאן מילים עדיין.'}</div>`}
      ${filter === 'hard' && counts.hard ? `<a class="btn block" href="#/quiz/review/hard">לתרגל את המילים הקשות</a>` : ''}`;
    bindPlay();
    $app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; store.set('lingo:wordsFilter', filter); render(); }));
    $app.querySelectorAll('[data-known]').forEach((b) => (b.onclick = () => { markKnown(b.dataset.known, true); render(); }));
    $app.querySelectorAll('[data-unknown]').forEach((b) => (b.onclick = () => { markKnown(b.dataset.unknown, false); P.items[b.dataset.unknown].w++; saveP(); render(); }));
    const input = document.getElementById('q');
    input.oninput = () => { q = input.value.trim(); const pos = input.selectionStart; render(); const i2 = document.getElementById('q'); i2.focus(); i2.setSelectionRange(pos, pos); };
  };
  render();
}

// ---------- dictionary by topic ----------
function dictEntries(catId) {
  const seenKeys = new Set();
  return [...ENTRY.values()].filter((e) => {
    if (e.kind !== 'word' || (catId && e.cat !== catId)) return false;
    const k = normAr(e.ar) + '|' + e.he;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k); return true;
  });
}
function viewDict(catId) {
  setTab('dict');
  const cats = course.categories || [];
  const cat = cats.find((c) => c.id === catId);
  if (cat) {
    setHeader(`${cat.icon} ${cat.title}`, '#/dict');
    const list = dictEntries(cat.id);
    const tables = LESSONS.filter((l) => l.cat === cat.id && l.table);
    $app.innerHTML = `${tables.map((l) => `<details class="card" open><summary><b>${esc(l.title)}</b></summary><div style="margin-top:10px">${renderTable(l.table)}</div></details>`).join('')}
      <a class="btn block" style="margin-bottom:12px" href="#/quiz/dict/${cat.id}">✏️ לתרגל את הנושא (${list.length} מילים)</a>
      ${cat.id === 'conj' ? `<a class="btn secondary block" style="margin-bottom:12px" href="#/quiz/conj">🔁 תרגול בחירת הטיה נכונה</a>` : ''}
      ${['adj', 'feel'].includes(cat.id) && (course.adjs || []).length ? `<a class="btn secondary block" style="margin-bottom:12px" href="#/quiz/conj/t:adj">🔁 תרגול תארים: זכר/נקבה/רבים</a>` : ''}
      <div class="card">${list.map((e) => entryRow(e)).join('')}</div>`;
    bindPlay();
    return;
  }
  setHeader('מילון', null);
  let q = '';
  const render = () => {
    let body;
    if (q) {
      const nq = normAr(q);
      const hits = dictEntries().filter((e) => e.he.includes(q) || e.tr.includes(q) || (nq && normAr(e.ar).includes(nq))).slice(0, 200);
      const catOf = Object.fromEntries(cats.map((c) => [c.id, c]));
      body = hits.length ? `<div class="card">${hits.map((e) => entryRow(e).replace('<div class="grow">', `<div class="grow"><div><span class="tag">${esc(catOf[e.cat]?.icon || '')} ${esc(catOf[e.cat]?.title || '')}</span></div>`)).join('')}</div>`
        : '<div class="empty">לא נמצא. נסה מילה אחרת.</div>';
    } else {
      body = `<div class="cats">${cats.map((c) => {
        const n = dictEntries(c.id).length;
        return n ? `<a class="cat" href="#/dict/${c.id}"><span class="ic">${esc(c.icon)}</span><b>${esc(c.title)}</b><small>${n} מילים</small></a>` : '';
      }).join('')}</div>`;
    }
    $app.innerHTML = `<input type="search" id="q" placeholder="חיפוש בעברית, בערבית או בתעתיק" value="${esc(q)}">${body}`;
    bindPlay();
    const input = document.getElementById('q');
    input.oninput = () => { q = input.value.trim(); const pos = input.selectionStart; render(); const i2 = document.getElementById('q'); i2.focus(); i2.setSelectionRange(pos, pos); };
  };
  render();
}

// ---------- quick Hebrew → Arabic dictionary (floating button, every screen) ----------
const heNorm = (s) => String(s).replace(/[\u0591-\u05C7]/g, '').trim();
function quickSearch(q) {
  const hasAr = /[؀-ۿ]/.test(q);
  const nq = hasAr ? normAr(q) : heNorm(q);
  const seenKeys = new Set();
  const hits = [];
  for (const e of ENTRY.values()) {
    if (e.kind !== 'word' && e.kind !== 'line') continue;
    const k = normAr(e.ar) + '|' + e.he;
    if (seenKeys.has(k)) continue;
    let sc = 0;
    if (hasAr) {
      const a = normAr(e.ar);
      sc = a === nq ? 100 : a.split(' ').includes(nq) ? 60 : a.includes(nq) ? 30 : 0;
    } else {
      const he = heNorm(e.he);
      const words = he.split(/[\s,/()?!.–-]+/);
      sc = he === nq ? 100 : words.includes(nq) ? 80 : he.startsWith(nq) ? 60 : he.includes(nq) ? 30 : heNorm(e.tr).includes(nq) ? 10 : 0;
    }
    if (!sc) continue;
    seenKeys.add(k);
    hits.push([sc + (e.kind === 'word' ? 5 : 0) - e.ar.length / 25, e]);
  }
  return hits.sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
}
function conjTable(v) {
  const tenses = ['present', 'past', 'future'].filter((t) => v.forms[t]);
  const names = Object.fromEntries((course.tenses || []).map((t) => [t.id, t.title]));
  return `<div class="card"><h3>${esc(v.he)} – נטייה</h3><table class="grid conj-table"><tr><th></th>${tenses.map((t) => `<th>${esc(names[t] || t)}</th>`).join('')}</tr>
    ${PERSONS.map((p, i) => `<tr><td>${esc(p[0])}</td>${tenses.map((t) => `<td data-play="${esc(v.forms[t][i][0])}">${arSpan(v.forms[t][i][0])}<div class="tr small">${esc(v.forms[t][i][1])}</div></td>`).join('')}</tr>`).join('')}
    </table><div class="small muted">לחיצה על מילה משמיעה אותה</div></div>`;
}
function adjTable(a) {
  return `<div class="card"><h3>${esc(a.he)} – זכר, נקבה ורבים</h3><table class="grid conj-table">
    ${a.forms.map(([ar, tr], f) => `<tr><td>${ADJ_FORM[f]}</td><td data-play="${esc(ar)}">${arSpan(ar)}<div class="tr small">${esc(tr)}</div></td></tr>`).join('')}</table></div>`;
}
function renderQuickDict(q) {
  const out = document.getElementById('qdOut');
  if (!q) {
    out.innerHTML = `<p class="muted small">כתוב מילה או ביטוי בעברית ותקבל איך אומרים בערבית מדוברת, עם תעתיק והשמעה. אפשר גם לחפש פועל בשם הפועל, למשל "לכתוב", ולראות את כל הנטייה.</p>`;
    return;
  }
  const hits = quickSearch(q);
  const nq = heNorm(q);
  const verbs = /[א-ת]/.test(q) ? (course.verbs || []).filter((v) => v.he === nq || (nq.length >= 3 && v.he.includes(nq))) : [];
  const adjs = /[א-ת]/.test(q) ? (course.adjs || []).filter((a) => a.he === nq || (nq.length >= 3 && a.he.includes(nq))) : [];
  const rows = hits.map((e) => `<div class="word-row">${playBtn(e.id)}<div class="grow">${arSpan(e.ar)}<div class="tr">${esc(e.tr)}</div><div>${esc(e.he)}${e.note ? ` <span class="muted small">(${esc(e.note)})</span>` : ''}</div></div>
    ${isOnline() ? `<button class="icon-btn" style="font-size:20px" data-explain="${esc(e.id)}" title="הסבר עם Claude" aria-label="הסבר עם Claude">✨</button>` : ''}</div>`).join('');
  const online = isOnline() ? `<div class="btns" style="margin-top:8px">
      <button class="btn ghost" id="qdClaude">✨ שאל את Claude איך אומרים "${esc(q)}"</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://translate.google.com/?sl=iw&tl=ar&op=translate&text=${encodeURIComponent(q)}">🌐 Google Translate</a></div>
      <p class="small muted">שים לב: Google מתרגם לערבית ספרותית, לא למדוברת.</p>` : '';
  out.innerHTML = `${verbs.map(conjTable).join('')}${adjs.map(adjTable).join('')}${rows ? `<div class="card">${rows}</div>` : `<div class="empty">לא מצאתי את זה במילון של האפליקציה.${isOnline() ? '' : '<br>עם אינטרנט אפשר לשאול את Claude.'}</div>`}${online}`;
  bindPlay(out);
  const ask = document.getElementById('qdClaude');
  if (ask) ask.onclick = () => openExplain(howToSayPrompt(q), 'say:' + q);
}
function initQuickDict() {
  const dlg = document.getElementById('qd');
  const input = document.getElementById('qdInput');
  document.getElementById('qdBtn').onclick = () => {
    if (!course) return;
    renderQuickDict(input.value.trim());
    dlg.showModal();
    input.focus(); input.select();
  };
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(() => renderQuickDict(input.value.trim()), 120); };
  document.querySelectorAll('dialog.sheet').forEach((d) => {
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    d.addEventListener('close', () => Speech.stop());
  });
}

// ---------- explanations from Claude (online only, on demand) ----------
// Without an API key we open claude.ai with the question filled in; with a key (Settings) the answer shows in the app.
const CLAUDE_MODEL = 'claude-opus-5-5';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
const LEARNER = 'אני דובר עברית שלומד ערבית מדוברת (פלסטינית/לבנטינית). ענה בעברית, בקצרה ובבהירות, בלי טבלאות. כתוב כל מילה ערבית גם בכתב ערבי וגם בתעתיק עברי.';
const explainPrompt = (e) => `${LEARNER}
הסבר לי את ${e.kind === 'conj' ? 'צורת הפועל' : e.kind === 'adj' ? 'צורת התואר' : 'הביטוי'}: "${e.ar}" (תעתיק: ${e.tr}; פירוש: ${e.he}).
1. פרק למילים (וגם לתחיליות/סיומות כמו بـ, الـ, ـي, ـك): לכל חלק המשמעות המילולית שלו.
2. תרגום מילולי, מילה במילה, של הכל.
3. למה אומרים את זה ככה: שורש, הטיה, דקדוק או ביטוי קבוע, ואם יש הבדל מהערבית הספרותית.
4. דוגמה נוספת קצרה לשימוש.`;
const howToSayPrompt = (q) => `${LEARNER}
איך אומרים בערבית מדוברת: "${q}"?
תן את הדרך הנפוצה ביותר (ואם יש, עוד חלופה אחת), פרק כל ביטוי למילים עם המשמעות המילולית של כל מילה, והסבר בקצרה למה אומרים את זה ככה.`;
async function askClaude(prompt) {
  const { default: Anthropic } = await import(ANTHROPIC_SDK_URL);
  const client = new Anthropic({ apiKey: settings.claudeKey, dangerouslyAllowBrowser: true });
  const msg = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude לא ענה על השאלה הזאת');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
const miniMd = (t) => esc(t)
  .replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/([؀-ۿ][؀-ۿ\s]*[؀-ۿ]|[؀-ۿ])/g, '<span class="ar">$1</span>');
function explain(e) { openExplain(explainPrompt(e), e.ar + '|' + e.he); }
function openExplain(prompt, key) {
  const dlg = document.getElementById('ex');
  const out = document.getElementById('exOut');
  const link = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const gpt = `<a class="btn ghost block" style="margin-top:8px" target="_blank" rel="noopener" href="https://chatgpt.com/?q=${encodeURIComponent(prompt)}">💬 לשאול את ChatGPT ↗</a>`;
  const cache = store.get('lingo:explain', {});
  const show = (text) => {
    out.innerHTML = `<div class="explain-out">${miniMd(text)}</div><p class="small muted" style="margin-top:12px">ההסבר נשמר ויופיע גם בלי אינטרנט. Claude יכול לטעות, אז כדאי לבדוק מול המורה במקרה של ספק.</p>
      <a class="btn ghost block" target="_blank" rel="noopener" href="${link}">להמשיך לשאול ב-Claude ↗</a>${gpt}`;
  };
  if (!dlg.open) dlg.showModal();
  if (cache[key]) return show(cache[key]);
  if (!isOnline()) { out.innerHTML = '<div class="empty">ההסבר עובד רק עם אינטרנט.</div>'; return; }
  if (!settings.claudeKey) {
    out.innerHTML = `<p>אפשר לקבל הסבר שמפרק את הביטוי למילים עם המשמעות המילולית של כל אחת. השאלה כבר כתובה, רק צריך להיות מחובר ל-Claude:</p>
      <a class="btn block" target="_blank" rel="noopener" href="${link}">✨ פתח את השאלה ב-Claude ↗</a>${gpt}
      <p class="small muted" style="margin-top:12px">רוצה שההסבר יופיע כאן באפליקציה? אפשר להוסיף מפתח API של Claude בהגדרות (חיוב לפי שימוש, כמה אגורות להסבר).</p>`;
    return;
  }
  out.innerHTML = '<div class="empty">✨ Claude חושב...</div>';
  askClaude(prompt).then((text) => {
    const c = store.get('lingo:explain', {});
    c[key] = text;
    const keys = Object.keys(c);
    if (keys.length > 300) delete c[keys[0]];
    store.set('lingo:explain', c);
    if (dlg.open) show(text);
  }).catch((err) => {
    out.innerHTML = `<div class="empty">לא הצלחתי לקבל הסבר (${esc(err.message || err)}).<br>אולי המפתח לא תקין או שאין חיבור.</div>
      <a class="btn ghost block" target="_blank" rel="noopener" href="${link}">פתח את השאלה ב-Claude ↗</a>${gpt}`;
  });
}

// ---------- letters ----------
function allLetters() {
  return [...ENTRY.values()].filter((e) => e.kind === 'letter' && isSingleLetter(e.ar));
}
function viewLetters(ch) {
  setTab('letters');
  const letters = allLetters();
  if (ch) {
    const e = letters.find((x) => x.ar === ch);
    if (!e) return viewLetters();
    setHeader('האות ' + e.tr, '#/letters');
    const f = letterForms(e.ar);
    $app.innerHTML = `<div class="card center"><div class="big-ar" style="font-size:96px">${arSpan(e.ar)}</div>${playBtn(e.id, 'lg')}
      <h2 style="margin-top:8px">${esc(e.tr)}</h2><div>${esc(e.he)}</div></div>
      ${f ? `<div class="card"><h3>צורות</h3><div class="forms"><div>${arSpan(f.isolated)}<small>לבד</small></div><div>${arSpan(f.initial)}<small>בהתחלה</small></div><div>${arSpan(f.medial)}<small>באמצע</small></div><div>${arSpan(f.final)}<small>בסוף</small></div></div>
        ${NON_CONNECTORS.has(e.ar) ? '<p class="small muted" style="margin:8px 0 0">האות הזאת לא מתחברת לאות שאחריה.</p>' : ''}</div>` : ''}
      <div class="card row"><button class="play" data-say="${esc(e.letter.ex.ar)}">🔊</button><div class="grow">${arSpan(e.letter.ex.ar, 'mid-ar')}<div class="tr">${esc(e.letter.ex.tr)}</div><div>${esc(e.letter.ex.he)}</div></div></div>
      <div class="card"><h3>✍️ תרגול כתיבה</h3>${traceHtml(e.ar)}</div>
      <a class="btn block" href="#/lesson/${e.lesson.id}">לשיעור של האות</a>`;
    bindPlay(); bindTrace();
    $app.querySelectorAll('[data-say]').forEach((b) => (b.onclick = () => Speech.speak(b.dataset.say)));
    return;
  }
  setHeader('האלף-בית', null);
  const order = 'ابتثجحخدذرزسشصضطظعغفقكلمنهويةىء';
  letters.sort((a, b) => order.indexOf(a.ar) - order.indexOf(b.ar));
  $app.innerHTML = `<p class="muted small">לחיצה על אות: שמיעה, צורות, ותרגול כתיבה. הסדר הוא סדר האלף-בית הערבי.</p>
    <div class="letters-grid">${letters.map((e) => `<a class="letter-cell" href="#/letters/${encodeURIComponent(e.ar)}">${arSpan(e.ar)}<small>${esc(e.tr)}</small></a>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn secondary" id="lq">✏️ בוחן אותיות</button></div>`;
  document.getElementById('lq').onclick = () => {
    const pseudo = { id: 'letters', title: 'בוחן אותיות', entries: letters };
    const qs = buildQuiz(letters, 15);
    let qi = 0, correct = 0;
    setHeader(pseudo.title, '#/letters');
    const next = () => {
      if (qi >= qs.length) {
        $app.innerHTML = `<div class="card center"><div class="celebrate">🔤</div><h2>${correct}/${qs.length}</h2><a class="btn" href="#/letters">חזרה לאותיות</a></div>`;
        return;
      }
      renderQuestion(qs[qi], qi, qs.length, (ok) => { if (ok) correct++; else addMistake(qs[qi].e); qi++; }, next);
    };
    next();
  };
}

// ---------- settings ----------
function viewSettings() {
  setHeader('הגדרות', null); setTab('settings');
  const voices = Speech.voices;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const learned = Object.keys(P.items).length;
  $app.innerHTML = `
  <div class="card"><h3>🔊 קול והגייה</h3>
    ${voices.length ? `<div class="field"><span>קול</span><select id="voice"><option value="">אוטומטי</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === settings.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})${v.localService ? '' : ' · אונליין'}</option>`).join('')}</select></div>`
      : `<p class="small" style="color:var(--bad)">לא נמצא קול ערבי במכשיר. ${ios ? 'באייפון: הגדרות ← נגישות ← תוכן מוקרא ← קולות ← ערבית, והורד קול.' : 'באנדרואיד: הגדרות ← נגישות/שפה ← המרת טקסט לדיבור ← Google ← התקנת נתוני קול ← ערבית.'} אחרי ההורדה הקול עובד גם בלי אינטרנט.</p>`}
    <div class="field"><span>מהירות</span><input type="range" id="rate" min="0.5" max="1.2" step="0.05" value="${settings.rate}"></div>
    <div class="field"><span>השמעה אוטומטית (כבוי = רק בלחיצה על 🔊)</span><input type="checkbox" class="switch" id="autoplay" ${settings.autoplay ? 'checked' : ''}></div>
    <button class="btn secondary block" id="testVoice">▶ בדיקת קול: مَرحَبا، كيف حالَك؟</button>
    <p class="small muted" style="margin:8px 0 0">הקול של הטלפון מבטא ערבית סטנדרטית, אז לפעמים ההגייה תהיה "רשמית" יותר מהמדוברת. התעתיק בעברית מראה את ההגייה המדוברת.</p>
  </div>
  <div class="card"><h3>📖 תצוגה</h3>
    <div class="field"><span>להציג תעתיק בעברית</span><input type="checkbox" class="switch" id="showTr" ${settings.showTr ? 'checked' : ''}></div>
    <div class="field"><span>להציג ניקוד (حَرَكات)</span><input type="checkbox" class="switch" id="harakat" ${settings.harakat ? 'checked' : ''}></div>
    <div class="field"><span>ערכת צבעים</span><select id="theme"><option value="auto">לפי המכשיר</option><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>בהיר</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>כהה</option></select></div>
  </div>
  <div class="card"><h3>📲 התקנה ועבודה בלי אינטרנט</h3>
    <p class="small">${standalone ? '✅ האפליקציה מותקנת.' : ios ? 'בספארי: כפתור השיתוף ⬆️ ← "הוסף למסך הבית".' : 'בכרום: תפריט ⋮ ← "התקנת אפליקציה" / "הוספה למסך הבית".'}
      אחרי פתיחה ראשונה הכל נשמר בטלפון ועובד גם בלי אינטרנט. כשיש חיבור, האפליקציה מתעדכנת לבד.</p>
    <p class="small muted">עובד רק עם אינטרנט: בדיקת הגייה במיקרופון, הסבר עם Claude וקישור ל-Google Translate.</p>
    <button class="btn secondary block" id="checkUpdate" ${isOnline() ? '' : 'disabled'}>🔄 לבדוק עדכונים עכשיו</button>
  </div>
  <div class="card"><h3>✨ הסבר עם Claude</h3>
    <p class="small">כשיש אינטרנט, כפתור "הסבר עם Claude" מפרק ביטוי למילים ומסביר את המשמעות המילולית ולמה אומרים אותו ככה. בלי מפתח, השאלה נפתחת באתר או באפליקציה של Claude.</p>
    <div class="field"><span>מפתח API (לא חובה)</span><input type="password" id="claudeKey" placeholder="sk-ant-..." value="${esc(settings.claudeKey)}" autocomplete="off" style="max-width:60%"></div>
    <p class="small muted" style="margin:0">עם מפתח מ-console.anthropic.com ההסבר מופיע בתוך האפליקציה (חיוב לפי שימוש). המפתח נשמר רק בטלפון הזה ונשלח רק ל-Anthropic.</p>
  </div>
  <div class="card"><h3>💾 ההתקדמות שלי</h3>
    <p class="small muted">${learned} פריטים במעקב. ההתקדמות נשמרת רק בטלפון הזה, אז כדאי לגבות מדי פעם.</p>
    <div class="btns"><button class="btn secondary" id="export">⬇️ גיבוי לקובץ</button><label class="btn secondary">⬆️ שחזור מקובץ<input type="file" id="import" accept="application/json" hidden></label></div>
    <button class="btn ghost block" style="margin-top:8px;color:var(--bad)" id="reset">איפוס ההתקדמות</button>
  </div>
  <p class="center small muted">מדברים ${APP_VERSION} · תוכן ${esc(course.id)} גרסה ${course.version}</p>`;

  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el[ev] = fn; };
  on('voice', 'onchange', (ev) => { settings.voiceURI = ev.target.value; saveSettings(); Speech.speak('مَرحَبا'); });
  on('rate', 'onchange', (ev) => { settings.rate = +ev.target.value; saveSettings(); Speech.speak('كيف حالَك؟'); });
  on('testVoice', 'onclick', () => Speech.speak('مَرحَبا، كيف حالَك؟'));
  for (const k of ['autoplay', 'showTr', 'harakat']) on(k, 'onchange', (ev) => { settings[k] = ev.target.checked; saveSettings(); });
  on('claudeKey', 'onchange', (ev) => { settings.claudeKey = ev.target.value.trim(); saveSettings(); showBanner(settings.claudeKey ? 'המפתח נשמר ✓' : 'המפתח נמחק', null, 2500); });
  on('theme', 'onchange', (ev) => { settings.theme = ev.target.value; saveSettings(); applyTheme(); });
  on('checkUpdate', 'onclick', async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const changed = await loadCourse(true);
    showBanner(changed ? 'התוכן עודכן ✓' : 'הכל מעודכן ✓', null, 3000);
  });
  on('export', 'onclick', () => {
    const blob = new Blob([JSON.stringify({ app: 'lingo', courseId, settings, progress: P, at: new Date().toISOString() })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `madabrim-${courseId}-${today()}.json`; a.click();
  });
  on('import', 'onchange', async (ev) => {
    try {
      const data = JSON.parse(await ev.target.files[0].text());
      if (data.app !== 'lingo' || !data.progress) throw new Error('bad file');
      P = data.progress; courseId = data.courseId || courseId; saveP();
      showBanner('ההתקדמות שוחזרה ✓', null, 3000); route();
    } catch { alert('הקובץ לא תקין'); }
  });
  on('reset', 'onclick', () => {
    if (confirm('למחוק את כל ההתקדמות בקורס הזה?')) { P = { items: {}, lessons: {}, days: {}, mistakes: {} }; saveP(); route(); }
  });
}

// ---------- shell ----------
function applyTheme() {
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
function showBanner(text, action, ms) {
  $banner.innerHTML = `${esc(text)}${action ? ` <button id="bannerBtn">${esc(action.label)}</button>` : ''}`;
  $banner.hidden = false;
  if (action) document.getElementById('bannerBtn').onclick = action.fn;
  if (ms) setTimeout(() => ($banner.hidden = true), ms);
}
function updateNet() { $net.textContent = isOnline() ? '' : '✈︎ לא מחובר'; }

function route() {
  Speech.stop();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  if (!course) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [r, a, b] = parts;
  window.scrollTo(0, 0);
  if (r === 'lesson') viewLesson(a);
  else if (r === 'learn') viewLearn(a);
  else if (r === 'quiz') viewQuiz(a, b);
  else if (r === 'review') viewReview();
  else if (r === 'words') viewWords();
  else if (r === 'dict') viewDict(a);
  else if (r === 'letters') viewLetters(a);
  else if (r === 'settings') viewSettings();
  else viewHome();
}

async function fetchJSON(url, fresh) {
  const res = await fetch(url, fresh ? { cache: 'no-store' } : {});
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
// returns true if a newer course version replaced the one in use
async function loadCourse(fresh) {
  const meta = courses.find((c) => c.id === courseId && c.file) || courses.find((c) => c.file);
  courseId = meta.id; store.set('lingo:course', courseId);
  const data = await fetchJSON(meta.file, fresh);
  const changed = course && course.id === data.id && data.version !== course.version;
  course = data; indexCourse(); loadP(); Speech.init();
  return changed;
}
async function switchCourse(id) {
  courseId = id; await loadCourse(); route();
}

async function start() {
  applyTheme(); updateNet();
  addEventListener('online', updateNet); addEventListener('offline', updateNet);
  try {
    courses = (await fetchJSON('courses/index.json')).courses;
    await loadCourse();
  } catch (err) {
    $app.innerHTML = `<div class="empty">לא הצלחתי לטעון את התוכן (${esc(err.message)}). פתח/י את האפליקציה פעם אחת עם אינטרנט.</div>`;
    return;
  }
  addEventListener('hashchange', route);
  initQuickDict();
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            showBanner('יש גרסה חדשה של האפליקציה', { label: 'עדכון', fn: () => location.reload() });
          }
        });
      });
    }).catch(() => {});
    // when online, quietly refresh course content in the background
    if (isOnline()) loadCourse(true).then((changed) => { if (changed) { showBanner('התוכן עודכן ✓', null, 3000); route(); } }).catch(() => {});
  }
}
start();
