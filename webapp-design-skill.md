---
name: webapp-design
description: >
  Craft beautiful, production-quality web apps and mobile-style apps that feel crafted by a world-class product design studio — not generated. Use this skill whenever the user asks to build any interactive app, tool, dashboard, mobile-style UI, game, calculator, form, or multi-screen experience. Trigger on words like "app", "webapp", "mobile app", "phone app", "UI", "interface", "dashboard", "tool", "build me", "make me an app", "screen", "product". This skill overrides generic code generation habits with a strict opinionated system that eliminates all visual slop: placeholder gradients, generic card grids, Lorem ipsum heroism, default shadows, and AI-tell animation patterns. If you are building anything interactive and visual, use this skill — even if the user doesn't mention design.
---

# Webapp & Mobile App Design — Anti-Slop System

You are the founding designer at a studio whose clients fire agencies that generate polished-looking slop. Every app you ship must feel **considered, specific, and alive** — not assembled from defaults.

Read this skill fully before writing a single line of code or CSS. The rules here override your instincts.

---

## 0. Before You Design: Identify the Product DNA

Before touching palette, type, or layout, answer these in a brief internal plan:

1. **What is this for?** (the actual use case — budgeting, fitness tracking, ambient music, etc.)
2. **Who uses it?** (describe a real person — not "users")
3. **What is the primary emotional register?** (calm/focused? playful/energetic? serious/precise?)
4. **What is the single screen the person will spend 90% of their time on?**

The answer to #4 is your hero surface. Design that screen obsessively. Everything else is secondary.

---

## 1. The Anti-Slop Checklist

Run through this before finalizing. If any box is unchecked, fix it.

### Typography — the #1 differentiator
- [ ] Font chosen for *this* product, not because it was the first import you thought of
- [ ] No `font-family: system-ui` or `sans-serif` fallback as the *primary* face
- [ ] No tracking (`letter-spacing`) on body text
- [ ] No ALL-CAPS labels anywhere unless the brand DNA absolutely requires it
- [ ] Type scale is not 12/14/16/20/24/32 — that is the slop scale; use the reference scale below
- [ ] One accent/display face maximum; body is neutral and readable
- [ ] Line-height on body is between 1.5–1.65; never 1 or 1.2

### Color — specific, not safe
- [ ] No `#F5F5F5` or near-white grey as background unless intentional
- [ ] No default blue (`#007AFF`, `#3B82F6`, `#4F46E5`) as primary accent unless explicitly requested
- [ ] No black text on white as the only contrast — something in the palette pushes color
- [ ] Background has *some* tint — even 2° of warmth or cool shifts the whole register
- [ ] Dark mode (if built): not `#111111` background + `#FFFFFF` text — use real dark surface tokens

### Layout — structure, not cards
- [ ] No grid of identical cards as the main UI pattern unless the content is genuinely card-shaped (products, contacts)
- [ ] No "feature grid" with icon + heading + 3-line paragraph × 6 (that is a landing page trope, not an app)
- [ ] No centered hero with gradient background + white headline + two CTA buttons as the app's main screen
- [ ] Whitespace is intentional — not uniform `gap: 24px` everywhere
- [ ] The layout has *hierarchy*: one element is the largest/heaviest/loudest

### Motion — earned, not sprinkled
- [ ] No `transition: all 0.3s ease` on everything
- [ ] No fade-in-up on every section scroll
- [ ] Hover states exist but are *subtle* — not the main design event
- [ ] If there's an entrance animation, there is at most **one** orchestrated sequence
- [ ] Loading states are designed, not a default spinner on white

### Content — real, not Lorem
- [ ] All copy is real and appropriate to the product — no "Lorem ipsum"
- [ ] Data in charts/tables is plausible and specific to the domain
- [ ] Empty states have direction: tell the user what to do, not just "Nothing here yet"
- [ ] Button labels are verbs: "Save meal", "Start timer", not "Submit" or "OK"

---

## 2. Type Scale (use this, not the defaults)

Pick ONE of these scales. Never mix scales.

