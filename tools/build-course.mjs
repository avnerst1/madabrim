// Converts a course text file (courses/<id>/course.txt) into course.json for the app.
// Usage: node tools/build-course.mjs courses/ar-he
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-course.mjs courses/<id>'); process.exit(1); }
const src = fs.readFileSync(path.join(dir, 'course.txt'), 'utf8').split('\n');

const AR = /[؀-ۿ]/;
const course = { id: '', title: '', lang: '', ui: '', version: 1, categories: [], units: [], tenses: [], verbs: [] };
const overrides = new Map();
let unit = null, lesson = null, verb = null;
const errors = [];
const seen = new Map();
// conjugation drills: tenses a lesson can unlock ("X <tense>"), all but past derived from the bare (subjunctive) form
const TENSES = { present: 'הווה', want: 'רוצה ל... (بِدّي)', future: 'עתיד (رَح)', progressive: 'עכשיו (عَم)', past: 'עבר' };
const BIDD = [['بِدّي', 'בִּדִּי'], ['بِدَّك', 'בִּדַּכּ'], ['بِدِّك', 'בִּדֶּכּ'], ['بِدُّه', 'בִּדּוֹ'], ['بِدّها', 'בִּדְּהַא'], ['بِدّنا', 'בִּדְּנַא'], ['بِدّكُم', 'בִּדְּכֹּם'], ['بِدّهُم', 'בִּדְּהֹם']];
function present([ar, tr], person) {
  if (person === 0) return [ar.replace(/^آ/, 'با').replace(/^أَ?/, 'بَ'), tr.replace(/^אַ/, 'בַּ')];
  if (/^ي/.test(ar)) return ['بي' + ar.slice(1).replace(/^ِ/, ''), /^י[ְִ]/.test(tr) ? 'בִּי' + tr.slice(2) : 'בְּ' + tr];
  return tr[1] === 'ְ' ? ['بِ' + ar, 'בִּ' + tr] : ['بْ' + ar, 'בְּ' + tr];
}
function deriveTenses(v) {
  const s = v.forms.subj;
  if (!s) return;
  v.forms.present = s.map(present);
  v.forms.future = s.map(([ar, tr]) => ['رَح ' + ar, 'רַח ' + tr]);
  v.forms.progressive = s.map(([ar, tr]) => ['عَم ' + ar, 'עַם ' + tr]);
  v.forms.want = s.map(([ar, tr], i) => [BIDD[i][0] + ' ' + ar, BIDD[i][1] + ' ' + tr]);
  delete v.forms.subj;
}
const split = (s) => s.split('|').map((x) => x.trim());

