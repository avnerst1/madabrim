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
key: ar | Hebrew transliteration | Hebrew meaning [| note]
```
`key` is the stable id used for progress tracking: never rename keys of existing items. Reusing a key for the same Arabic text shares progress; the build fails if a key is reused for different text.

Transliteration convention: ח=ح, ח'=خ, ע=ع, ע'=غ, ת'=ث, ד'=ذ, צ=ص, צ'=ض, ט=ط, ט'=ظ, ג'=ج, ק=ق, כ=ك.

## Features
- 14 units / 59 lessons, from letters and harakat to verbs, future/progressive, connectors; unit 14 is bonus everyday situations beyond the course.
- Lesson: learn (flashcards with audio, letter forms, finger-tracing), practice quiz (meaning, reverse, reading, listening, spelling with letter tiles, dialogue "what comes next"), separate writing and listening drills.
- Spaced repetition (Leitner boxes 0–7, `KNOWN_BOX` = 5). "המילים שלי" lists hard / learning / known, with manual mark known/unknown.
- Progression: next lesson unlocks at ≥70% in practice; locked lessons can still be opened; setting to unlock all.
- Audio: browser speech synthesis (works offline when the phone has an Arabic voice installed). Online-only extras: pronunciation check via speech recognition (ar-JO), Google Translate link.
- Progress in localStorage, per course (`lingo:progress:<courseId>`); backup/restore to a JSON file in settings.

## Adding a language
Add `courses/<id>/course.txt` (same format; set target-lang for TTS, e.g. `es`), build it, set `file` in `courses/index.json`, add the json to `SHELL` in sw.js. The UI text is Hebrew; the Arabic-specific bits (letters page, harakat toggle) only show when the course has letter lessons.

## Run locally / host
Any static HTTPS host works (service workers need HTTPS or localhost). Local: `python3 -m http.server` in this folder.
