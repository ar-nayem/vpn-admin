---
name: "Bright Pocket VPN — Customer Storefront"
description: "A warm payment-ledger system that makes VPN trials, plans, payments, and device continuity feel clear and friendly."
colors:
  pocket-cream: "#fff8e8"
  ledger-paper: "#fffdf7"
  offer-yellow: "#f8d928"
  action-purple: "#6d28d9"
  anchor-purple: "#30105f"
  plum-ink: "#24113f"
  quiet-plum: "#705f80"
  lavender-line: "#dfd1e9"
  success-green: "#16794d"
  error-red: "#b42335"
  ready-green: "#22c55e"
  pure-white: "#ffffff"
typography:
  display:
    fontFamily: "Anybody, ui-rounded, 'Avenir Next', sans-serif"
    fontSize: "clamp(3rem, 7vw, 6rem)"
    fontWeight: 860
    lineHeight: 0.92
    letterSpacing: "-0.04em"
    fontVariation: "'wdth' 72, 'wght' 860"
  headline:
    fontFamily: "Anybody, ui-rounded, 'Avenir Next', sans-serif"
    fontSize: "clamp(2.3rem, 5vw, 4.8rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 82, 'wght' 800"
  title:
    fontFamily: "Anybody, ui-rounded, 'Avenir Next', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.15
    fontVariation: "'wdth' 82, 'wght' 800"
  body:
    fontFamily: "ui-rounded, 'Avenir Next', Avenir, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Anybody, ui-rounded, 'Avenir Next', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 900
    lineHeight: 1.2
    fontVariation: "'wdth' 82, 'wght' 800"
rounded:
  control: "10px"
  button: "12px"
  compact-surface: "14px"
  card: "16px"
  inset: "18px"
  feature: "24px"
  hero: "28px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "28px"
  3xl: "36px"
components:
  button-primary:
    backgroundColor: "{colors.action-purple}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.anchor-purple}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
    height: "44px"
  field:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.plum-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
    height: "48px"
  surface-card:
    backgroundColor: "{colors.ledger-paper}"
    textColor: "{colors.plum-ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  selected-tab:
    backgroundColor: "{colors.action-purple}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
---

# Design System: Bright Pocket VPN Customer Storefront

## Overview

**Creative North Star: "The Bright Pocket Payment Ledger"**

Bright Pocket turns a technical VPN purchase into a colorful, legible ledger: cream paper is the desk, yellow fields hold the offer, and purple controls move the customer forward. Compressed, oversized type creates confidence without resorting to generic security imagery; compact rounded surfaces and plain body copy keep the experience approachable.

The system serves both persuasion and operation. Landing surfaces may be bold and editorial, while authentication, checkout, tracking, and dashboard surfaces become calmer and denser without changing their palette, type, controls, or friendly voice. Exact prices, quotas, speeds, terms, and device continuity always outrank decoration.

This document applies only to the customer storefront in `storefront/public`. The existing administrator interface in `public` is a separate dark operating system and must remain visually unchanged.

**Key Characteristics:**

- Cream-paper canvas with borderless yellow, purple, and deep-purple fields.
- Compressed Anybody display type paired with an unforced system body face.
- Ticket-like plan rows, soft offset depth, and compact 10–28px curves.
- Direct language, exact numbers, 44px minimum targets, and visible purple focus.
- One restrained status pulse; all motion disappears when reduced motion is requested.

## Colors

The palette is a warm paper ledger punctuated by optimistic yellow and decisive purple, with semantic colors reserved for real status.

### Primary

- **Action Purple:** The default action, selected state, progress fill, and strongest interactive signal.
- **Anchor Purple:** A deeper structural color for proof panels, process bands, outlined controls, and high-contrast grounding.

### Secondary

- **Offer Yellow:** The offer field, plan emphasis, callout slip, and action color when the surrounding surface is purple.

### Tertiary

- **Success Green:** Confirmed success text only.
- **Error Red:** Error and failure text only.
- **Ready Green:** The small live-readiness indicator, never a decorative accent.

