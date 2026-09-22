// One-time migration of the mishneh-torah repo to the canonical format that
// js/format.js reads and writes (see the header of that file).
//
//   node tools/migrate.mjs [--repo ../mishneh-torah] [--ref HEAD] [--out out/migrated]
//                          [--niqqud in001.zip]
//
// Reads everything from git at --ref (never the working tree) and writes the
// complete set of new/changed files under --out, mirroring the repo layout,
// plus --out/REPORT.md. Nothing in the repo itself is touched; copying the
// output over a branch of the repo is a separate, reviewable step.
//
// What it does:
//   Original/*.htm  → Hebrew/{b}-{s}-he.md   (Windows-1255 HTML → UTF-8 markdown;
//                     book openings split into {b}-0, 00.htm split into 0-0…0-4
//                     to match the English files one for one)
//   in001.zip       → Hebrew/{b}-{s}-hen.md  (Mechon Mamre's pointed edition, i/*n.htm,
//                     converted the same way) + the zip's files archived under
//                     Original/niqqud/
//   Translation/*   → canonical form (labels, headings, whitespace, LF) + a few
//                     named content fixes listed in FIXES below
//   Commentary/*    → canonical form ("[^c.h.n]:", tab continuations)
//   index.json      → navigation index (books, sections, chapters, law counts)
//   .gitattributes  → pin LF line endings
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { F, APP_ROOT, args, gitRepo, KNOWN_MISALIGNED } from './lib.mjs';

const opt = args({
  repo: path.resolve(APP_ROOT, '../mishneh-torah'),
  ref: 'HEAD',
  out: path.resolve(APP_ROOT, 'out/migrated'),
  niqqud: path.resolve(APP_ROOT, 'in001.zip'),
});
const repo = gitRepo(opt.repo, opt.ref);
const files = repo.ls();
const report = [];          // markdown lines for REPORT.md
const out = new Map();      // repo path → content

/* ------------------------------------------------------------------ */
/* Hebrew: Mechon Mamre HTML → blocks                                  */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', copy: '©' };
const decodeEntities = s => s.replace(/&(#\d+|\w+);/g, (m, e) =>
  e[0] === '#' ? String.fromCharCode(+e.slice(1)) : (ENTITIES[e] ?? m));

// The Song of the Sea / Ha'azinu layout in 23.htm is a table of one-row tables.
// Each row becomes one line; brick-layout rows (≤3 cells, i.e. text–gap–text)
// keep a visible three-space gap between cells.
function tableToParagraph(html) {
  const lines = [];
  for (const piece of html.split(/<TABLE WIDTH="100%">/i).slice(1)) {
    const cells = [...piece.matchAll(/<TD[^>]*>([^<]*)<\/TD>/gi)].map(m => decodeEntities(m[1]).trim()).filter(Boolean);
    if (cells.length) lines.push(cells.join(cells.length <= 3 ? '   ' : ' '));
  }
  return `<P>${lines.join('<BR>')}</P>`;
}

// → [{ tag: 'P'|'H1'|'H2'|'H3', text }] with inline markup turned into markdown.
function htmlBlocks(html, name) {
  let body = html.slice(html.search(/<DIV\b/i));
  body = body.slice(body.indexOf('>') + 1).replace(/<\/DIV>[\s\S]*$/i, '');
  body = body.replace(/<TABLE WIDTH="70%">[\s\S]*<\/TABLE>/i, tableToParagraph);
  if (/<SMALL><FONT FACE="Arial">C<\/FONT><\/SMALL>/.test(body)) {
    report.push(`- \`${name}\`: an Arial-font "C" (the chi-shaped anointing mark, 8:2 1:8) kept as a plain "C" — please check.`);
  }
  const big = (body.match(/<BIG>/gi) || []).length;
  if (big) {
    report.push(`- \`${name}\`: ${big} enlarged letter(s) (\`<BIG>\`, used in the get text to flag a spelling) kept as ordinary letters.`);
  }
  const blocks = [];
  const re = /<(P|H1|H2|H3)\b[^>]*>/gi;
  const starts = [...body.matchAll(re)];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : body.length;
    let s = body.slice(m.index + m[0].length, end);
    s = s.replace(/\r?\n/g, ' ')
      .replace(/<BR\s*\/?>/gi, '\n')
      .replace(/<\/?B>/gi, '**')
      .replace(/<\/?(P|H1|H2|H3|SMALL|BIG|BDO|FONT|SPAN)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, tag => { throw new Error(`${name}: unhandled tag ${tag}`); });
    s = decodeEntities(s).replace(/\xA0/g, ' ').split('\n').map(l => l.replace(/\s+$/, '').replace(/^\s+/, '')).filter(Boolean).join('\n');
    if (s) blocks.push({ tag: m[1].toUpperCase(), text: s });
  }
  return blocks;
}

