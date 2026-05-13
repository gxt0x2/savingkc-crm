import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

function filesUnder(relPath) {
  const base = path.join(root, relPath);
  const out = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
      } else if (/\.(tsx|ts|css)$/.test(entry)) {
        out.push(path.relative(root, abs));
      }
    }
  }

  walk(base);
  return out;
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

assert(
  globals.includes('.theme-light .lead-cockpit') && globals.includes('--ck-text: #111827'),
  'Theme guard failed: cockpit light theme text tokens are missing.'
);

for (const relPath of [
  'src/app/(app)/leads/[id]/page.tsx',
  'src/components/ui/collapsible-card.tsx',
  ...filesUnder('src/components/leads'),
]) {
  const source = read(relPath);
  assert(
    !/ck-microlabel[^'"`]*text-white/.test(source),
    `Theme guard failed: ${relPath} forces white cockpit microlabel text instead of --ck-text.`
  );
}

console.log('Theme guard passed: shared shell and cockpit theme tokens are safe.');