**Scale A — Tight & Dense** (data apps, dashboards, tools)
```
10px / 0.9 — micro label
12px / 1.0 — caption
14px / 1.5 — body-sm
16px / 1.6 — body
20px / 1.3 — heading-sm
28px / 1.2 — heading
40px / 1.1 — display
```

**Scale B — Editorial & Spacious** (content, lifestyle, creative tools)
```
13px / 1.0 — caption
15px / 1.6 — body-sm
17px / 1.65 — body
22px / 1.3 — heading-sm
32px / 1.15 — heading
52px / 1.0 — display
```

**Scale C — Mobile-First, Touch-Friendly** (phone UIs, apps)
```
11px / 1.0 — tab label
13px / 1.4 — caption
15px / 1.55 — body-sm
17px / 1.6 — body
20px / 1.3 — heading-sm
26px / 1.2 — heading
38px / 1.05 — display
```

---

## 3. Color Token System

Always define colors as CSS custom properties. Never hardcode hex values in component styles.

```css
:root {
  /* Surfaces */
  --bg:          <base background>;
  --bg-raised:   <slightly elevated — cards, panels>;
  --bg-sunken:   <slightly recessed — inputs, wells>;
  --border:      <subtle separator>;

  /* Content */
  --text-primary:   <main text>;
  --text-secondary: <supporting text, ~60% contrast of primary>;
  --text-muted:     <disabled, placeholder, ~40%>;

  /* Accent */
  --accent:         <brand/primary action color>;
  --accent-hover:   <slightly darker/lighter>;
  --accent-subtle:  <tinted surface for active states>;

  /* Semantic */
  --success: ;
  --warning: ;
  --danger:  ;
}
```

**Palette generation rule**: Start from one hue that fits the product's emotional register. Build all surfaces by adjusting lightness only. Add one accent from a complementary or analogous hue. That's enough.

---

## 4. Mobile-Style Apps (phone / touch UIs)

When building mobile-style apps (the user says "phone app", "mobile", or the UI is narrow and touch-first):

### Shell
- Max width: `390px`, centered on desktop with a phone-shaped frame or just left-aligned
- Safe areas: `padding-bottom: env(safe-area-inset-bottom, 24px)` on the bottom bar
- Bottom navigation bar: 4–5 items max, icon + label, no nested hamburgers
- Top bar: title centered or left, back/close at left edge, primary action at right
- No floating action button unless the product genuinely needs one primary action

### Touch targets
- Every tappable element: minimum `44×44px`
- List rows: minimum `52px` tall
- Inputs: minimum `48px` tall, `border-radius` between `8–12px`
- Buttons: `48px` tall for primaries, `36px` for secondary/ghost

### Gestures
- Swipe-to-dismiss on modals (animate translate-Y)
- Pull-to-refresh on scrollable lists
- Long-press context menus (optional but adds depth)

### Navigation patterns
Choose one and be consistent:
- **Tab bar** (iOS-style): 4–5 top-level destinations, icons always visible
- **Drawer** (Android-style): hamburger reveals full nav list from left
- **Stack** (single flow): back arrow + title, no persistent nav

---

## 5. Desktop Web Apps

When building desktop/responsive web apps:

### Layout DNA options (pick one per app — don't mix)

**A. Sidebar + main content**
```
[nav sidebar 240px] | [main content area]
                    | [optional detail panel]
```
Good for: dashboards, file managers, settings-heavy tools

**B. Top bar + full canvas**
```
[top bar: logo | nav | actions]
[────────────────────────────]
[         canvas / content   ]
```
Good for: creative tools, editors, single-purpose utilities

**C. Command-centric**
```
[large search/command input at top]
[results / content below]
```
Good for: search tools, AI interfaces, reference apps

**D. Document-centric**
```
[narrow sidebar for doc list] | [document canvas, full width]
```
Good for: notes apps, writing tools, CRMs

### Responsiveness
- Mobile breakpoint: `< 640px` → collapse sidebar, stack layout
- Tablet: `640–1024px` → narrow sidebar or icon-only
- Desktop: `> 1024px` → full layout

---

## 6. Component Patterns (Opinionated Defaults)