// Blocks → markdown source (H1 → "#", H2/H3 → "##"), then through the parser
// and writer so the result is canonical by construction.
function blocksToDoc(blocks) {
  const md = blocks.map(b => b.tag === 'H1' ? '# ' + b.text : b.tag === 'P' ? b.text : '## ' + b.text).join('\n\n');
  return F.parseText(md, 'he');
}

const decode = p => new TextDecoder('windows-1255').decode(repo.buf(p));

// One Mechon Mamre edition → one Hebrew layer. `htm` is [{ name, code, html }]
// where code is the two-character file code ("11", "3a", "00").
function convertHebrew(htm, layer) {
  const docs = new Map();   // section id → blocks
  for (const { name, code, html } of htm) {
    const blocks = htmlBlocks(html, name);
    if (code === '00') {
      splitFrontMatter(blocks, docs);
    } else if (code[1] === '1') {
      // First file of a book: book opening (verse, book title, list of
      // sections) up to the section's own H1 becomes {b}-0.
      const h1s = blocks.map((b, i) => b.tag === 'H1' ? i : -1).filter(i => i >= 0);
      const cut = h1s[h1s.length - 1];
      docs.set(`${code[0]}-0`, blocks.slice(0, cut));
      docs.set(`${code[0]}-1`, blocks.slice(cut));
    } else {
      docs.set(`${code[0]}-${code[1]}`, blocks);
    }
  }
  for (const [id, blocks] of docs) {
    const doc = blocksToDoc(blocks);
    out.set(F.paths(id)[layer], F.writeText(doc, 'he'));
  }
}

const originals = () => files.filter(f => /^Original\/[0-9a-e][0-9a]\.htm$/.test(f))
  .map(f => ({ name: f, code: f.slice(9, 11), html: decode(f) }));

// The pointed edition comes as Mechon Mamre's zip (i/00n.htm … i/e5n.htm).
// Its files are also archived, byte for byte, under Original/niqqud/.
function pointed() {
  if (!fs.existsSync(opt.niqqud)) {
    report.push(`- No pointed edition at \`${opt.niqqud}\`; Hebrew/*-hen.md not generated.`);
    return [];
  }
  const dir = path.resolve(APP_ROOT, 'out/niqqud-src');
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync('unzip', ['-o', '-q', opt.niqqud, '-d', dir]);
  const list = [];
  for (const rel of ['readme.txt', ...fs.readdirSync(path.join(dir, 'i')).map(f => 'i/' + f)]) {
    const full = path.join(dir, rel);
    if (!fs.statSync(full).isFile()) continue;
    const bytes = fs.readFileSync(full);
    out.set('Original/niqqud/' + path.basename(rel), bytes);
    const m = path.basename(rel).match(/^([0-9a-e][0-9a])n\.htm$/);
    if (m) list.push({ name: 'in001.zip:' + rel, code: m[1], html: new TextDecoder('windows-1255').decode(bytes) });
  }
  return list;
}

// 00.htm holds what the English splits into 0-0 (title page), 0-1
// (introduction), 0-2 / 0-3 (positive / negative commandments) and 0-4
// (structure of the fourteen books). Each part's H2 becomes its "# title";
// the second opening verse belongs to the introduction, as in the English.
function splitFrontMatter(blocks, docs) {
  const at = t => blocks.findIndex(b => b.tag === 'H2' && F.stripNiqqud(b.text).startsWith(t));
  const cuts = [at('הקדמה'), at('מצוות עשה'), at('מצוות לא תעשה'), at('וראיתי לחלק')];
  if (cuts.some(c => c < 0)) throw new Error('00.htm: expected H2 headings not found');
  const parts = [blocks.slice(0, cuts[0])];
  for (let i = 0; i < cuts.length; i++) parts.push(blocks.slice(cuts[i], cuts[i + 1]));
  parts.slice(1).forEach(p => { p[0] = { tag: 'H1', text: p[0].text }; });
  // Title page: first verse, H1, and the subtitle H2 as a plain paragraph.
  const verses = parts[0].filter((b, i) => b.tag === 'P' && i < parts[0].findIndex(x => x.tag === 'H1'));
  parts[0] = parts[0].filter(b => b !== verses[1]).map(b => b.tag === 'H2' ? { tag: 'P', text: b.text } : b);
  if (verses[1]) parts[1].unshift(verses[1]);
  parts.forEach((p, i) => docs.set(`0-${i}`, p));
}

