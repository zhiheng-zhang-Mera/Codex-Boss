# checkpoint-1 §10–§13, §20–§25 — Theme Engine Foundation (CP4)

Plan of record: `Update-Plan/checkpoint-1.md` §8 (the theme module split), §10
(theme token system), §11 (theme independence), §12 (permanent built-ins), §13
(custom theme lifecycle), §20 (validator), §21 (runtime safety), §22 (deletion
safety), §23 (registry record) and §25 (theme acceptance).

Status: **implemented, wired into the running app, and accepted by its own
reproducible gate** (`pnpm run acceptance:theme`, also a CI step).

---

## 1. What was built

### 1.1 The package contract — `src/shared/theme.ts` (pure)

A theme is a **self-contained package** (§11): `manifest` + `tokens` +
`overrides` + optional `css` + `metadata`, and nothing else. There is no
`extends`, no import and no runtime reference to another theme, so deleting one
theme can never break another; `derivedFrom`/`metadata.basedOn` are recorded as
provenance only. Duplicating a built-in *materializes* a complete copy.

The module also owns the §5-style lifecycle vocabulary
(`DRAFT · PREVIEW · VALIDATING · INSTALLED · ACTIVE · DISABLED · INVALID ·
QUARANTINED`), the §23 `ThemeRecord` shape, and two *plans* the host is required
to follow rather than re-derive:

- `planActivation` (§21) — an invalid, quarantined, disabled, stale-hash or
  missing theme can never become active; the built-in default takes over and the
  reason/code is returned.
- `planThemeDeletion` (§22) — the exact step order
  `VERIFY_NOT_BUILT_IN → (SWITCH_FALLBACK | KEEP_ACTIVE) → UNREGISTER →
  DELETE_PACKAGE → VALIDATE_REMAINING`, with built-ins refused.

### 1.2 The validator — §20

Every rule the plan lists, evaluated deterministically against the §9 contract
table, with a machine-readable diagnostic per finding:

| Rule | What it catches |
| --- | --- |
| `SCHEMA` | bad id/name/version/type, `builtIn` disagreeing with the type, a deletable built-in, missing metadata |
| `REQUIRED_TOKENS` | any of the eight tokens the product needs to be readable |
| `UNKNOWN_TOKEN` | a token outside the §10 `--boss-*` vocabulary |
| `UNSUPPORTED_PROPERTY` | a property the surface's contract does not allow, or an unknown surface |
| `LAYOUT_OVERFLOW` | an attempt to reposition/resize a LAYOUT/CANVAS surface |
| `BROKEN_REFERENCE` | a `var()` pointing at an undeclared token |
| `TOKEN_CYCLE` | a self-reference or a cycle among the package's tokens |
| `INVALID_CSS` | unbalanced braces/parentheses in the stylesheet |
| `UNSAFE_URL` / `EXTERNAL_IMPORT` / `FILESYSTEM_ESCAPE` | `url(http…)`, `@import`, absolute/`file:`/`..` URLs |
| `SCRIPT_INJECTION` | `<script`, `</style`, `javascript:`, `expression(`, `behavior:`, `-moz-binding`, `on*=`, `document.`, `window.`, `eval(`, `new Function(`, `require(` — in the stylesheet, in an override value **and in a token value**, since all three reach the document |
| `CRITICAL_CONTRAST` | WCAG contrast of text on each surface (ERROR below 3:1, WARN below the pair's own requirement) |
| `STARTUP_STABILITY` | a package that cannot be loaded safely |
| `BUILT_IN_INTEGRITY` | a built-in whose bytes no longer match the shipped hash |

`ok` is false if any diagnostic is an ERROR, and the report records the content
hash that passed — so a record can prove *what* was validated.

### 1.3 Storage, registry and service — `electron/theme/*`

- `theme-storage.ts` writes one directory per theme (`theme.json`,
  `tokens.json`, `overrides.json`, `metadata.json`, optional `overrides.css`),
  refuses any id that would escape the theme root (§20 filesystem escapes), and
  reads a corrupt or oversized package as a validation failure instead of a
  crash.
- `theme-service.ts` is the §8 Theme Manager + §23 Registry: `bootstrap()`
  materializes/refreshes both built-ins and proves the persisted active theme is
  still usable, `install()` runs the gate (a failing package is registered
  `QUARANTINED` so it stays visible), `activate()` re-validates from disk before
  trusting anything, `update()` re-validates every edit and keeps the previous
  revision when the edit breaks the theme, `disable()`/`rename()`/`duplicate()`
  implement §13, and `delete()` follows the §22 plan step by step.

### 1.4 The two built-ins — §12

`electron/theme/builtin-themes.ts` ships Light and Dark as complete packages
flagged `BUILT_IN`, `builtIn: true`, `deletable: false`, validated by the same
§20 rules as any user theme (no exemption). **Dark's token values are the values
the application already rendered**, so activating Dark is visually a no-op apart
from two hairlines whose shipped literals differ by ≤ 2/255 per channel from the
shared `--boss-border` token.

### 1.5 The token layer in the shipped UI — §10

`src/renderer/styles.css` now consumes eight §10 tokens
(`--boss-bg-root`, `--boss-bg-surface`, `--boss-text-primary`, `--boss-border`,
`--boss-font-family`, `--boss-scrollbar-thumb`, `--boss-scrollbar-track`,
`--boss-radius-sm`) with the shipped literal as the `var()` fallback, and adds
the scrollbar rules that close the CP3 `SCROLLBAR` gap. Declarations whose token
value would visibly differ from the shipped literal were deliberately **not**
migrated (composer background, attachment button, code panel): the honest state
is "the token layer exists and drives the canvas, surfaces, text, borders and
scrollbars", not "every surface is themed".

The renderer applies the active theme through one dedicated `<style>` element
(`src/renderer/theme.ts`), with its own last-line-of-defence check against
executable content, and a `ThemePanel` (`src/renderer/components/ThemePanel.tsx`)
inside the settings surface: list, activate, duplicate, delete, restore default,
plus the engine's diagnostics.

### 1.6 Production wiring

`electron/main.ts` builds the theme service in the composition root, runs
`bootstrap()` before the window is usable, and exposes the §8 surface over IPC
(`boss:theme-snapshot|activate|duplicate|delete|restore-default|validate`).
The UI surface registry that themes are validated and rendered against is
discovered from **the application's own sources** (`ensureUiSurfaces()`), not from
the user's workspace — a correction to the CP3 wiring, where the registry was
built from the task workspace. The task path now reads the persisted registry
instead of rebuilding a model inside the dispatch. §56's theme events
(`THEME_INSTALLED`, `THEME_ACTIVATED`, `THEME_FALLBACK`, …) were added to the
domain-event vocabulary.

## 2. Acceptance

`pnpm run acceptance:theme` runs `tests/acceptance/theme-engine.test.ts` and
verifies `artifacts/acceptance/theme-engine.json`.

| Item | What it proves | Observations |
| --- | --- | --- |
| TH-01 / TH-02 | both built-ins load, validate, activate and reach the renderer payload | 7/7, 5/5 |
| TH-03 | a built-in cannot be deleted and the registry stays intact | 4/4 |
| TH-07 | a custom theme registers as a complete, independent package | 6/6 |
| TH-08 | a custom theme is editable, activatable, and its tokens reach the stylesheet | 6/6 |
| TH-09 / TH-10 | deleting an inactive custom theme; deleting the active one switches to the fallback first | 5/5, 6/6 |
| TH-11 | a broken theme is quarantined, never activated, and the active theme is untouched | 7/7 |
| TH-12 | deleting one theme leaves the others working | 5/5 |
| TH-13 | a restart restores the active valid theme | 4/4 |
| TH-14 | an invalid theme on disk falls back safely at startup | 5/5 |
| TH-15 | a theme cannot modify business logic (no allow-listed property can hide/move a control; code cannot be smuggled in) | 8/8 |
| T-TOKENS | the shipped stylesheet and the engine agree on the §10 vocabulary, with literal fallbacks everywhere | 6/6 |
| TH-04 / TH-05 / TH-06 | prompt-driven creation, preview-before-install and feedback revision | **NOT_RUN** — CP5 |

The desktop WorkBook black box gained a second phase that verifies the theme
engine in the real, restarted Electron app: the registry survives, the canvas
token is the restored theme's value, activating Light through the real panel
changes the computed `--boss-bg-root` to `#f4f6f2` and the rendered shell
colour, Dark restores it, and the layout does not overflow (77/77 claims).

Unit coverage: `tests/unit/theme-engine.test.ts` (29 cases).

## 3. Honest limitations (not over-claimed)

- **TH-04/05/06 are NOT_RUN.** Prompt → intent → tokens, the preview sandbox and
  natural-language feedback revision are CP5. CP4 provides the mechanism CP5 will
  drive (`install`, `update`, `validate`, `renderThemeCss`).
- **Only the canvas, surfaces, text, borders and scrollbars are tokenized.** The
  remaining §9 surfaces (cards, inputs, buttons, badges, modals, code panel, AI
  panes) still carry shipped literals; migrating them is a styling change that
  belongs with the generator work, and the acceptance says so rather than
  implying full coverage.
- **`--boss-shadow`, `--boss-blur`, `--boss-spacing-density` and most spacing
  tokens are declared but unused by the stylesheet.** They are part of the
  contract so a theme may set them, but nothing observes them yet.
- **The theme validator measures contrast on token pairs, not on the rendered
  pixels.** A theme can still produce a low-contrast combination that no token
  pair describes; visual regression is CP5's preview/capture work.
- **Harness note.** In the desktop black box, the renderer's DevTools endpoint
  was observed to disappear a couple of seconds after a rolled-back provider
  dispatch while the Electron process itself stayed up. That is why the theme
  phase runs as a second launch over the same data directory — which is
  stronger evidence anyway (it proves §48 restart persistence) — and why the
  harness now fails loudly when a debugger session is lost instead of exiting
  silently with no output. The underlying cause was not attributed.
