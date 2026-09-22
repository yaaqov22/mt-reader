// Shared helpers for the Node tools: load js/format.js (a browser-style IIFE)
// and read files from the mishneh-torah repo straight out of git, so a dirty
// working tree (e.g. CRLF-only changes) never leaks into the results.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import '../js/format.js';

export const F = globalThis.MT.format;
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..');

// Sections where Hebrew and English are known not to line up law for law, and
// why. The migration report and the tests both treat these as expected.
export const KNOWN_MISALIGNED = {
  '2-7': 'the English Order of Prayer so far covers sections 1–24 of the Hebrew\'s 63',
};

export function args(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    out[m[1]] = m[2] ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}

export function gitRepo(repo, ref) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 28 });
  return {
    ls: () => git('ls-tree', '-r', '--name-only', ref).toString('utf8').trim().split('\n'),
    buf: p => git('show', `${ref}:${p}`),
    text: p => git('show', `${ref}:${p}`).toString('utf8'),
    rev: () => git('rev-parse', '--short', ref).toString('utf8').trim(),
  };
}