/* ------------------------------------------------------------------ */
/* English and commentary                                             */
/* ------------------------------------------------------------------ */

// Named, one-off content fixes (beyond what canonical writing normalises).
const FIXES = {
  'Translation/1-0-en.md': s => s.replace(/^(\*Draw Your mercy[^\n]*\(Psalms 36:11\)\.)\*\*$/m, '$1*'),
  'Translation/1-2-en.md': s => s.replace(/^Here is an accurate English translation of the provided Hebrew text:[ \t]*\r?\n(\r?\n)?/m, ''),
  'Translation/0-3-en.md': s => s.replace(/^Comment (\d+)[ \t]+/gm, '$1 '),
};

const FIX_NOTES = {
  'Translation/0-3-en.md': 'relabelled the closing "Comment 1…5" paragraphs as 1–5, matching the Hebrew א–ה',
  'Translation/1-0-en.md': 'closed the unbalanced italics on the opening verse (`.**` → `.*`)',
  'Translation/1-2-en.md': 'removed leftover machine-translation line "Here is an accurate English translation of the provided Hebrew text:"',
};

function convertMarkdown() {
  for (const f of files) {
    const c = F.classify(f);
    if (!c || (c.layer !== 'en' && c.layer !== 'co')) continue;
    let src = repo.text(f);
    if (FIXES[f]) {
      const fixed = FIXES[f](src);
      if (fixed === src) throw new Error(`fix for ${f} no longer applies`);
      src = fixed;
      report.push(`- \`${f}\`: ${FIX_NOTES[f]}`);
    }
    const doc = F.parse(src, c.layer);
    if (c.layer === 'co' && doc.title == null && doc.chapters[0] && doc.chapters[0].n == null &&
        !doc.chapters[0].intro.length && !doc.chapters[0].notes.length) {
      // e-5 uses "## Title" for its title.
      doc.title = doc.chapters.shift().heading;
      doc.warnings.push('"## " title promoted to "# "');
    }
    for (const w of doc.warnings) warnings.push([f, w]);
    out.set(f, F.write(doc, c.layer));
  }
}
const warnings = [];

/* ------------------------------------------------------------------ */
/* Bracketed [n] sub-numbers (Vilna halakhah numbers)                  */
/* ------------------------------------------------------------------ */

// The Hebrew's [ד] markers are authoritative; the English \[4] markers are
// brought into line law by law. Where a marker falls at the start of the
// Hebrew law it goes right after the English label; where it falls mid-law,
// the English phrase it goes in front of is listed here (checked by hand
// against the Hebrew). END appends it (1-3 7:8 ends "[ח] .").
const END = Symbol('end');
const MARKER_ANCHORS = {
  '1-3 1:3': { 3: 'And he is obligated to hire' },
  '1-3 1:13': { 11: 'And he must divide' },
  '1-3 2:4': { 4: 'One without a wife' },
  '1-3 3:2': { 2: 'The Sages said: A mamzer' },
  '1-3 3:3': { 4: 'If the opportunity arises' },
  '1-3 5:7': { 4: 'Any student who has not' },
  '1-3 5:11': { 7: 'He must stand up for his teacher' },
  '1-3 5:15': { 10: 'Any Torah scholar whose' },
  '1-3 6:5': { 5: 'When three are walking' },
  '1-3 6:7': { 7: 'When a scholar enters' },
  '1-3 6:9': { 8: 'A permanent student' },
  '1-3 7:8': { 8: END },
  '1-3 7:9': { 10: 'One who does not know who' },
  '1-4 9:12': { 10: 'When traveling from place to place', 11: 'It is forbidden to assist gentiles' },
  '1-4 9:14': { 13: 'If one sells his house', 14: 'It is forbidden to eulogize' },
  '1-4 10:5': { 4: 'Even in places where renting' },
  '1-5 6:3': { 2: 'When does the above apply?' },
  '8-5 6:6': { 6: 'He then goes and rinses' },
  '9-3 1:1': { 2: 'The human firstborn and the donkey firstborn' },
};
const HE_MARK = /\[([א-ת]{1,3})\]/g;
const EN_MARK = /\\\[(\d{1,3})\]/g;