### Neutral

- **Pocket Cream:** The customer-page canvas.
- **Ledger Paper:** Cards, panels, inset device surfaces, and menus.
- **Plum Ink:** Default text and the legible counterpart to yellow.
- **Quiet Plum:** Supporting copy and secondary facts.
- **Lavender Line:** Input, payment-choice, QR, and footer separation.
- **Pure White:** Text on purple actions and the clearest field fill.

### Named Rules

**The Three-Ink Ledger Rule.** A large promotional field uses one dominant field color, one text color, and at most one contrasting action color; it does not become a rainbow.

**The Status Means Status Rule.** Green and red communicate readiness, success, or failure and never substitute for brand accents.

## Typography

**Display Font:** Anybody (with ui-rounded and Avenir Next fallbacks)  
**Body Font:** ui-rounded / Avenir Next (with Avenir and Segoe UI fallbacks)

**Character:** Anybody is intentionally compressed, heavy, and slightly playful—the typography does the expressive work that stock VPN imagery would otherwise do. The system body face keeps operational copy and form instructions familiar and highly readable.

### Hierarchy

- **Display:** The landing promise only; tightly compressed, dense, and limited to a short line length.
- **Headline:** Section and page statements, using the same compressed voice at a calmer scale.
- **Title:** Plan names, component headings, and proof-panel titles.
- **Body:** Explanations, instructions, and operational content; keep long supporting copy near 60 characters per line.
- **Label:** Buttons, tabs, badges, field labels, and compact facts; heavy weight supplies emphasis without forced all-caps.

### Named Rules

**The Promise, Then Proof Rule.** Use display type for one plain-language promise; move exact limits and procedural detail into body, label, and numeric styles immediately below it.

**The No Security Theater Rule.** Do not compensate for weak hierarchy with uppercase warnings, pseudo-technical monospace, shields, maps, flags, or padlock clichés.

## Layout

Customer pages use a centered shell capped at 1160px with 16px side gutters on standard screens. The landing hero is a two-column yellow field: persuasive copy leads, while a compact proof object demonstrates device continuity. Repeated plan rows behave like ledger entries rather than isolated marketing tiles.

At 760px and below, two-column layouts collapse to one column, plan actions span their row, navigation becomes a disclosure menu, and panels tighten while preserving their hierarchy. At 360px and below, gutters reduce again, plan rows become single-column, and primary/secondary hero actions stack full width. Never introduce horizontal page overflow; large type, buttons, fields, payment choices, and data grids must shrink or reflow within the viewport.

Operational pages use the same shell with a clear page head followed by one primary panel or responsive profile grid. Favor the established 8px-based rhythm, using tighter 8–16px gaps inside controls and 20–36px padding inside surfaces. Minimum interactive height is 44px; text fields are slightly taller.

**The One Job Per Field Rule.** Each large color field has one dominant job: offer, proof, process, summary, or action. Do not nest competing promotional compositions inside it.

## Elevation & Depth

Depth is soft and offset, used to separate operational objects from the paper canvas—not to make every surface float. Feature proof panels receive the strongest plum-tinted ambient shadow; plan and profile cards use quieter versions. Yellow, purple, and deep-purple sections rely primarily on tonal contrast and remain borderless.

### Shadow Vocabulary

- **Feature Lift:** A broad, soft plum shadow for the tilted connection proof and focused operational panels.
- **Ledger Lift:** A restrained plum shadow for plan and profile rows.
- **Focus Halo:** A translucent purple outline with an offset around the active keyboard target; it is accessibility feedback, not ambient elevation.

### Named Rules

**The Lift Only Objects Rule.** Apply shadow to contained objects customers manipulate or inspect; full-width color bands and the page canvas remain flat.

## Shapes

The system uses compact, friendly curves rather than capsules everywhere. Inputs begin with the control radius, buttons use a slightly larger curve, cards use a medium curve, and the landing feature field uses the largest curve. Pills are reserved for short status or category labels. The pocket mark is the one custom silhouette: a vertical purple pocket with a yellow check-like stitch.

