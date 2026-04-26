import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const appShell = read('src/components/layout/app-shell.tsx');
const modeSwitcher = read('src/components/layout/mode-switcher.tsx');
const globals = read('src/app/globals.css');
const rootLayout = read('src/app/layout.tsx');

const forbiddenInShell = [
  'bg-white border-b border-slate-200',
  'bg-slate-100 hover:bg-slate-200',
  'w-72 bg-white shadow-2xl',
];

for (const token of forbiddenInShell) {
  assert(!appShell.includes(token), `Theme guard failed: found legacy light token in app shell: ${token}`);
}

assert(
  appShell.includes("background: 'var(--ck-surface)'") && appShell.includes("borderColor: 'var(--ck-border)'"),
  'Theme guard failed: app shell header must use ck dark surface tokens.'
);

assert(
  modeSwitcher.includes("background: 'var(--ck-surface-elev)'") && modeSwitcher.includes("text-[var(--ck-text)]"),
  'Theme guard failed: mode switcher must be tokenized for dark theme.'
);

assert(
  rootLayout.includes('className="ck-dark bg-background text-on-surface antialiased min-h-screen font-sans"'),
  'Theme guard failed: root body must include ck-dark class.'
);

assert(
  globals.includes('.ck-dark .bg-white') && globals.includes('.ck-dark .bg-slate-100'),
  'Theme guard failed: global dark overrides for neutral surfaces are missing.'
);

console.log('Theme guard passed: shared shell and tokens are dark-mode safe.');
