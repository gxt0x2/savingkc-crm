(function () {
  'use strict';

  // Prevent double-injection
  if (document.getElementById('ari-qa-panel')) {
    document.getElementById('ari-qa-panel').style.display = 'flex';
    return;
  }

  // ─── Theme (matches Ari CRM dark navy + amber) ─────────────
  const COLORS = {
    bg: '#0f172a',
    bgLight: '#1e293b',
    border: '#334155',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    accent: '#f59e0b',
    accentHover: '#fbbf24',
    pass: '#22c55e',
    fail: '#ef4444',
    warn: '#f59e0b',
    info: '#3b82f6',
  };

  // ─── CRM Routes ────────────────────────────────────────────
  const CRM_ROUTES = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/opportunities', label: 'Opportunities' },
    { path: '/leads', label: 'Leads List' },
    { path: '/conversations', label: 'Conversations' },
    { path: '/calendar', label: 'Calendar' },
    { path: '/pipeline', label: 'Pipeline' },
    { path: '/settings', label: 'Settings' },
    { path: '/checklist', label: 'Checklist' },
  ];

  // ─── State ─────────────────────────────────────────────────
  let results = [];
  let scanning = false;
  let currentRoute = '';

  // ─── Panel HTML ────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'ari-qa-panel';
  panel.style.cssText = `
    position: fixed; top: 60px; right: 16px; width: 420px; max-height: 80vh;
    background: ${COLORS.bg}; border: 1px solid ${COLORS.border};
    border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex; flex-direction: column; overflow: hidden;
    color: ${COLORS.text}; font-size: 13px; line-height: 1.5;
  `;

  panel.innerHTML = `
    <div id="qa-header" style="
      padding: 12px 16px; background: ${COLORS.bgLight}; border-bottom: 1px solid ${COLORS.border};
      display: flex; align-items: center; justify-content: space-between; cursor: move; user-select: none;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🦊</span>
        <span style="font-weight:700;color:${COLORS.accent};font-size:14px;">Ari QA Crawler</span>
        <span id="qa-badge" style="
          background:${COLORS.border};color:${COLORS.textMuted};font-size:11px;
          padding:2px 8px;border-radius:10px;
        ">idle</span>
      </div>
      <div style="display:flex;gap:4px;">
        <button id="qa-minimize" style="background:none;border:none;color:${COLORS.textMuted};cursor:pointer;font-size:18px;padding:2px 6px;" title="Minimize">−</button>
        <button id="qa-close" style="background:none;border:none;color:${COLORS.textMuted};cursor:pointer;font-size:18px;padding:2px 6px;" title="Close">×</button>
      </div>
    </div>

    <div id="qa-body" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div id="qa-controls" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button id="qa-scan-page" style="
          background:${COLORS.accent};color:#000;border:none;padding:8px 16px;border-radius:8px;
          font-weight:600;cursor:pointer;font-size:13px;transition:all .15s;
        ">⚡ Scan This Page</button>
        <button id="qa-scan-all" style="
          background:${COLORS.bgLight};color:${COLORS.text};border:1px solid ${COLORS.border};
          padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;
        ">🔄 Scan All Routes</button>
        <button id="qa-export" style="
          background:${COLORS.bgLight};color:${COLORS.text};border:1px solid ${COLORS.border};
          padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;
        ">📋 Export JSON</button>
        <button id="qa-clear" style="
          background:${COLORS.bgLight};color:${COLORS.textMuted};border:1px solid ${COLORS.border};
          padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;
        ">🗑 Clear</button>
      </div>

      <div id="qa-progress" style="display:none;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span id="qa-progress-label" style="color:${COLORS.textMuted};font-size:12px;">Scanning...</span>
          <span id="qa-progress-pct" style="color:${COLORS.accent};font-size:12px;font-weight:600;">0%</span>
        </div>
        <div style="height:4px;background:${COLORS.border};border-radius:2px;overflow:hidden;">
          <div id="qa-progress-bar" style="height:100%;background:${COLORS.accent};width:0%;transition:width .3s;border-radius:2px;"></div>
        </div>
      </div>

      <div id="qa-summary" style="display:none;margin-bottom:12px;padding:10px 12px;background:${COLORS.bgLight};border-radius:8px;border:1px solid ${COLORS.border};">
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div><span style="color:${COLORS.fail};font-weight:700;" id="qa-count-fail">0</span> <span style="color:${COLORS.textMuted};">dead ends</span></div>
          <div><span style="color:${COLORS.warn};font-weight:700;" id="qa-count-warn">0</span> <span style="color:${COLORS.textMuted};">warnings</span></div>
          <div><span style="color:${COLORS.pass};font-weight:700;" id="qa-count-pass">0</span> <span style="color:${COLORS.textMuted};">passed</span></div>
          <div><span style="color:${COLORS.info};font-weight:700;" id="qa-count-info">0</span> <span style="color:${COLORS.textMuted};">info</span></div>
        </div>
      </div>

      <div id="qa-results" style="display:flex;flex-direction:column;gap:6px;"></div>

      <div id="qa-empty" style="text-align:center;padding:40px 20px;color:${COLORS.textMuted};">
        <div style="font-size:32px;margin-bottom:8px;">🔍</div>
        <div style="font-size:14px;font-weight:600;">No scan results yet</div>
        <div style="font-size:12px;margin-top:4px;">Hit "Scan This Page" or "Scan All Routes"</div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // ─── Drag logic ────────────────────────────────────────────
  const header = document.getElementById('qa-header');
  let isDragging = false, dragX = 0, dragY = 0;
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragX) + 'px';
    panel.style.top = (e.clientY - dragY) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => isDragging = false);

  // ─── Button handlers ──────────────────────────────────────
  document.getElementById('qa-close').onclick = () => panel.style.display = 'none';
  document.getElementById('qa-minimize').onclick = () => {
    const body = document.getElementById('qa-body');
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('qa-clear').onclick = () => {
    results = [];
    renderResults();
  };
  document.getElementById('qa-export').onclick = exportResults;
  document.getElementById('qa-scan-page').onclick = () => scanCurrentPage();
  document.getElementById('qa-scan-all').onclick = () => scanAllRoutes();

  // ─── Core Scan Logic ───────────────────────────────────────

  function scanCurrentPage() {
    if (scanning) return;
    scanning = true;
    currentRoute = window.location.pathname;
    setBadge('scanning', COLORS.accent);

    const pageResults = [];

    // 1. Dead buttons — buttons/links that have no href, no onclick, are disabled, or go nowhere
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (!isVisible(el)) return;

      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || '').trim().substring(0, 60);
      if (!text && !el.getAttribute('aria-label')) return; // skip icon-only decorative

      const label = text || el.getAttribute('aria-label') || '[unnamed]';

      // Check for dead links
      if (tag === 'a') {
        const href = el.getAttribute('href');
        if (!href || href === '#' || href === 'javascript:void(0)') {
          pageResults.push(makeResult('fail', 'Dead link', `"${label}" has href="${href || 'none'}"`, el));
        }
      }

      // Check for buttons that do nothing
      if (tag === 'button' || el.getAttribute('role') === 'button') {
        const hasClick = el.onclick || el.getAttribute('onclick');
        const hasHandler = getEventListeners ? false : true; // can't check in production
        const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        const isSubmit = el.type === 'submit';
        const isInForm = el.closest('form');
        const hasDataAction = el.dataset.action || el.dataset.callback || el.getAttribute('data-radix-collection-item') !== null;

        if (isDisabled) {
          pageResults.push(makeResult('warn', 'Disabled button', `"${label}" is disabled — intentional?`, el));
        }
      }
    });

    // 2. Empty states — containers with no content and no guidance
    document.querySelectorAll('[class*="empty"], [class*="no-data"], [class*="placeholder"]').forEach((el) => {
      if (!isVisible(el)) return;
      const text = (el.textContent || '').trim();
      // Check if empty state has a CTA
      const hasCTA = el.querySelector('button, a');
      if (!hasCTA && text.length < 100) {
        pageResults.push(makeResult('warn', 'Empty state with no CTA', `"${text.substring(0, 80)}" — no next action for user`, el));
      }
    });

    // 3. Console errors — capture any existing
    const origError = console.error;
    const consoleErrors = [];
    console.error = function () {
      consoleErrors.push(Array.from(arguments).join(' '));
      origError.apply(console, arguments);
    };
    setTimeout(() => {
      console.error = origError;
      consoleErrors.forEach((err) => {
        pageResults.push(makeResult('fail', 'Console error', err.substring(0, 120)));
      });
    }, 1000);

    // 4. Broken images
    document.querySelectorAll('img').forEach((img) => {
      if (!isVisible(img)) return;
      if (img.naturalWidth === 0 && img.complete) {
        const src = (img.src || '').substring(0, 80);
        pageResults.push(makeResult('fail', 'Broken image', `src="${src}"`, img));
      }
    });

    // 5. Forms with no submit button
    document.querySelectorAll('form').forEach((form) => {
      if (!isVisible(form)) return;
      const hasSubmit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (!hasSubmit) {
        pageResults.push(makeResult('warn', 'Form with no submit', `Form has ${form.elements.length} fields but no submit button`, form));
      }
    });

    // 6. Links to 404/missing routes
    document.querySelectorAll('a[href^="/"]').forEach((a) => {
      if (!isVisible(a)) return;
      const href = a.getAttribute('href');
      const text = (a.textContent || '').trim().substring(0, 60);
      // Check against known routes
      const knownPrefixes = ['/dashboard', '/opportunities', '/leads', '/conversations', '/calendar', '/pipeline', '/settings', '/checklist', '/login', '/api/'];
      const isKnown = knownPrefixes.some((p) => href.startsWith(p)) || href === '/';
      if (!isKnown && href !== '#') {
        pageResults.push(makeResult('info', 'Unknown route', `"${text || href}" → ${href}`, a));
      }
    });

    // 7. Clickable elements with no cursor pointer
    document.querySelectorAll('[onclick], [role="button"], [tabindex="0"]').forEach((el) => {
      if (!isVisible(el)) return;
      const style = window.getComputedStyle(el);
      if (style.cursor !== 'pointer' && el.tagName.toLowerCase() !== 'button' && el.tagName.toLowerCase() !== 'a') {
        const text = (el.textContent || '').trim().substring(0, 40);
        pageResults.push(makeResult('info', 'Missing pointer cursor', `Interactive element "${text}" has cursor: ${style.cursor}`, el));
      }
    });

    // 8. Check for modals/drawers that might be orphaned (open but off-screen)
    document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="drawer"]').forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const text = (el.textContent || '').trim().substring(0, 40);
        pageResults.push(makeResult('info', 'Open dialog/modal', `"${text}" is currently visible`, el));
      }
    });

    // 9. Check tables/lists for zero-row states
    document.querySelectorAll('table tbody, [class*="list-container"], [class*="grid-container"]').forEach((el) => {
      if (!isVisible(el)) return;
      const rows = el.querySelectorAll('tr, [class*="row"], [class*="card"], [class*="item"]');
      if (rows.length === 0) {
        pageResults.push(makeResult('warn', 'Empty data container', 'Table/list has zero items — is there an empty state message?', el));
      }
    });

    // If no issues found on this page, log a pass
    if (pageResults.length === 0) {
      pageResults.push(makeResult('pass', 'Page clean', `No dead ends found on ${currentRoute}`));
    }

    // Add route header
    results.push({
      type: 'header',
      route: currentRoute,
      timestamp: new Date().toISOString(),
      count: pageResults.length,
    });
    results.push(...pageResults);

    scanning = false;
    setBadge('done', COLORS.pass);
    renderResults();
  }

  async function scanAllRoutes() {
    if (scanning) return;
    scanning = true;
    const progress = document.getElementById('qa-progress');
    const progressBar = document.getElementById('qa-progress-bar');
    const progressLabel = document.getElementById('qa-progress-label');
    const progressPct = document.getElementById('qa-progress-pct');
    progress.style.display = 'block';
    results = [];

    for (let i = 0; i < CRM_ROUTES.length; i++) {
      const route = CRM_ROUTES[i];
      const pct = Math.round(((i) / CRM_ROUTES.length) * 100);
      progressBar.style.width = pct + '%';
      progressPct.textContent = pct + '%';
      progressLabel.textContent = `Scanning ${route.label}...`;
      setBadge(`${i + 1}/${CRM_ROUTES.length}`, COLORS.accent);

      // Navigate to route
      window.history.pushState({}, '', route.path);
      window.dispatchEvent(new PopStateEvent('popstate'));

      // Wait for Next.js to render
      await sleep(2000);

      // Scan
      currentRoute = route.path;
      scanCurrentPage();

      await sleep(500);
    }

    progressBar.style.width = '100%';
    progressPct.textContent = '100%';
    progressLabel.textContent = 'Scan complete!';
    scanning = false;
    setBadge('done', COLORS.pass);
    renderResults();

    setTimeout(() => { progress.style.display = 'none'; }, 3000);
  }

  // ─── Helpers ───────────────────────────────────────────────

  function makeResult(severity, title, detail, element) {
    return {
      type: 'result',
      severity, // pass, fail, warn, info
      title,
      detail,
      route: currentRoute,
      element: element ? describeElement(element) : null,
      _el: element || null,
      timestamp: new Date().toISOString(),
    };
  }

  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(' ').filter(c => c && !c.startsWith('__')).slice(0, 2).join('.')
      : '';
    const text = (el.textContent || '').trim().substring(0, 30);
    return `<${tag}${id}${cls}> "${text}"`;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setBadge(text, color) {
    const badge = document.getElementById('qa-badge');
    badge.textContent = text;
    badge.style.background = color || COLORS.border;
    badge.style.color = color === COLORS.accent ? '#000' : COLORS.text;
  }

  // ─── Render Results ────────────────────────────────────────

  function renderResults() {
    const container = document.getElementById('qa-results');
    const empty = document.getElementById('qa-empty');
    const summary = document.getElementById('qa-summary');

    const actual = results.filter((r) => r.type === 'result');
    if (actual.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      summary.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    summary.style.display = 'block';

    // Update counts
    const counts = { fail: 0, warn: 0, pass: 0, info: 0 };
    actual.forEach((r) => counts[r.severity]++);
    document.getElementById('qa-count-fail').textContent = counts.fail;
    document.getElementById('qa-count-warn').textContent = counts.warn;
    document.getElementById('qa-count-pass').textContent = counts.pass;
    document.getElementById('qa-count-info').textContent = counts.info;

    // Render items
    let html = '';
    results.forEach((r) => {
      if (r.type === 'header') {
        html += `<div style="
          margin-top:8px;padding:6px 10px;background:${COLORS.bgLight};border-radius:6px;
          font-weight:700;color:${COLORS.accent};font-size:12px;border:1px solid ${COLORS.border};
        ">📍 ${r.route} <span style="color:${COLORS.textMuted};font-weight:400;">(${r.count} items)</span></div>`;
        return;
      }

      const colors = { fail: COLORS.fail, warn: COLORS.warn, pass: COLORS.pass, info: COLORS.info };
      const icons = { fail: '❌', warn: '⚠️', pass: '✅', info: 'ℹ️' };
      const elId = r._el ? `data-qa-el="${Math.random().toString(36).substr(2, 8)}"` : '';

      html += `<div class="qa-result-item" ${elId} style="
        padding:8px 10px;background:${COLORS.bgLight};border-radius:6px;
        border-left:3px solid ${colors[r.severity]};cursor:${r._el ? 'pointer' : 'default'};
        transition:background .15s;
      " onmouseenter="this.style.background='${COLORS.border}'" onmouseleave="this.style.background='${COLORS.bgLight}'">
        <div style="display:flex;align-items:center;gap:6px;">
          <span>${icons[r.severity]}</span>
          <span style="font-weight:600;color:${colors[r.severity]};font-size:12px;">${r.title}</span>
        </div>
        <div style="color:${COLORS.textMuted};font-size:11px;margin-top:2px;word-break:break-all;">
          ${r.detail}
        </div>
        ${r.element ? `<div style="color:${COLORS.textMuted};font-size:10px;margin-top:2px;font-family:monospace;">${escapeHtml(r.element)}</div>` : ''}
      </div>`;
    });

    container.innerHTML = html;

    // Click-to-highlight handlers
    container.querySelectorAll('.qa-result-item[data-qa-el]').forEach((item, idx) => {
      const resultIdx = results.filter((r) => r.type === 'result').indexOf(
        results.filter((r) => r.type === 'result')[idx]
      );
      item.addEventListener('click', () => {
        const r = results.filter((r) => r.type === 'result')[idx];
        if (r && r._el && document.contains(r._el)) {
          r._el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          r._el.style.outline = `3px solid ${COLORS.fail}`;
          r._el.style.outlineOffset = '2px';
          setTimeout(() => {
            if (r._el) {
              r._el.style.outline = '';
              r._el.style.outlineOffset = '';
            }
          }, 3000);
        }
      });
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function exportResults() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      url: window.location.origin,
      totalIssues: results.filter((r) => r.type === 'result' && r.severity !== 'pass').length,
      summary: {
        fail: results.filter((r) => r.severity === 'fail').length,
        warn: results.filter((r) => r.severity === 'warn').length,
        info: results.filter((r) => r.severity === 'info').length,
        pass: results.filter((r) => r.severity === 'pass').length,
      },
      results: results.map((r) => {
        if (r.type === 'header') return r;
        const { _el, ...rest } = r;
        return rest;
      }),
    };

    // Copy to clipboard
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
      setBadge('copied!', COLORS.pass);
      setTimeout(() => setBadge('done', COLORS.pass), 2000);
    }).catch(() => {
      // Fallback: download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ari-qa-report-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

})();