Outlines are purposeful: secondary actions use a strong deep-purple outline, while fields and choices use a quieter lavender stroke. Major colored surfaces stay borderless. Small rotations belong only to the landing proof object and its yellow upgrade slip; operational panels remain level.

**The Straight Workflow Rule.** Tilt may make a proof object feel tactile, but never tilt forms, payment controls, data summaries, or dashboard cards.

## Components

### Buttons

- **Shape:** Compact rounded rectangle with at least a 44px target.
- **Primary:** Action purple with white heavy text; on purple plan cards, invert to offer yellow with plum ink.
- **Hover / Focus:** Darken slightly on hover and show a prominent translucent-purple focus halo with offset. Disabled controls remain legible but visibly subdued and lose the pointer cursor.
- **Secondary:** Transparent fill, deep-purple text, and a 2px outline. It is a real alternative action, not faint tertiary text.

### Chips

- **Style:** Compact rounded labels with pale lavender fill and deep-purple text; bright yellow may label a promotional preview.
- **State:** Selected tabs switch to action purple with white text. Pills communicate compact status or mode, not long instructions.

### Cards / Containers

- **Corner Style:** Medium curves for plan, profile, and operational cards; larger feature curves are reserved for the landing proof.
- **Background:** Ledger Paper at rest, with yellow, action purple, and anchor purple used for deliberate plan progression and feature grouping.
- **Shadow Strategy:** Use Feature Lift or Ledger Lift according to prominence; do not stack multiple shadows.
- **Border:** None on cards; use tonal contrast and depth.
- **Internal Padding:** Generous but compact, most often one to two spacing steps above control padding.

### Inputs / Fields

- **Style:** White fill, plum ink, a 2px lavender border, and the control curve. Labels sit above fields in heavy type.
- **Focus:** Shift the border to action purple and add a soft purple halo. Keep the global keyboard focus visible.
- **Error / Disabled:** Pair semantic color with explicit status text. Do not rely on border color alone.

### Navigation

The pocket mark and heavy wordmark anchor the left side. Desktop navigation uses plain heavy links with one purple action; mobile replaces the link cluster with a 44px disclosure target and a raised paper menu. The navigation remains sparse—plans, tracking, identity, and the primary action only.

### Plan Ledger

Plans are wide ledger rows, not interchangeable pricing cards. Each row keeps name/monthly rate, total term price, total quota/speed, and the action visually distinct. Their ordered yellow–purple–deep-purple progression is a signature device; all facts remain exact and the action stays high contrast on every field.

### Connection Proof

The landing proof nests a level paper device card inside a slightly rotated deep-purple frame, then uses a counter-rotated yellow slip to state that an upgrade keeps the same VPN file. Preserve the “promise outside, proof inside” hierarchy and disable the status pulse under reduced motion.

## Do's and Don'ts

### Do:

- **Do** use the Bright Pocket ledger system only for customer pages under `storefront/public`.
- **Do** lead with exact plan totals, quota, speed, duration, payment state, and device continuity.
- **Do** maintain the yellow–purple–deep-purple plan progression where all three plans appear together.
- **Do** preserve 44px minimum targets, semantic controls, visible focus, non-color status text, and reduced-motion behavior.
- **Do** keep persuasive pages expressive and operational pages calmer while sharing the same tokens and components.

### Don't:

- **Don't** restyle, token-share with, or visually merge the existing dark admin interface in `public`; it is an intentionally separate unchanged system.
- **Don't** introduce maps, flags, server claims, speed benchmarks, testimonials, payment imagery, or other unsupported VPN marketing tropes.
- **Don't** replace exact terms with vague superlatives or hide plan math behind decorative pricing cards.
- **Don't** use gradients, glass effects, heavy borders, or shadows on every surface.
- **Don't** overuse pills, rotations, status colors, or animation; each is reserved for a specific role.
