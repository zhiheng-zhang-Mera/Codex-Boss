# checkpoint-1 §14–§17, §19, §24, §26 — Theme Generator, Preview & Visual Verification (CP5)

Plan of record: `Update-Plan/checkpoint-1.md` §14 (prompt workflow), §15 ("see
the UI first"), §16/§16.1 (visual capture + privacy), §17 (preview sandbox), §19
(generation boundary), §24 (theme ↔ knowledge), §25 (TH-04/05/06) and §26 (theme
visual regression).

Status: **implemented, wired into the running app, and accepted by its own
reproducible gate.** With CP5 the whole §25 theme acceptance is green:
`pnpm run acceptance:theme` → 21 items, 0 FAIL, 0 NOT_RUN.

---

## 1. What was built

### 1.1 Theme Intent Parser — `src/shared/theme-intent.ts` (pure)

§14's first step. A natural-language style request becomes a structured intent in
which **every signal carries the phrase that produced it**:

| Axis | Examples it recognises |
| --- | --- |
| reference style | macOS, Windows 11/acrylic, VS Code, terminal, cyberpunk, paper, Notion, Linear, glassmorphism, brutalist, retro |
| temperature | 偏冷 / cool, 偏暖 / warm |
| lightness | 深色 / dark, 浅色 / light |
| translucency | 半透明, 磨砂, 毛玻璃, glass, blur — plus *adjustments* ("再透明一些" raises the strength, "不要那么透明" lowers it) |
| density | 紧凑 / compact, 宽松 / spacious |
| radius | 直角 / sharp, 微圆 / soft, 圆角更大 / rounded, 胶囊 / pill |
| typography | 圆体, 等宽 / mono, 衬线 / serif, 无衬线 / sans |
| contrast | 高对比 / high, 柔和 / subtle |
| accent | a named hex (`#22d3ee`) is used **literally**; a tone word (青/蓝/紫/…) selects a hue *direction* |
| preserve | 保持 / 保留 / 不要改 … |

§19 is enforced here: a request that moves, removes, adds or re-lays-out
interface elements (or touches IPC/shortcuts/drag behaviour, or asks for a
rewrite) is **escalated**, not themed. Each escalation names the phrase and the
reason, so the caller can turn it into a UI Engineering Task. ("去掉半透明" is a
style request; "去掉设置按钮" is not — the patterns require an interface element.)

A revision is parsed with `previous`, so unchanged axes are inherited and only the
mentioned one moves. The intent's `trace` is the audit of the parse.

### 1.2 Theme Generator — `src/shared/theme-generation.ts` (pure)

§15 is a hard precondition, not a convention: `generateThemeDraft` **throws**
without the current theme's tokens and the §9 contract table — it cannot write CSS
from a sentence alone.

Deterministic derivation, with a decision record per token (§24):

- lightness → a readable neutral ramp (root/surface/elevated/border/texts/code/
  scrollbar/backdrop/shadow), not a colour inversion;
- temperature/tone/named accent → accent, muted accent, readable `on-accent` and a
  tinted elevated surface;
- translucency → per-layer alpha (canvas stays most opaque), `--boss-blur`,
  `--boss-opacity`;
- density → `--boss-space-1..4`, `--boss-spacing-density`, line height;
- radius → the three radius tokens; typography → the font stack;
- contrast preference → text lightness, then a bounded **readability repair** loop
  that raises contrast against each background until it clears 4.5:1 (so a style
  shift can never ship unreadable text — the repairs are reported).

Surface overrides are emitted only for surfaces in the contract table and only
with properties that surface allows; the §20 validator then runs unchanged. The
output is a complete, self-contained package (§11): nothing is inherited at
runtime.

### 1.3 Preview sandbox — `ThemeService.startPreview/acceptPreview/cancelPreview`

§17 in the engine, not in the UI:

- `startPreview` validates the draft, writes it to `<theme-root>/.preview/`
  (`package.json` + rendered `preview.css`) and to a durable `preview.json`, and
  records the intent, decision count, capture summary and revision counter. **The
  registry and the active theme are not touched** — previewing cannot install.
- Replacing the pending preview of the same draft increments `revisions` (§14's
  feedback loop), and the counter survives a restart (§47).
- `acceptPreview({activate})` re-reads the previewed bytes, installs through the
  normal gate and (by default) activates; a preview that no longer validates is
  refused.
- `cancelPreview` deletes the draft and leaves the active theme untouched.

The renderer applies a preview in its **own** `<style>` element
(`src/renderer/theme.ts: applyPreview`), so preview and active theme never
conflict and cancelling leaves no trace.

### 1.4 Visual capture — `electron/theme/visual-capture.ts` (§16/§16.1)

Before designing, the app captures the current interface: the main window plus
every open AI pane, each with a **sanitized capture mode** applied first
(message text, input values, selects and media are visually removed), then the
frame is taken, then the mode is removed. Frames + a `captures.json` index
(surface, file, bytes, sha256, size) are written under
`<userData>/.boss/theme-captures/<timestamp>/`. A closed view is recorded in
`skipped` — never silently dropped, never a reason to fail the request.

### 1.5 Visual regression — `src/shared/theme-visual-check.ts` (§26)

The renderer **measures** (`src/renderer/theme-measure.ts`: per-surface box,
visibility, computed text/background colours, scroll metrics, control states) and
the pure checker **decides**, with a machine-readable rule per finding:
`MAJOR_SURFACE_VISIBLE`, `TEXT_READABLE` (measured contrast: ERROR below 3:1,
WARN below the surface's requirement), `CONTROLS_VISIBLE`, `MODAL_USABLE`,
`SIDEBAR_USABLE`, `INPUT_USABLE`, `SCROLLING_USABLE`,
`NO_CATASTROPHIC_OVERFLOW` (>24px overflow WARN, >200px ERROR),
`NO_TRANSPARENT_ON_TRANSPARENT`. The decision is stored at
`.boss/theme-visual-check.json`.

### 1.6 Theme ↔ Knowledge — `electron/theme/theme-knowledge.ts` (§24)

The intent, the derived tokens/overrides, the user's feedback text and the
validation outcome (including which `/surface.property` combinations were refused)
are committed through the **CP2 write gate** as host-verified knowledge objects
(`THEME`, `THEME_VALIDATION`, `USER_OVERRIDE`). What is deliberately **not**
stored is any image: only the capture *summary* travels into knowledge, and the
sanitized frames stay in their own directory.

### 1.7 Wiring and UI

Six IPC surfaces (`boss:theme-generate|preview|preview-revise|preview-accept|
preview-cancel|capture|visual-check`), the §56 events `THEME_DRAFT_CREATED` /
`THEME_PREVIEWED` (and the earlier `THEME_INSTALLED`/`THEME_ACTIVATED`/
`THEME_FALLBACK`), and a real generator panel in the settings surface: prompt box,
draft card (references, capture summary, decisions, readability repairs, validation
errors/warnings), preview actions (accept & activate / install only / cancel),
feedback box, per-theme list actions, visual-check button and a sanitized capture
button.

## 2. Acceptance

`pnpm run acceptance:theme` — 21 items, **all PASS**, 0 NOT_RUN:

| Item | What it proves |
| --- | --- |
| TH-01…TH-03, TH-07…TH-15, T-TOKENS | the CP4 engine (unchanged, still green) |
| **TH-04** | a prompt produces a complete, valid, self-explaining package that installs and activates |
| **TH-05** | previewing registers nothing and leaves the active theme untouched; cancel discards it; the preview differs from the active theme |
| **TH-06** | a follow-up message revises the draft (inheriting unchanged axes), the revision counter advances and the durable preview records it |
| T-GEN | determinism (same intent ⇒ same package hash), completeness, per-token explanations, override containment |
| T-BOUNDARY | four layout/behaviour prompts escalate with phrase + reason and produce no package |
| T-CAPTURE | sanitized in/out, real PNG + index with hashes, closed views reported as skipped |
| T-VISUAL | healthy theme passes; an unreadable/collapsed/overflowing one fails with the right rules |
| T-KNOWLEDGE | intent, feedback and validation reach knowledge; no image data does |

The desktop black box's second phase now drives the whole loop in the restarted
real app: prompt → draft → preview layer (active theme untouched) →
natural-language revision → visual check → accept & activate → restore default,
with the generated theme durably registered (**89/89 claims**).

Unit coverage: `tests/unit/theme-generator.test.ts` (24 cases).

## 3. Honest limitations (not over-claimed)

- **Intent parsing is lexical, not semantic.** It recognises a fixed bilingual
  vocabulary; a style request phrased outside it produces "no usable style signal"
  rather than a guess. A model may later propose an intent, but it must arrive as
  the same structure and pass the same validation (§2.3).
- **The generator derives from the active theme, not from image understanding.**
  The sanitized captures are recorded as design evidence and stored for review; the
  colour maths is deterministic token derivation. No vision model reads them.
- **Only surfaces with observed bindings can receive overrides.** A surface the
  CP3 registry reports as unbound (e.g. `SCROLLBAR` before CP4's rule) is silently
  skipped by the generator — by design, but it means a generated theme can leave a
  surface untouched.
- **The visual check measures the browser's computed layout, not pixels.** It
  cannot see a visual clash that the numbers do not describe (two surfaces sharing
  one colour evenly, for instance).
- **Capture privacy is visual, not forensic.** Text and input values are hidden
  before the frame is taken, but a screenshot is still an image of the user's
  workspace chrome; the frames are kept locally under `.boss/theme-captures/` and
  are never committed or written into knowledge.
- **The generator's own capability gaps are not yet fed into CP11's improvement
  loop.** If a prompt cannot be interpreted, the current answer is an honest "no
  usable style signal" — recording that as a `CapabilityGap` belongs to CP11.