### Inputs
```css
input, textarea, select {
  background: var(--bg-sunken);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 15px;
  color: var(--text-primary);
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
  outline: none;
}
```

### Primary Button
```css
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 20px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: background 0.12s, transform 0.1s;
}
.btn-primary:hover  { background: var(--accent-hover); }
.btn-primary:active { transform: scale(0.98); }
```

### Cards (use sparingly — only when content is genuinely card-shaped)
```css
.card {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  /* NO box-shadow by default — use border instead */
}
```

### List rows
```css
.list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}
.list-row:hover { background: var(--bg-raised); }
```

---

## 7. Microinteractions Worth Building

These make an app feel *real*. Build at least 2 of these per app:

- **Button press**: `transform: scale(0.97)` on `:active`, 80ms duration
- **Checkbox/toggle**: animate the thumb or checkmark, not just color
- **Input focus ring**: soft glow with `box-shadow`, not just border color
- **Success confirmation**: a brief green flash or checkmark icon on form submit
- **Delete/remove**: fade + slide-out before DOM removal
- **Count changes**: animate number changes with a brief scale pulse
- **Tab switch**: slide the active indicator with `transition: left 0.2s ease`
- **Loading skeleton**: shimmer animation instead of spinner for content loads

---

## 8. Dark Mode

Always support dark mode unless explicitly told not to.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg:           #141414; /* not pure black */
    --bg-raised:    #1e1e1e;
    --bg-sunken:    #0f0f0f;
    --border:       rgba(255,255,255,0.08);
    --text-primary: #f0f0f0; /* not pure white */
    --text-secondary: #a0a0a0;
    --text-muted:   #606060;
    /* accent often needs lightening in dark mode */
  }
}
```

---

## 9. Font Loading (HTML artifacts)

Always load from Google Fonts or use system fonts with intention. Never leave `font-family: sans-serif` as the final answer.

**Recommended pairings** (each has a distinct personality — don't use all of them):

| Pair | Character | Good for |
|------|-----------|----------|
| `Geist` (variable) | Precise, techy | Dev tools, dashboards |
| `Inter` + `Lora` | Clean body, editorial display | Content/lifestyle apps |
| `DM Sans` + `Fraunces` | Friendly + expressive | Consumer apps |
| `IBM Plex Sans` | Monospaced energy | Finance, data |
| `Outfit` | Rounded, modern | Mobile apps, friendly UIs |
| `Sora` | Geometric, clean | Productivity tools |

Load via `<link rel="preconnect">` + `<link href="https://fonts.googleapis.com/...">`.

---

## 10. Build Process

1. **State your design plan in 3 sentences** before the code block: palette, typeface, layout concept.
2. **Write all CSS as custom properties** — no magic numbers in component styles.
3. **Use semantic HTML** — `<nav>`, `<main>`, `<section>`, `<button>`, `<input>`, not all `<div>`.
4. **Build mobile-first** — start with the narrow layout, add desktop with `min-width` media queries.
5. **Review your output against the Anti-Slop Checklist** (§1) before delivering.
6. **If the brief is vague**, make a confident assumption, name it in one line, and build it — don't ask first.

---

## 11. What "Beautiful" Actually Means

Beautiful ≠ decorative. A beautiful app:

- Has a **clear visual hierarchy** — the eye always knows where to go next
- Has **breathing room** — space that is *proportional*, not uniform
- Has **contrast of weight** — one thing is heavy, others are light
- Has **material honesty** — surfaces feel like surfaces, not flat color applied to geometry
- Has **behavioral feedback** — the app responds to every intentional action

An app that is visually plain but has crisp hierarchy, responsive touch behavior, and correct spacing will always beat an app draped in gradients, glassmorphism, and animation.

**Choose one bold thing. Make it perfect. Make everything else serve it.**

---

## 12. Reference Files

For extended color palette generation, see `references/palettes.md`.
For complete typography specimens, see `references/typography.md`.
For common app layouts with full CSS, see `references/layouts.md`.

Read a reference file when you need to go deeper on that topic — the main SKILL.md has enough to build most apps without them.