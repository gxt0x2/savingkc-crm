'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Click-to-edit overlay for the live preview at lp.savingkc.com/sell.
 *
 * Activates when ?edit=1 is in the URL. Walks the DOM, makes every visible
 * text block contentEditable, persists changes to localStorage, and lets the
 * user POST a snapshot to /api/sell-edits which writes a JSON sidecar I can
 * read later when porting copy back into SellLanding.tsx.
 *
 * Strictly a preview tool — does nothing in production unless the query
 * string is set.
 */
const TEXT_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'LI', 'BUTTON', 'A', 'SPAN', 'LABEL', 'SMALL', 'STRONG', 'EM',
  'BLOCKQUOTE', 'SUMMARY', 'FIGCAPTION', 'DIV',
])
const SKIP_SELECTOR = '#skc-edit-bar, #skc-edit-bar *, script, style, input, textarea, .material-symbols-outlined'

function hasDirectTextChild(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim().length > 0) return true
  }
  return false
}

function markEditable(root: HTMLElement) {
  let id = 1
  root.querySelectorAll('*').forEach((el) => {
    const html = el as HTMLElement
    if (html.closest('#skc-edit-bar')) return
    if (html.matches(SKIP_SELECTOR)) return
    if (!TEXT_TAGS.has(html.tagName)) return
    if (!hasDirectTextChild(html)) return
    if (html.dataset.skcEdit) return
    if (html.tagName === 'DIV') {
      const hasBlockChild = Array.from(html.children).some((c) =>
        /^(DIV|SECTION|HEADER|FOOTER|NAV|MAIN|ARTICLE|UL|OL|FORM)$/.test(c.tagName),
      )
      if (hasBlockChild) return
    }
    html.dataset.skcEdit = '1'
    html.dataset.skcId = 'skc-' + id++
    html.dataset.skcOriginal = html.innerText
  })
}

function subscribeToLocationChange(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange)
  return () => window.removeEventListener('popstate', onStoreChange)
}

function getEditModeSnapshot() {
  return new URLSearchParams(window.location.search).get('edit') === '1'
}

function getServerEditModeSnapshot() {
  return false
}

export function EditOverlay() {
  const active = useSyncExternalStore(
    subscribeToLocationChange,
    getEditModeSnapshot,
    getServerEditModeSnapshot,
  )
  const [editing, setEditing] = useState(true)
  const [status, setStatus] = useState('0 edits')

  useEffect(() => {
    if (!active) return

    const edits: Record<string, string> = JSON.parse(localStorage.getItem('skc-sell-edits') ?? '{}')

    const apply = () => {
      markEditable(document.body)
      document.querySelectorAll<HTMLElement>('[data-skc-id]').forEach((el) => {
        const id = el.dataset.skcId!
        if (edits[id] != null) el.innerText = edits[id]
      })
      refreshStatus()
      setEditMode(editing)
    }

    const refreshStatus = () => {
      const n = Object.keys(edits).length
      setStatus(`${n} edit${n === 1 ? '' : 's'}`)
    }

    const setEditMode = (on: boolean) => {
      document.body.classList.toggle('skc-edit-on', on)
      document.querySelectorAll<HTMLElement>('[data-skc-edit="1"]').forEach((el) => {
        if (on) el.setAttribute('contenteditable', 'true')
        else el.removeAttribute('contenteditable')
      })
    }

    const onInput = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-skc-id]')
      if (!el) return
      const id = el.dataset.skcId!
      const orig = el.dataset.skcOriginal ?? ''
      const cur = el.innerText
      if (cur === orig) delete edits[id]
      else edits[id] = cur
      localStorage.setItem('skc-sell-edits', JSON.stringify(edits))
      refreshStatus()
    }

    // While in edit mode, intercept link/button clicks inside editable
    // regions so users don't accidentally trigger navigation while editing.
    const onClick = (e: MouseEvent) => {
      if (!document.body.classList.contains('skc-edit-on')) return
      const target = e.target as HTMLElement | null
      if (target?.closest('#skc-edit-bar')) return
      const a = target?.closest('a, button')
      if (a && a.closest('[data-skc-id]')) e.preventDefault()
    }

    apply()
    // Watch for new DOM nodes (e.g., quiz step transitions) and re-mark them.
    const obs = new MutationObserver(() => apply())
    obs.observe(document.body, { childList: true, subtree: true })

    document.addEventListener('input', onInput, true)
    document.addEventListener('click', onClick, true)
    return () => {
      obs.disconnect()
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('click', onClick, true)
      document.body.classList.remove('skc-edit-on')
    }
  }, [active, editing])

  if (!active) return null

  const save = async () => {
    const payload: Record<string, { text: string; original: string }> = {}
    document.querySelectorAll<HTMLElement>('[data-skc-id]').forEach((el) => {
      const stored = JSON.parse(localStorage.getItem('skc-sell-edits') ?? '{}')
      const id = el.dataset.skcId!
      if (stored[id] != null) {
        payload[id] = { text: el.innerText, original: el.dataset.skcOriginal ?? '' }
      }
    })
    try {
      const r = await fetch('/api/sell-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.ok) {
        const j = (await r.json()) as { applied: number }
        setStatus(`saved ${j.applied} edits`)
      } else {
        setStatus('save failed')
      }
    } catch {
      setStatus('save error')
    }
  }

  const reset = () => {
    if (!confirm('Reset all edits? This clears your local changes.')) return
    localStorage.removeItem('skc-sell-edits')
    location.reload()
  }

  return (
    <div id="skc-edit-bar">
      <button type="button" className="toggle-btn" onClick={() => setEditing((v) => !v)} title="Toggle edit mode">
        EDIT: {editing ? 'ON' : 'OFF'}
      </button>
      <span className="skc-status">{status}</span>
      <button type="button" className="primary" onClick={save} title="Save changes to disk">
        Save
      </button>
      <button type="button" onClick={reset} title="Reset all edits">
        Reset
      </button>
      <style jsx global>{`
        #skc-edit-bar {
          position: fixed; top: 12px; right: 12px; z-index: 99999;
          display: flex; gap: 8px; align-items: center;
          background: #0a0a0b; color: #fff;
          padding: 8px 10px; border-radius: 999px;
          font: 600 13px/1 Inter, system-ui, sans-serif;
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
        }
        #skc-edit-bar button {
          appearance: none; border: 0; cursor: pointer;
          background: #1f1f24; color: #fff;
          padding: 8px 12px; border-radius: 999px;
          font: 600 13px/1 Inter, system-ui, sans-serif;
        }
        #skc-edit-bar button.primary { background: #da2524; }
        #skc-edit-bar button.primary:hover { background: #b81e1d; }
        #skc-edit-bar button:hover { background: #2a2a30; }
        #skc-edit-bar .skc-status { opacity: .7; padding: 0 4px; font-weight: 500; }
        body.skc-edit-on [data-skc-edit="1"] {
          outline: 1px dashed rgba(218,37,36,.45);
          outline-offset: 2px;
          cursor: text;
          transition: outline-color .15s ease;
        }
        body.skc-edit-on [data-skc-edit="1"]:hover {
          outline-color: #da2524;
          background: rgba(218,37,36,.06);
        }
        body.skc-edit-on [data-skc-edit="1"][contenteditable="true"]:focus {
          outline: 2px solid #da2524;
          outline-offset: 2px;
          background: rgba(245,165,36,.08);
        }
      `}</style>
    </div>
  )
}
