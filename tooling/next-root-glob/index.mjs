import fs from 'node:fs';
import path from 'node:path';
import { walkSync } from '@nodelib/fs.walk';
import { expand } from 'brace-expansion';
import globParent from 'glob-parent';
import picomatch from 'picomatch';

// This is the single interface used by Next's get-root-dirs helper, not a
// general fast-glob replacement. The consumer guard rejects a changed API.
const matchOptions = { dot: false, posix: true, strictSlashes: false };
const clean = value => value.replace(/^\.\//, '');
const dynamic = value => picomatch.scan(value, { scanToEnd: true }).isGlob || /\\/.test(value);
const absent = error => error.code === 'ENOENT';
const isNegative = value => value.startsWith('!') && value[1] !== '(';
const isOutside = value => value.startsWith('..') || value.startsWith('./..');

function tasksFor(patterns) {
  const groups = new Map();
  for (const item of patterns) {
    const base = globParent(item, { flipBackslashes: false });
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(item);
  }
  // The previous task map used Object.keys: integer directory names precede
  // other keys numerically. Preserve that ordering without prototype keys.
  const ordered = Object.keys(Object.fromEntries(groups)).map(base => [base, groups.get(base)]);
  const outside = ordered.filter(([base]) => isOutside(base));
  const inside = ordered.filter(([base]) => !isOutside(base));
  return [...outside, ...(groups.has('.')
    ? [['.', patterns.filter(item => !isOutside(item))]] : inside)];
}

function canDescend(pattern, filepath) {
  const parts = clean(pattern).split('/');
  const entry = clean(filepath).split('/');
  const star = parts.findIndex(part => part.includes('**'));
  if (star !== -1 && entry.length > star) return true;
  if (star === -1 && entry.length >= parts.length) return false;
  return entry.every((part, index) => dynamic(parts[index]) ? picomatch(parts[index], matchOptions)(part) : parts[index] === part);
}

function globSync(pattern, options) {
  if (typeof pattern !== 'string' || pattern.length === 0 ||
      !options || options.onlyDirectories !== true ||
      Object.keys(options).some(key => key !== 'onlyDirectories')) {
    throw new TypeError('Next root glob supports a nonempty string and {onlyDirectories:true} only');
  }
  // rootDir is configuration. Reject excessive work explicitly rather than
  // letting a bounded expander silently truncate a lint root selection.
  if (pattern.length > 65536) throw new RangeError('Next root glob exceeds 65536 characters');
  let depth = 0;
  for (const character of pattern) {
    if (character === '{' && ++depth > 1000) throw new RangeError('Next root glob exceeds 1000 brace levels');
    if (character === '}') depth = Math.max(0, depth - 1);
  }
  // Published brace-expansion 5.0.12 bounds depth, rewrites, result count and
  // total output length. Stable length ordering matches Next's prior helper.
  const expanded = expand(pattern, { max: 1001 });
  if (expanded.length > 1000 || expanded.reduce((size, item) => size + item.length, 0) > 65536) {
    throw new RangeError('Next root glob expansion exceeds 1000 roots or 65536 characters');
  }
  const normalized = [...new Set(expanded)]
    .filter(Boolean).sort((a, b) => a.length - b.length)
    .map(item => item.replace(/(?!^)\/{2,}/g, '/'));
  const patterns = normalized.filter(item => !isNegative(item));
  const negatives = normalized.filter(isNegative).map(item => item.slice(1));
  const negativeMatches = negatives.map(item => picomatch(clean(item), { ...matchOptions, dot: true }));
  const deepNegatives = negatives.filter(item => item.endsWith('/**') || !dynamic(path.posix.basename(item)))
    .map(item => picomatch(clean(item), { ...matchOptions, dot: true }));
  const excluded = (item, matchers) => matchers.some(match => match(clean(item)) || match(clean(item) + '/'));
  const output = [];
  const seen = new Set();
  function add(item) {
    const key = clean(item);
    if (!seen.has(key)) { seen.add(key); output.push(item); }
  }
  // Static alternatives must precede dynamic traversal, including mixed braces.
  for (const [, items] of tasksFor(patterns.filter(item => !dynamic(item)))) for (const item of items) {
    try { if (fs.statSync(item).isDirectory() && !excluded(item, negativeMatches)) add(item); }
    catch (error) { if (!absent(error)) throw error; }
  }
  for (const [base, items] of tasksFor(patterns.filter(dynamic))) {
    const matches = items.map(item => picomatch(clean(item), matchOptions));
    const entries = walkSync(path.resolve(base), {
      basePath: base === '.' ? '' : base,
      pathSegmentSeparator: '/',
      followSymbolicLinks: true,
      throwErrorOnBrokenSymbolicLink: false,
      errorFilter: absent,
      // The walker visits descendants breadth first and excludes the task root.
      // Keep native readdir order and followed directory symlinks, as before.
      entryFilter: entry => entry.dirent.isDirectory() && !excluded(entry.path, negativeMatches) &&
        matches.some(match => match(clean(entry.path)) || match(clean(entry.path) + '/')),
      deepFilter: entry => !deepNegatives.some(match => match(clean(entry.path))) &&
        items.some(item => canDescend(item, entry.path)),
    });
    for (const entry of entries) add(entry.path);
  }
  return output;
}

export { globSync };