src.forEach((raw, i) => {
  const line = raw.trim();
  const at = `line ${i + 1}`;
  if (!line) return;
  if (line.startsWith('@course')) {
    const [id, title, lang, ui, version] = split(line.slice(7));
    Object.assign(course, { id, title, lang, ui, version: Number(version) || 1 });
  } else if (line.startsWith('@category')) {
    const [id, icon, title] = split(line.slice(9));
    course.categories.push({ id, icon, title });
  } else if (line.startsWith('@verb')) {
    const [id, he] = split(line.slice(5));
    verb = { id, he, forms: {} };
    course.verbs.push(verb);
  } else if (/^V[SP] /.test(line)) {
    const cells = split(line.slice(3)).map((c) => c.split('~').map((x) => x.trim()));
    if (cells.length !== 8 || cells.some((c) => c.length !== 2 || !AR.test(c[0]) || AR.test(c[1]))) errors.push(`${at}: verb row needs 8 "ar ~ tr" cells`);
    verb.forms[line[1] === 'S' ? 'subj' : 'past'] = cells;
  } else if (line.startsWith('X ')) {
    const id = line.slice(2).trim();
    if (!TENSES[id]) errors.push(`${at}: unknown tense "${id}"`);
    else course.tenses.push({ id, title: TENSES[id], lesson: lesson.id });
  } else if (line.startsWith('= ')) {
    lesson.cat = line.slice(2).trim();
  } else if (line.startsWith('C ')) {
    const m = line.slice(2).match(/^(\w+):\s*(.*)$/);
    for (const k of m[2].split(',').map((x) => x.trim()).filter(Boolean)) overrides.set(k, { cat: m[1], at });
  } else if (line.startsWith('## ')) {
    const [id, type, title] = split(line.slice(3));
    lesson = { id, type, title, intro: [], table: [], letters: [], items: [], lines: [] };
    unit.lessons.push(lesson);
  } else if (/^# u\d+\s*\|/.test(line)) {
    const [id, title, desc] = split(line.slice(2));
    unit = { id, title, desc: desc || '', lessons: [] };
    course.units.push(unit);
  } else if (line.startsWith('#')) {
    // comment
  } else if (line.startsWith('> ')) {
    lesson.intro.push(line.slice(2));
  } else if (line.startsWith('T ')) {
    lesson.table.push(split(line.slice(2)));
  } else if (line.startsWith('L ')) {
    const [ch, name, sound, exAr, exTr, exHe] = split(line.slice(2));
    lesson.letters.push({ id: 'L:' + ch, ch, name, sound, ex: { ar: exAr, tr: exTr, he: exHe } });
  } else if (line.startsWith('D ')) {
    const [who, ar, tr, he] = split(line.slice(2));
    const id = `${lesson.id}:${lesson.lines.length + 1}`;
    if (!AR.test(ar) || AR.test(tr) || AR.test(he)) errors.push(`${at}: bad dialogue columns`);
    lesson.lines.push({ id, who, ar, tr, he });
  } else {
    const m = line.match(/^([^:|]+):\s*(.*)$/);
    if (!m) { errors.push(`${at}: unparsed: ${line}`); return; }
    const [ar, tr, he, note] = split(m[2]);
    let id = m[1].trim();
    if (!ar || !tr || !he) errors.push(`${at}: missing column`);
    if (!AR.test(ar)) errors.push(`${at}: ar column has no Arabic: ${ar}`);
    if (AR.test(tr) || AR.test(he)) errors.push(`${at}: Arabic inside tr/he: ${tr} / ${he}`);
    if (seen.has(id) && seen.get(id) !== ar) errors.push(`${at}: id "${id}" reused for different text`);
    seen.set(id, ar);
    const item = { id, ar, tr, he };
    if (note) item.note = note;
    lesson.items.push(item);
  }
});

course.verbs.forEach(deriveTenses);
const catIds = new Set(course.categories.map((c) => c.id));
for (const [k, o] of overrides) {
  if (!seen.has(k)) errors.push(`${o.at}: category override for unknown key "${k}"`);
  if (!catIds.has(o.cat)) errors.push(`${o.at}: unknown category "${o.cat}"`);
}
for (const u of course.units) for (const l of u.lessons) {
  if (catIds.size && !catIds.has(l.cat)) errors.push(`lesson ${l.id}: missing or unknown category "${l.cat}"`);
  for (const it of l.items) it.cat = overrides.get(it.id)?.cat || l.cat;
}
for (const u of course.units) for (const l of u.lessons) {
  for (const k of ['intro', 'table', 'letters', 'items', 'lines']) if (!l[k].length) delete l[k];
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
fs.writeFileSync(path.join(dir, 'course.json'), JSON.stringify(course));
const lessons = course.units.flatMap((u) => u.lessons);
const count = lessons.reduce((n, l) => n + (l.items?.length || 0) + (l.letters?.length || 0) + (l.lines?.length || 0), 0);
console.log(`${course.id} v${course.version}: ${course.units.length} units, ${lessons.length} lessons, ${count} entries, ${course.verbs.length} verbs, tenses: ${course.tenses.map((t) => t.id).join(' ')}`);
