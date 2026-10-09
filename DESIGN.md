---
name: "Bright Pocket VPN — Operational Ledger"
description: "A warm, precise ledger system shared by the customer storefront, usage analytics, and private admin operations."
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
    fontSize: "1.75rem"
    fontWeight: 850
    lineHeight: 1.1
    fontVariation: "'wdth' 82, 'wght' 800"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Anybody, ui-rounded, 'Avenir Next', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 800
    lineHeight: 1.2
    fontVariation: "'wdth' 82, 'wght' 800"
  measurement:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 900
    lineHeight: 1.15
rounded:
  action-link: "8px"
  control: "10px"
  button: "12px"
  chart: "14px"
  panel: "16px"
  feature: "24px"
  hero: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "14px"
  xl: "18px"
  2xl: "20px"
  3xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.action-purple}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10px 14px"
    height: "44px"
  button-prominent:
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
    padding: "10px 14px"
    height: "44px"
  field:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.plum-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "48px"
  workspace-tab-active:
    backgroundColor: "{colors.action-purple}"
    textColor: "{colors.pure-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    height: "44px"
  metric-tile:
    backgroundColor: "{colors.offer-yellow}"
    textColor: "{colors.plum-ink}"
    typography: "{typography.measurement}"
    rounded: "{rounded.button}"
    padding: "12px 14px"
  surface-panel:
    backgroundColor: "{colors.ledger-paper}"
    textColor: "{colors.plum-ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
---

# Design System: Bright Pocket VPN Operational Ledger

## Overview

**Creative North Star: "The Bright Pocket Operational Ledger"**

Bright Pocket turns VPN purchase, device management, and usage analytics into one warm, legible ledger. Cream is the workspace, paper surfaces hold the record, purple identifies structure and action, and yellow makes selected offers or key measurements easy to find. The visual language is colorful without becoming ornamental: every field, control, number, and chart exists to help a customer understand service or an administrator complete a targeted operation.

The customer storefront, customer dashboard, and private admin intentionally share this system. Their density changes with the job: persuasive customer surfaces may use large compressed statements and generous fields; customer analytics becomes calmer and explanatory; private admin is the densest, most task-first expression, using desktop tables where comparison benefits and cards when the viewport narrows. Shared identity never means identical composition.

Visual convergence does not change product boundaries. Customer identity and VPN data remain private, analytics appears only for eligible profiles, and admin actions must preserve the live VPN through targeted operations rather than implying or requiring a broad restart or interface reload.

**Key Characteristics:**

- Cream canvas, paper work surfaces, purple structure/actions, and yellow metrics/emphasis.
- Anybody reserved for brand, headings, navigation, and actions; system UI for body, tables, fields, timestamps, and measurements.
- Compact 12–16px operational curves, flat tonal grouping, and sparse soft elevation on customer promotional objects.
- Desktop tables for dense comparison; responsive record cards and stacked analytics below tablet widths.
- Charts with real timestamp spacing, explicit max/zero/time context, redundant line styles, and complete text summaries.
- Controls at least 44px high, visible focus, semantic status text, and reduced-motion behavior.

## Colors

The palette is a warm operational ledger: purple carries intent, yellow carries attention, and semantic colors stay tied to real system state.

### Primary

- **Action Purple:** Primary buttons, active workspace navigation, selected range controls, upload series, progress, and the pocket mark.
- **Anchor Purple:** Structural headings, outlined control text, download series, proof fields, and the deeper counterpoint to Action Purple.

### Secondary

- **Offer Yellow:** Customer offers, count badges, and usage summary tiles. It highlights known facts, not decoration.

### Tertiary

- **Success Green:** Connected and successful states.
- **Error Red:** Failures, rejection, and destructive actions.
- **Ready Green:** The customer landing-page readiness indicator only.

### Neutral

- **Pocket Cream:** The shared customer and admin canvas.
- **Ledger Paper:** Panels, cards, dialogs, tables, chart plots, and menus.
- **Plum Ink:** Default text and data.
- **Quiet Plum:** Explanations, timestamps, labels, and secondary facts.
- **Lavender Line:** Table rows, fields, chart containers, and quiet separation.
- **Pure White:** Field fills and text on purple controls.

### Named Rules

**The Yellow Is a Fact Rule.** Yellow marks an offer, count, summary, or other high-value fact; it is never ambient decoration.

**The Status Means Status Rule.** Green and red communicate connection, success, failure, or destructive intent and never substitute for brand color.

**The Two-Purple Chart Rule.** Upload uses solid Action Purple; download uses dashed Anchor Purple. Labels and the text summary repeat the distinction so color is never the only key.

