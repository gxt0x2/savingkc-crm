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
const workspaceFrame = read('src/components/conversations/workspace-frame.tsx');
const cockpitModal = read('src/components/ui/cockpit-modal.tsx');

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
  globals.includes('.theme-light .lead-cockpit') && globals.includes('--ck-text: #0b1220'),
  'Theme guard failed: cockpit light theme text tokens are missing.'
);

assert(
  workspaceFrame.includes('data-theme={theme}') &&
    workspaceFrame.includes("aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}"),
  'Theme guard failed: rebuilt CRM workspace must expose and apply the persisted theme preference.'
);

assert(
  globals.includes('.crm-workspace-shell[data-theme="dark"]') &&
    globals.includes('html.dark .crm-modal-surface'),
  'Theme guard failed: rebuilt workspace and portaled modal dark tokens are missing.'
);

assert(
  cockpitModal.includes('className={`crm-modal-surface') && !cockpitModal.includes('overflow-hidden ck-dark'),
  'Theme guard failed: portaled cockpit modal must inherit the active document theme.'
);

assert(
  !appShell.includes('TC_LIGHT_THEME') &&
    !appShell.includes('useTcLightTheme') &&
    !globals.includes('.tc-portal'),
  'Theme guard failed: Closing Coordination must inherit the shared CRM theme without a legacy compatibility wrapper.'
);

for (const relPath of [
  'src/app/(app)/dispo/pipeline/page.tsx',
  'src/app/(app)/dispo/tc/page.tsx',
  'src/app/(app)/dispo/offers/page.tsx',
  'src/app/(app)/dispo/deals/page.tsx',
  'src/app/(app)/dispo/broadcasts/page.tsx',
  'src/app/(app)/dispo/contacts/page.tsx',
  'src/components/dispo/buyers-view.tsx',
  'src/components/dispo/vendors-view.tsx',
  'src/components/dispo/assignment-preview-modal.tsx',
  'src/components/dispo/edit-offer-modal.tsx',
  'src/components/dispo/new-offer-modal.tsx',
]) {
  const source = read(relPath);
  assert(
    !/#[0-9a-f]{3,8}\b/i.test(source),
    `Theme guard failed: ${relPath} reintroduced a hard-coded color instead of a shared CRM token.`
  );
  assert(
    !/var\(--ck-/.test(source),
    `Theme guard failed: ${relPath} reintroduced a legacy cockpit token instead of a shared CRM token.`
  );
}

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
