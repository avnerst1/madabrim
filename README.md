# מדברים (Madabrim) – offline language trainer

Installable web app (PWA) for learning spoken Arabic from Hebrew. Works offline on a phone after the first load; updates itself when online. Built for avner from their class material ("כאן זה לא אולפן / This is not an Ulpan", Online Int. Beginner Arabic, Aug 2026: the slide deck + workbook "תשרפנא").

## Files
- `index.html`, `styles.css`, `app.js` – the whole app, plain JS, no build step. UI is Hebrew, RTL.
- `sw.js` – service worker. Shell is cache-first; `courses/*` is network-first (new content arrives when online). **Bump `VERSION` in sw.js on every app change**, and `APP_VERSION` in app.js.
- `manifest.webmanifest`, `icons/` – install metadata.
- `fonts/` – Noto Naskh Arabic (woff2) so Arabic with harakat renders well offline.
- `courses/index.json` – list of courses. Spanish/Russian/Portuguese are placeholders (`file: null`).
- `courses/ar-he/course.txt` – **source of the content**. `course.json` is generated from it.
- `tools/build-course.mjs` – `node tools/build-course.mjs courses/ar-he` validates and rebuilds course.json.

## Content format (course.txt)
```
@course id | title | target-lang | ui-lang | version     (bump version so phones refresh)
# u1 | Unit title | description
## u1l2 | letters|vocab|phrases|grammar|dialogue | Lesson title
> intro paragraph (Hebrew)
T col | col | col                (table; first row = header)
L ب | name | sound | example-ar | example-translit | example-he   (letters lessons)
D speaker | ar | translit | he   (dialogue lines)
= category-id                     (dictionary topic for the lesson's words)
key: ar | Hebrew transliteration | Hebrew meaning [| note]
X present|want|future|progressive|past   (this lesson unlocks that tense in the conjugation drills)
@verb id | Hebrew infinitive      (verb paradigm, anywhere; followed by:)
VS ar ~ tr | ... (8 cells)        bare/subjunctive forms: أنا إنتَ إنتِ هو هي إحنا إنتو هُمّ
VP ar ~ tr | ... (8 cells)        past forms
@adj id | Hebrew (masculine)      (adjective, anywhere; followed by:)
VA ar ~ tr | ar ~ tr | ar ~ tr   masculine | feminine | plural
```
Present (بـ), رَح, عَم and بِدّي forms are derived from VS by tools/build-course.mjs.
`key` is the stable id used for progress tracking: never rename keys of existing items. Reusing a key for the same Arabic text shares progress; the build fails if a key is reused for different text.

Transliteration convention: ח=ح, ח'=خ, ע=ع, ע'=غ, ת'=ث, ד'=ذ, צ=ص, צ'=ض, ט=ط, ט'=ظ, ג'=ج, ק=ق, כ=ك.

## Features
- 16 units / 68 lessons (unit 16 = past tense), from letters and harakat to verbs, future/progressive, connectors; unit 14 is bonus everyday situations beyond the course; unit 15 is medical Arabic (avner is a medical student).
- Dictionary tab: every word grouped by topic (`@category` list, lesson default `= cat`, per-key overrides `C cat: key, key` at the end of course.txt), with conjugation tables, search and a quiz per topic.
- Lesson: learn (flashcards), and "תרגול מלא" (`lessonQuiz`), ordered easy→hard: recognise (ar→he, listen) → recall (he→ar) → spell with letter tiles → conjugations (conj lessons) → cloze "which form fits the sentence" → sentence building → typing a whole sentence (similarity ≥ 0.85). Sentences come from the lesson, else from sentences using its words (`sentencesFor`). Focused drills sit in a collapsed "תרגולים ממוקדים" box.
- Cloze distractors: verb paradigms (past only inside the past unit), بِدّي forms, or generated gender/number/person forms of adjectives and ب-verbs (`inflections`).
- Conjugation drills (`#/quiz/conj`, Review tab, conj lessons): pick the right form for a person/tense, who does it, which tense; tenses default to lessons already opened. 32 verb paradigms. Adjective drill ("תארים: זכר / נקבה / רבים", `t:adj`): pick the form for a subject or name the form, 24 adjectives; also mixed into adj/feel lesson quizzes and any lesson using those adjectives, and their forms feed the cloze questions.
- Sentence building (`#/quiz/sent`, lesson button, mixed into quizzes): order word tiles with distractors.
- Hebrew→Arabic prompts hide the transliteration behind a "💡 הצג תעתיק" button.
- Quick dictionary: floating 🔎 button on every screen; Hebrew or Arabic search, verb infinitive shows a conjugation table.
- "✨ הסבר עם Claude" (online only): without a key opens claude.ai/new?q=<prompt>; with an API key in settings calls claude-opus-5-5 (effort low, server-side fallback) via @anthropic-ai/sdk loaded from jsdelivr on demand; answers cached in localStorage `lingo:explain`.
- Spaced repetition (Leitner boxes 0–7, `KNOWN_BOX` = 5). "המילים שלי" lists hard / learning / known, with manual mark known/unknown.
- All lessons are open (user's choice); home still shows done (≥70%), started, score and known-% per lesson.
- Daily mistakes drill (`#/quiz/daily`, Review tab + home button): every wrong answer is stored in `P.mistakes` until answered right there, so undone ones carry over to the next day.
- Wrong conjugation answer shows the verb's full table for that tense; listening questions have "👁 הצג מה נאמר"; no pick-the-transliteration questions.
- Speech uses a token so a delayed/stale utterance never plays over the current item.
- Audio: browser speech synthesis (works offline when the phone has an Arabic voice installed). Online-only extras: pronunciation check via speech recognition (ar-JO), Google Translate link.
- Progress in localStorage, per course (`lingo:progress:<courseId>`); backup/restore to a JSON file in settings.

## Adding a language
Add `courses/<id>/course.txt` (same format; set target-lang for TTS, e.g. `es`), build it, set `file` in `courses/index.json`, add the json to `SHELL` in sw.js. The UI text is Hebrew; the Arabic-specific bits (letters page, harakat toggle) only show when the course has letter lessons.

## Run locally / host
Any static HTTPS host works (service workers need HTTPS or localhost). Local: `python3 -m http.server` in this folder.
