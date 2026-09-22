# MT Reader

A reader/editor for the Mishneh Torah translation project
([yaaqov22/mishneh-torah](https://github.com/yaaqov22/mishneh-torah)): Hebrew,
English, commentary and review notes side by side, law by law, with changes
submitted back to GitHub as a branch and pull request.

Same shape as cheshbon: a plain-JavaScript, offline-first PWA with no framework
and no build step, installable on desktop now and wrapped for Android
(Capacitor) later. No accounts: each reviewer pastes their own GitHub token.

## Status

- [x] **M0: format + migration.** `js/format.js` (parser/writer shared by app and
  tools), `tools/migrate.mjs`, `tools/test-format.mjs`.
- [x] **M1: read-only reader.** Table of contents, the three-column reader,
  settings, offline cache, service worker.
- [x] **Search** (brought forward from M4). Hebrew (either edition, vowel
  points ignored), English, commentary and notes, with layer and book filters.
- [x] **M2: editing and local drafts.** Edit mode, in-place editing of laws
  and notes, adding commentary and review notes (from a selected phrase or a
  button), drafts in IndexedDB, change markers with diffs and undo, and a
  Changes screen.
- [ ] M3: submitting to GitHub (branch, commit, pull request)
- [ ] M4: review workflow (branches, diffs, notes column, search)
- [ ] M5: PWA polish
- [ ] M6: Android shell

## Running it

No build step. Serve the folder over HTTP and open `index.html`.

- **Development:** `.claude/launch.json` runs `php -S 127.0.0.1:8150 -t ..`,
  which serves the whole repos folder. Open
  <http://127.0.0.1:8150/mt-reader/>. On localhost the app reads from the
  "local folder" source (`../mishneh-torah-migration/` by default), with no
  token and no caching, so edits to the files show on reload.
- **Against GitHub:** in Settings choose GitHub, set the branch
  (`format-migration` until that PR is merged), and paste a fine-grained
  personal access token with **Contents: read** on the repository. The repo is
  private, so reading needs one too. The token stays on the device.
- **Offline:** texts are cached in IndexedDB by git blob SHA as you read.
  Settings → *Download all texts* fetches the rest. The service worker caches
  the app itself. On localhost it only runs if you add `?sw=1`, and `?sw=0`
  removes it.

| URL | shows |
|---|---|
| `#/books` | table of contents |
| `#/read/1-1/3` | Foundations of the Torah, chapter 3 |
| `#/read/1-1/3/5` | same, scrolled to law 5 |
| `#/search/<query>` | search results; `/he.en.co~3~w` after it picks layers, book, whole words |
| `#/read/1-1/3/5/<query>` | law 5 with the query highlighted (where results lead) |
| `#/changes` | every draft on this device for the branch being read |
| `#/settings` | source, token, your name, offline, theme |

← and → move between chapters; / opens search.

**Editing.** The *Edit* chip in the chapter bar turns on edit mode: click a
law's Hebrew or English, or a note, to edit it in place, and use *+
commentary* / *+ review note* under any law. Selecting a phrase in a law (in
either mode) offers *Comment* and *Review note* with the phrase quoted and the
next free note number filled in; review notes are signed `**name** date -`
with the name from Settings. With niqqud on, the pointed Hebrew is what gets
edited. Text saves as you type; Ctrl+Enter or Esc closes the editor.

Every edit is checked by round trip (`js/edit.js`): the file is written,
parsed back, and must come back the same, so a paragraph that would turn
into a new law, heading or note is refused with the reason instead of saved.
Drafts are whole files, kept per branch in IndexedDB with the text they were
an edit of (the base for M3's merge). Changed laws and notes are marked in
the reader with *diff* and *undo*; the Changes screen lists them all. A draft
whose file has moved on upstream is flagged but kept as it is.

**Search** loads every section once per session (from the offline cache when
it can; on GitHub the first search downloads the texts, after which they are
kept) and scans it in memory: about 1.3 s to prepare, ~50 ms a query. All words
must appear in the same law; "quotes" make a phrase. Hebrew is matched with
vowel points and cantillation removed and maqaf as a space, against both
editions, so either spelling finds the law.

## Code layout

Plain scripts on a global `MT` namespace, loaded in dependency order by
`index.html` (the list must match `SHELL` in `sw.js`):

| file | role |
|---|---|
| `utils.js` | namespace, event bus, device settings (localStorage) |
| `format.js` | parser/writer for the text files; shared with the Node tools |
| `edit.js` | edits to parsed documents (laws, notes), change lists, word diff; shared with the Node tools |
| `icons.js`, `ui.js`, `markdown.js` | inline SVG icons, DOM helper and hash router, inline Markdown to DOM (never `innerHTML`) |
| `store.js` | IndexedDB (`blobs` by SHA, `kv`, `drafts`) |
| `github.js` | GitHub REST client |
| `source.js` | GitHub or local folder, and the offline cache |
| `drafts.js` | local edits, one whole file per draft, in IndexedDB |
| `library.js` | index and parsed sections, merged law by law, drafts applied; `lib.edit` |
| `editor.js` | the in-place textarea editor, autosaving |
| `books.js`, `reader.js`, `search.js`, `changes.js`, `settings.js` | the screens (search.js also holds the search engine) |
| `main.js` | boot, top bar, service worker |

## The file format

After migration the mishneh-torah repo holds five parallel layers per section
(`{book}-{section}`, e.g. `1-1`; `{book}-0` is a book's opening, `0-x` the
front matter):

| layer | path | example |
|---|---|---|
| Hebrew | `Hebrew/1-1-he.md` | `**א,ב** לפיכך אין אמיתתו…` |
| Hebrew with niqqud | `Hebrew/1-1-hen.md` | `**א,ב** לְפִיכָּךְ אֵין אֲמִתָּתוֹ…` |
| English | `Translation/1-1-en.md` | `1:2 Therefore, His truth…` |
| Commentary | `Commentary/1-1-en-c.md` | `[^6.2.1]: *There are seven such Names* - …` |
| Review notes | `Notes/1-1-notes.md` | same as commentary |

Chapters are `## <name>, Chapter N` (English) / `## <name> פרק X` (Hebrew). Every
law is keyed `chapter:law`, which lines the layers up. The full rules are in
the header of [js/format.js](js/format.js). A file is canonical exactly when
`write(parse(file)) === file`; the app only ever writes canonical files, so
edits produce minimal diffs. `Original/*.htm` (Mechon Mamre) and `Original/niqqud/*n.htm` (their pointed
edition) stay as the archival sources. The two Hebrew editions line up law
for law, but the pointed one uses defective spelling, so neither can be
derived from the other. The reader switches between them with the נִקּוּד chip.

## Tools

The tools need Node 16 or newer. None is on the PATH on this machine, so use the
one bundled with Visual Studio:

```bash
NODE="/c/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Microsoft/VisualStudio/NodeJs/win-x64/node.exe"
"$NODE" tools/migrate.mjs            # → out/migrated/ + out/migrated/REPORT.md
"$NODE" tools/test-format.mjs        # unit tests + corpus checks on out/migrated
"$NODE" tools/test-edit.mjs          # editing tests + a re-save check over the corpus (~30 s)
```

The pointed edition is read from Mechon Mamre's zip (`--niqqud in001.zip` by
default, gitignored here; it is archived in the text repo under
`Original/niqqud/`).

`migrate.mjs` reads the repo straight from git (`--repo ../mishneh-torah
--ref HEAD` by default), so uncommitted working-tree changes don't affect it.
It never writes to the repo. Landing the migration means copying
`out/migrated/*` onto a branch there and opening a PR.
`test-format.mjs --root <dir>` runs the corpus checks against any tree laid
out like the repo, including the repo itself once migrated.

Known Hebrew/English misalignments are listed in `KNOWN_MISALIGNED` in
[tools/lib.mjs](tools/lib.mjs).
