import fs from 'node:fs'
import ts from 'typescript'

const files = [
  'src/app/(app)/calendar/page.tsx',
  'src/app/(app)/contacts/page.tsx',
  'src/app/(app)/conversations/page.tsx',
  'src/app/(app)/dashboard/page.tsx',
  'src/app/(app)/dispo/pipeline/page.tsx',
  'src/app/(app)/leads/[id]/page.tsx',
  'src/app/(app)/opportunities/page.tsx',
  'src/app/(app)/settings/page.tsx',
  'src/app/(app)/workflows/page.tsx',
  'src/components/documents/document-manager.tsx',
  'src/components/conversations/compose-box.tsx',
  'src/components/conversations/contact-details-panel.tsx',
  'src/components/conversations/inbox-sidebar.tsx',
  'src/components/conversations/message-bubble.tsx',
  'src/components/conversations/thread-view.tsx',
  'src/components/conversations/workspace-frame.tsx',
  'src/components/conversations/workspace-nav.tsx',
  'src/components/leads/activity-feed.tsx',
  'src/components/leads/ads-signal-receipt.tsx',
  'src/components/leads/ari-briefing.tsx',
  'src/components/leads/discovery-questions.tsx',
  'src/components/leads/email-thread.tsx',
  'src/components/leads/favorite-or-fool.tsx',
  'src/components/leads/lead-workspace.tsx',
  'src/components/leads/mail-tracker.tsx',
  'src/components/leads/pain-points.tsx',
  'src/components/leads/property-details-card.tsx',
  'src/components/marketing/ads-command-page.tsx',
]

const failures = []

function attributes(node, sourceFile) {
  return new Map(node.attributes.properties.flatMap((property) => {
    if (!property.name) return []
    return [[property.name.getText(sourceFile), property]]
  }))
}

function hasReadableText(node, sourceFile) {
  let readable = false
  function visit(child) {
    if (ts.isJsxText(child) && child.getText(sourceFile).trim()) readable = true
    if (ts.isJsxExpression(child) && child.expression && !ts.isObjectLiteralExpression(child.expression)) {
      const value = child.expression.getText(sourceFile)
      if (!value.startsWith('Icon') && value !== 'null') readable = true
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return readable
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  function fail(node, message) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    failures.push(`${file}:${line} ${message}`)
  }

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const tag = opening.tagName.getText(sourceFile)
      const attrs = attributes(opening, sourceFile)

      if (tag === 'button') {
        const type = attrs.get('type')?.getText(sourceFile) ?? ''
        const hasInteraction = ['onClick', 'onDragStart', 'onPointerDown', 'onKeyDown'].some((name) => attrs.has(name))
        if (!hasInteraction && !type.includes('submit') && !type.includes('reset') && !attrs.has('disabled')) {
          fail(opening, 'button has no action, submit behavior, or disabled state')
        }
        if (!attrs.has('aria-label') && !attrs.has('title') && !hasReadableText(node, sourceFile)) {
          fail(opening, 'icon-only button has no accessible name')
        }
      }

      if (tag === 'Link' || tag === 'a') {
        const href = attrs.get('href')?.getText(sourceFile) ?? ''
        if (!href) fail(opening, `${tag} is missing href`)
        if (href.includes("'#'") || href.includes('"#"') || href.endsWith('=#')) {
          fail(opening, `${tag} uses a placeholder # destination`)
        }
        const isApiResource = href.includes('/api/')
        if (tag === 'a' && !isApiResource && (href.includes('href="/') || href.includes('href={`/') || href.includes("href={'/"))) {
          fail(opening, 'internal navigation must use next/link')
        }
        if (!attrs.has('aria-label') && !attrs.has('title') && !hasReadableText(node, sourceFile)) {
          fail(opening, `${tag} has no accessible name`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (failures.length) {
  console.error('CRM control integrity failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`CRM control integrity passed for ${files.length} rebuilt interface files.`)