function syncMarkers() {
  const changes = [];
  for (const p of [...out.keys()]) {
    const c = F.classify(p);
    if (!c || c.layer !== 'en' || !out.has(F.paths(c.id).he)) continue;
    const en = F.parseText(out.get(p), 'en');
    const heLaws = F.lawMap(F.parseText(out.get(F.paths(c.id).he), 'he'));
    let touched = false;
    for (const ch of en.chapters) for (const law of ch.laws) {
      const key = `${ch.key}:${law.n}`;
      const hl = heLaws.get(key);
      if (!hl) continue;
      const hm = [];
      [hl.text, ...hl.extra].forEach((b, bi) => {
        for (const m of b.matchAll(HE_MARK)) hm.push({ n: F.hebToNum(m[1]), start: bi === 0 && m.index === 0 });
      });
      const blocks = [law.text, ...law.extra];
      const em = blocks.flatMap(b => [...b.matchAll(EN_MARK)].map(m => +m[1]));
      if (hm.map(x => x.n).join() === em.join()) continue;

      const label = `${c.id} ${key}`;
      let out_;
      if (hm.length === em.length) {
        // Same places, different numbers: renumber in order.
        let i = 0;
        out_ = blocks.map(b => b.replace(EN_MARK, () => `\\[${hm[i++].n}]`));
        changes.push(`${label}: renumbered [${em}] → [${hm.map(x => x.n)}]`);
      } else {
        out_ = blocks.map(b => b.replace(/\\\[\d{1,3}\] ?/g, ''));
        for (const x of hm) {
          const mark = `\\[${x.n}]`;
          if (x.start) { out_[0] = `${mark} ${out_[0]}`; continue; }
          const anchor = MARKER_ANCHORS[label]?.[x.n];
          if (anchor === END) { out_[out_.length - 1] += ` ${mark}`; continue; }
          if (!anchor) throw new Error(`${label}: no anchor for mid-law marker [${x.n}]`);
          const bi = out_.findIndex(b => b.includes(anchor));
          if (bi < 0) throw new Error(`${label}: anchor "${anchor}" not found`);
          out_[bi] = out_[bi].replace(anchor, `${mark} ${anchor}`);
        }
        changes.push(`${label}: [${em}] → [${hm.map(x => x.n)}]`);
      }
      law.text = out_[0];
      law.extra = out_.slice(1);
      touched = true;
    }
    if (touched) out.set(p, F.writeText(en, 'en'));
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* index.json, alignment report                                       */
/* ------------------------------------------------------------------ */

const BOOK_IDS = '0123456789abcde'.split('');

function buildIndex() {
  const ids = [...new Set([...out.keys()].map(p => F.classify(p)).filter(Boolean).map(c => c.id))]
    .sort((a, b) => BOOK_IDS.indexOf(a[0]) - BOOK_IDS.indexOf(b[0]) || a.localeCompare(b));
  const books = [];
  for (const id of ids) {
    const he = out.has(F.paths(id).he) ? F.parseText(out.get(F.paths(id).he), 'he') : null;
    const en = out.has(F.paths(id).en) ? F.parseText(out.get(F.paths(id).en), 'en') : null;
    let book = books.find(b => b.id === id[0]);
    if (!book) books.push(book = { id: id[0], sections: [] });
    if (id[2] === '0' && id[0] !== '0') { book.he = he?.title ?? null; book.en = en?.title ?? null; }
    book.sections.push({
      id,
      he: he?.title ?? null,
      en: en?.title ?? null,
      chapters: (en || he).chapters.map(ch => ({
        key: ch.key,
        ...(ch.n == null ? {} : { n: ch.n }),
        ...(ch.heading ? { heading: ch.heading } : {}),
        laws: ch.laws.length,
      })),
    });
  }
  const front = books.find(b => b.id === '0');
  if (front) { front.en = 'Front Matter'; front.he = 'הקדמה'; }
  return { format: 1, books };
}

const secondary = (s, lang) => (s.match(lang === 'he' ? /\[[א-ת]{1,3}\]/g : /\\?\[\d{1,3}\]/g) || []).length;

function alignmentReport(index) {
  const lines = [];
  let ok = 0, bad = 0;
  for (const book of index.books) for (const sec of book.sections) {
    const p = F.paths(sec.id);
    if (!out.has(p.he) || !out.has(p.en)) {
      lines.push(`| ${sec.id} | missing ${out.has(p.he) ? 'English' : 'Hebrew'} file | | |`);
      bad++; continue;
    }
    const he = F.parseText(out.get(p.he), 'he'), en = F.parseText(out.get(p.en), 'en');
    const hk = he.chapters.map(c => `${c.key}(${c.laws.length})`).join(' ');
    const ek = en.chapters.map(c => `${c.key}(${c.laws.length})`).join(' ');
    const hs = secondary(out.get(p.he), 'he'), es = secondary(out.get(p.en), 'en');
    const diffs = [];
    if (hk !== ek) {
      const hm = new Map(he.chapters.map(c => [c.key, c.laws.length]));
      const em = new Map(en.chapters.map(c => [c.key, c.laws.length]));
      for (const k of new Set([...hm.keys(), ...em.keys()])) {
        if (hm.get(k) !== em.get(k)) diffs.push(`ch ${k}: he ${hm.get(k) ?? '—'} / en ${em.get(k) ?? '—'}`);
      }
      if (!diffs.length) diffs.push('chapter order differs');
    }
    const known = KNOWN_MISALIGNED[sec.id];
    if (diffs.length && !known) bad++; else ok++;
    const sm = hs === es ? `${hs}` : `**he ${hs} / en ${es}**`;
    const what = diffs.length ? diffs.join('; ') + (known ? ` — expected: ${known}` : '') : 'ok';
    if (diffs.length || hs !== es) lines.push(`| ${sec.id} | ${what} | ${sm} |`);
  }
  return { ok, bad, table: ['| section | law counts per chapter | [n] markers |', '|---|---|---|', ...lines] };
}

/* ------------------------------------------------------------------ */

convertHebrew(originals(), 'he');
convertHebrew(pointed(), 'hen');
convertMarkdown();
const markerChanges = syncMarkers();
const index = buildIndex();
out.set('index.json', JSON.stringify(index, null, 1) + '\n');
out.set('.gitattributes', '* text=auto eol=lf\n*.htm -text\n*.js -text\n*.css -text\n*.txt -text\n');

fs.rmSync(opt.out, { recursive: true, force: true });
for (const [p, s] of out) {
  const full = path.join(opt.out, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
}

const al = alignmentReport(index);
const doc = [
  `# Migration report`,
  ``,
  `Source: \`${opt.repo}\` at \`${opt.ref}\` (${repo.rev()}). Files written: ${out.size}.`,
  ``,
  `## Alignment (Hebrew vs English)`,
  ``,
  `${al.ok} of ${al.ok + al.bad} sections line up law for law (counting ${Object.keys(KNOWN_MISALIGNED).length} known exceptions); ` +
  `${al.bad} unexpected mismatches. Listed below: sections whose law counts differ, or whose bracketed [n] ` +
  `sub-numbering differs between Hebrew and English (informational; it doesn't affect alignment).`,
  ``,
  ...al.table,
  ``,
  `## Content fixes`,
  ``,
  ...(report.length ? report : ['(none)']),
  ``,
  `## Bracketed [n] sub-numbers brought into line with the Hebrew`,
  ``,
  ...(markerChanges.length ? markerChanges.map(m => `- ${m}`) : ['(none)']),
  ``,
  `## Normalisations (per file)`,
  ``,
  ...Object.entries(warnings.reduce((m, [f, w]) => ((m[f] = m[f] || []).push(w), m), {}))
    .map(([f, ws]) => {
      // Group repetitive messages ("## 5" heading read as law 5, ×24) by shape.
      const groups = new Map();
      for (const w of ws) {
        const k = w.replace(/\d+/g, '#');
        if (!groups.has(k)) groups.set(k, { first: w, n: 0 });
        groups.get(k).n++;
      }
      return `- \`${f}\`\n` + [...groups.values()]
        .map(g => `  - ${g.first}${g.n > 1 ? ` (and ${g.n - 1} more like it)` : ''}`).join('\n');
    }),
  ``,
];
fs.writeFileSync(path.join(opt.out, 'REPORT.md'), doc.join('\n'));
console.log(`wrote ${out.size} files to ${opt.out}`);
console.log(`alignment: ${al.ok} ok, ${al.bad} mismatched — see REPORT.md`);
