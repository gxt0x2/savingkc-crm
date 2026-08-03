# SavingKC CRM Brand Implementation Brief

## Authoritative sources

- Google Drive: `Saving KC Rebrand.pdf`
  - File ID: `1CWd3trtTTfc7cKOH-W32qJV0-IotcAoF`
  - Modified: 2024-08-21
- Product logo assets:
  - `public/logo.png`
  - `public/skc-logo.png`
  - `public/favicon.svg`

The repository folder `savingkc-marketing-ops/assets/brand` is currently empty. Legacy CSS colors are therefore implementation history, not a substitute for the brand brief.

## Brand promise

Saving KC Homebuyers should feel like a trusted, capable guide for homeowners navigating stressful transitions. The product should communicate:

- Inviting
- Hopeful
- Trusted
- Honest
- High integrity
- Direct without being cold
- Professional without feeling corporate or sterile

## Product UI interpretation

The CRM is an internal operating product, but it should still express the company brand. Brand expression should come through clarity, calm, language, and disciplined use of the identity—not through decorative marketing treatments.

### Color

- Preserve the approved red, black, and white identity.
- Use brand red for primary actions, active navigation, and intentional emphasis.
- Do not use red as a general information color; reserve it for brand emphasis, destructive actions, and genuine urgency with sufficient context.
- Use warm whites and restrained neutral surfaces so the interface feels approachable rather than clinical.
- Use green, amber, blue, and red as semantic colors with accessible text/icon reinforcement.
- Consolidate the current competing red values into named design tokens before rebuilding shared components.

### Typography

- Use a modern, warm, highly legible sans-serif.
- Optimize for fast scanning by operators and comfortable reading at smaller sizes.
- Avoid all-caps as a default; reserve it for short labels and operational metadata.
- Use weight and spacing for hierarchy before increasing type size.

### Logo

- Use the supplied Saving KC Homebuyers logo without redrawing or recoloring it ad hoc.
- Preserve its aspect ratio and clear space.
- Provide an approved compact mark for collapsed navigation rather than cropping the full wordmark.
- Use a light or dark container that maintains strong contrast around the logo.

### Shape and depth

- Favor quiet borders, clear grouping, and modest corner radii.
- Avoid excessive cards, pills, gradients, glass effects, and decorative shadows.
- Use depth only when it communicates overlays, drawers, menus, or focus.

### Imagery

- When imagery is useful, prefer authentic homes, local context, and real human moments.
- Avoid generic corporate stock imagery.
- Operational CRM views should not use imagery where it competes with lead data or next actions.

### Voice

Interface language should be reassuring, clear, direct, and specific.

Prefer:

- `Call Marcus by 2:30 PM`
- `Message not delivered — choose another approved number`
- `Appointment cancelled; future reminders stopped`

Avoid:

- `Engage contact`
- `Something went wrong`
- `Automation action executed`

## Accessibility requirements

- Meet WCAG AA contrast for text and interactive controls.
- Never rely on color alone for stage, health, urgency, or delivery state.
- Maintain visible keyboard focus.
- Use 44px minimum touch targets in mobile operating workflows.
- Respect reduced-motion preferences.
- Keep primary workflows usable at browser zoom up to 200%.

## Design-system work required

Before replacing the core screens:

1. Confirm the final approved brand-red value from the source artwork or formal palette.
2. Define light and dark surface tokens.
3. Define semantic status tokens separately from brand tokens.
4. Select and approve the product typeface.
5. Create approved full and compact logo components.
6. Build shared controls for buttons, fields, badges, tables, drawers, timelines, and empty/error states.
7. Validate the design system against Contacts, Conversations, Workflows, and the lead workspace before broad rollout.

## Acceptance test

A finished screen should feel unmistakably like Saving KC while allowing an operator to answer, within seconds:

1. Who needs attention?
2. What happened?
3. Who owns it?
4. What happens next?
5. Is the system healthy enough to complete that action?