## Typography

**Display Font:** Anybody (with ui-rounded and Avenir Next fallbacks)

**Operational Font:** system-ui (with the native Apple and Segoe UI stacks)

**Customer Body Fallback:** ui-rounded / Avenir Next where already established

**Character:** Anybody supplies the pocket-shaped, compressed confidence of the brand, but it is rationed to brand, headings, navigation, and actions. Dense records, form values, chart labels, timestamps, tables, and measurements use the platform system face so operators can scan quickly and customers can read data without typographic friction.

### Hierarchy

- **Display:** Short storefront promises only; tightly compressed and never used in admin data regions.
- **Headline:** Persuasive customer section statements.
- **Title:** Admin workspace titles, analytics headings, dialogs, cards, and profile names.
- **Body:** Instructions, explanations, status sentences, table values, form content, and chart summaries.
- **Label:** Buttons, navigation, field labels, badges, table headings, and small structural captions.
- **Measurement:** Usage totals, peak speeds, connected time, quota, and other numeric results; heavy weight with tabular numerals where alignment matters.

### Named Rules

**The Brand on the Frame Rule.** Anybody belongs on the frame—brand, headings, navigation, and actions—not inside the data being operated on.

**The Numbers Stay Native Rule.** Measurements, timestamps, IP addresses, quotas, and table values use system UI with tabular numerals where available; do not introduce decorative monospace merely to look technical.

## Layout

The public customer shell is capped at 1160px; the private admin workspace expands to 1800px so dense records can be compared without premature truncation. Both use the cream canvas, paper surfaces, and a clear heading-to-content sequence. Customer analytics sits after profile cards as one wide paper panel. Admin analytics is a dedicated workspace with customer/profile selectors, time-range controls, summary tiles, status or recovery messaging, and a chart in that order.

Use tables on wide admin screens when columns support comparison and action. The VPN table may hold a wide minimum width inside a named scrolling region; customer lists remain simpler. At 1100px and below, admin records transform into labeled cards rather than forcing the page itself to overflow. At 760px and below, headers stack, selector grids collapse, metrics become two columns, dialogs tighten, and range controls use an even grid. At the narrowest widths, customer metrics may become one column while admin metrics remain a compact two-column ledger when labels still fit.

Charts use elapsed timestamp spacing, not equal index spacing, whenever valid chronological timestamps exist. The plot is paired with a maximum/baseline label above and start/midpoint/end labels below. Summary metrics and a prose figure caption make the same meaning available without interpreting the SVG.

Operational spacing is compact: 4–14px within controls or record rows, 18–28px between groups, and 14–20px panel padding. Customer persuasive surfaces may expand beyond this rhythm, but operational analytics should not inherit marketing-scale whitespace. All controls maintain at least a 44px target and layouts must avoid horizontal page overflow.

**The Table Until It Stops Helping Rule.** Keep a table while side-by-side comparison is faster; switch the record to labeled cards before density becomes horizontal friction.

**The Context Around the Plot Rule.** A chart is incomplete without scale, zero baseline, time range, timezone-aware labels, legend, state text, and a prose summary.

## Elevation & Depth

Operational surfaces are predominantly flat. Cream, paper, yellow, purple, borders, and spacing establish hierarchy; admin tables, analytics panels, metric tiles, and dialogs do not need decorative shadow. The customer storefront may use a soft plum-tinted lift for a small number of proof, plan, or profile objects, while customer analytics stays closer to the flat admin treatment.

### Shadow Vocabulary

- **Feature Lift:** A broad, soft plum shadow for the customer connection proof and primary customer panels.
- **Ledger Lift:** A restrained plum shadow for customer plan or profile cards.
- **Focus Halo:** A solid purple outline with cream separation on light operational surfaces; this is interaction feedback, not elevation.

### Named Rules

**The Flat Operations Rule.** Tables, metric tiles, charts, navigation, and dialogs rely on tonal fields and borders at rest; do not make every record float.

## Shapes

Controls use compact curves: fields and workspace tabs use the smallest operational radius, buttons and metric tiles step up slightly, and panels/dialogs use the medium radius. Pills are reserved for genuinely compact status. The pocket mark remains the only custom silhouette: a purple pocket with a yellow check-like stitch.

Outlines are functional. Secondary actions use a 2px deep-purple outline; inputs and selectors use a 2px lavender border that turns purple on focus; charts use a quiet lavender boundary. Operational surfaces stay level. The slight rotation used by the customer landing proof never enters analytics, admin tables, dialogs, forms, or metric cards.

**The Straight Workflow Rule.** Data, controls, charts, tables, and dialogs remain level; tilt belongs only to the isolated customer proof object.

## Components

### Buttons

- **Primary:** Action Purple, white Anybody label, compact padding in admin and roomier padding on customer calls to action.
- **Secondary:** Transparent fill, Anchor Purple label, and a 2px outline; it keeps the same minimum target as primary.
- **Hover / Focus:** A slight brightness change on hover and a clearly offset purple outline on keyboard focus. Disabled controls retain their label but visibly recede.
- **Danger:** Error Red is reserved for reject, delete, or other destructive actions and must use explicit text.

### Workspace Navigation and Range Controls

- **Workspace Navigation:** Horizontal, scrollable, and sparse. The active destination is filled Action Purple with white text and `aria-current`; inactive items remain transparent with an optional pale-lavender hover.
- **Range Controls:** Equal-weight 1h, 1d, 7d, 10d, 30d, and Lifetime choices. The selected range uses the same purple/white active treatment and exposes `aria-pressed`.
- **Overflow:** Admin navigation may expose a labeled More/Previous control; never hide destinations without a reachable control.

### Cards / Containers

- **Operational Panel:** Ledger Paper, medium curve, compact padding, no resting shadow.
- **Metric Tile:** Offer Yellow with a small deep-purple label and a heavy system-font measurement.
- **Customer Profile:** Paper card with plan/status, quota meter, fact list, and one clear plan action.
- **Responsive Record Card:** Below the admin table breakpoint, every table cell exposes its label before the value; primary identity and connection state lead.

### Inputs / Fields

- **Style:** White fill, Plum Ink, 2px Lavender Line, compact curve, 48px minimum height.
- **Focus:** Purple border plus a visible purple halo; keep the global keyboard focus intact.
- **Labels:** Persistent labels precede fields. Placeholder text never carries the only instruction.
- **Error / Disabled:** Pair semantic styling with explicit nearby text and preserve readable contrast.

### Tables

Table headers are small, heavy, quiet-plum labels; body values use system UI and compact row padding. Borders divide records without boxing every cell. Measurements and identifiers use tabular numerals. The table container is a labeled, keyboard-focusable scroll region whenever its minimum width exceeds the viewport.

### Usage Chart

The chart is a native SVG on a white or paper plot. Upload is a solid purple line; download is a dashed deep-purple line. Points use actual timestamp distance when timestamps are valid. The chart always names maximum and zero baseline, shows start/midpoint/end time context, provides a text legend, and updates both `<desc>` and a visible summary. Single-point ranges show dots; empty, loading, error, and zero-data states remain explicit and readable.

### Dialogs

Dialogs sit on a plum translucent backdrop, use Ledger Paper, retain visible headings and close actions, and scroll internally when their content exceeds the viewport. Order approval, QR replacement, user creation, and password changes remain separate recoverable tasks with their own state messages.

### Status and Feedback

Connection dots, status badges, count badges, loading text, empty states, errors, and success messages supplement—not replace—plain language. Analytics retry stays adjacent to the error. After an admin mutation, update the affected record and status without presenting a full VPN or interface restart as normal workflow.

## Do's and Don'ts

### Do:

- **Do** use this shared ledger language across customer and private admin surfaces, adjusting density to the job rather than creating a separate admin brand.
- **Do** use Anybody only for brand, headings, navigation, and actions; keep body, tables, fields, timestamps, and measurements in system UI.
- **Do** preserve exact plan, quota, speed, duration, payment, transfer, and connection facts.
- **Do** pair every usage chart with max/zero/time context, solid-versus-dashed series, accessible SVG naming, and a visible text summary.
- **Do** keep controls at least 44px, keyboard focus visible, status understandable without color, and motion removable.
- **Do** use targeted, recoverable admin feedback that preserves live VPN availability and customer privacy.

### Don't:

- **Don't** reintroduce the legacy dark admin theme or fork admin into an unrelated visual system; its distinction comes from density and task priority.
- **Don't** use gradients, glass effects, decorative blur, gratuitous shadow, or marketing-scale display type inside operational data.
- **Don't** space chart points equally when valid timestamps are available or omit the zero baseline, time context, timezone, legend, or textual equivalent.
- **Don't** turn a desktop table into horizontal page overflow on smaller screens; transform records into labeled cards when comparison no longer helps.
- **Don't** expose customer analytics outside the eligible profile boundary or let an admin control imply a broad VPN restart/reload.
- **Don't** invent benchmarks, testimonials, server-location claims, payment imagery, or other unsupported product facts.
