# Tandem frontend architecture and styling

This guide describes the desktop frontend and provides conventions for future UI work. Sections marked **Current implementation** describe the renderer in this repository; **Design direction** and **Conventions** specify the intended result, not a claim that every existing screen already follows them.

**Design direction:** A clean, Cursor-like workspace that feels immediately familiar to Claude and Codex app users, with Claude's typography. Use restrained neutral surfaces, a quiet sidebar, a readable conversation, and a prominent composer. The renderer now implements this neutral dark theme; the exact Anthropic fonts remain an asset dependency, with local fallbacks in use.

The implementation snapshot includes the document/brief UI currently in the working tree; it does not imply those changes are released.

[ARCHITECTURE.md](ARCHITECTURE.md) owns system behavior, security, shared contracts, and the build plan. [README.md](README.md) owns setup, commands, and REST endpoints. Read this file before changing frontend structure or styling. Keep it updated when those decisions change; do not use it to override the Current MVP contracts.

## Stack and boundaries

**Current implementation:** Electron with electron-vite, React 18, strict TypeScript/ESM, and Tailwind CSS 3 through PostCSS. There is no router library, global state library, component library, or Markdown renderer in the desktop dependencies.

| Layer | Responsibility | Entry points |
|---|---|---|
| Main process | Window lifecycle, native menus, protocol links, encrypted token storage, settings, clipboard, notifications | `apps/desktop/src/main/index.ts`, `ipc.ts`, `menu.ts` |
| Preload | Narrow `window.tandem` bridge, including event subscriptions with cleanup callbacks | `apps/desktop/src/preload/index.ts` |
| Renderer | Screens, presentation, interaction state, REST requests, live updates | `apps/desktop/src/renderer/main.tsx` |
| Shared contracts | Domain types, request schemas, WebSocket frame/event types | `packages/shared/src/index.ts` |

The renderer calls the server directly through `fetch` and `WebSocket`. Native operations use the preload bridge. Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; never import Electron or Node APIs into renderer components. Packaged windows load bundled content; development uses the electron-vite renderer server.

Permissions, durable writes, AI routing, and broadcasts belong to server services. Frontend checks such as `canPost` explain available actions but never replace server authorization. The OpenRouter key stays on the server. Access-token persistence goes through the preload bridge; local storage currently holds only the guest device ID.

## Code organization

Paths below are relative to `apps/desktop/src/renderer/`.

| Path | Current responsibility |
|---|---|
| `main.tsx`, `index.css` | Mount React and load Tailwind plus global body styles |
| `components/Icon.tsx` | Shared monochrome SVG icons and the Tandem mark |
| `app/App.tsx` | Choose sign-in, home, session, or settings; receive native menu actions |
| `app/AuthContext.tsx` | Restore identity, guest/GitHub sign-in, code exchange, sign-out |
| `features/auth/SignIn.tsx` | Sign-in forms and loading/error feedback |
| `features/sessions/Home.tsx` | List, create, join, and open sessions |
| `features/chat/SessionView.tsx` | Session data, branch selection, event handling, timeline, composer, branching, sharing; contains `MessageRow` |
| `features/chat/MessageTreePanel.tsx` | Derive and draw the SVG message tree from fetched branch paths |
| `features/chat/MentionMenu.tsx` | Mention suggestions, member/agent presentation, text highlighting |
| `features/chat/BriefPanel.tsx` | Shared brief adapter: manual edits, refresh from main, author metadata |
| `features/chat/DocumentPanel.tsx` | Session document adapter: create, edit, delete, and conflict refetch |
| `features/chat/BranchContextPanel.tsx` | Branch context adapter: owner edits and regenerates, others read only |
| `features/chat/SessionKeyPanel.tsx` | Session OpenRouter key: owner sets, replaces, or removes it; members see its status |
| `features/chat/TextEditorPanel.tsx` | Shared feature-level read/edit overlay, draft/version state, stale-draft feedback |
| `features/settings/Settings.tsx` | Account, server URL, agent tokens, copyable MCP configuration |
| `lib/api.ts` | REST calls, server URL and auth headers, error conversion; currently also declares the bridge type |
| `lib/useWebSocket.ts` | Socket lifecycle, authentication, session join, retry, typed sends |

`lib/messagesApi.ts` is an unused placeholder, not the message client to extend. Use `api.messages` in `lib/api.ts`.

**Conventions:** Keep feature-specific components and hooks beside their feature. Extract a component when it owns a distinct interaction or is reused; avoid splitting files solely by size. `components/` holds shared icons; reusable button, field, header, and composer styles live in the components layer in `index.css`. Keep transport details in `lib/` and domain contracts in `@tandem/shared`, defining each shared type once. Local props and rendering/layout shapes can remain beside their component.

## Navigation and state

**Current implementation:** `App` uses React state for `activeSession`, settings visibility, and pending menu actions. Screens receive callbacks to open or close other screens. There are no URL routes or browser navigation history. `AuthProvider` is the app-wide identity provider; feature data and drafts live in local React state.

`SessionView` owns selected-branch messages, a map of fetched paths for the tree, branches, members, agents, presence, the brief, and session documents. Child panels receive data and callbacks. REST fetches initial data; WebSocket events update the session view. Message-created events are deduplicated by message ID. Stream deltas update the selected timeline, and completion/error events finalize its messages. The tree's message cache is separate and does not receive all stream updates.

Brief and document panels reuse `TextEditorPanel` for local drafts and version-conflict feedback. `SessionView` also handles text-file imports and branch document selection; content persistence and context rules remain server responsibilities.

The socket hook reconnects with exponential backoff capped at 30 seconds and reauthenticates/rejoins. It does not currently trigger a complete REST resync or expose a connection-status UI. Do not assume reconnect recovers missed events.

**Conventions:**

- Keep drafts and transient interaction state local. Lift state to the nearest common owner when multiple components need it.
- Derive selection and permission presentation from existing data rather than maintaining competing copies.
- Merge server results and live events by stable IDs. Account for a write arriving through both the REST response and a broadcast.
- Cancel or ignore stale requests when switching sessions or branches. Clean up subscriptions and timers on unmount.
- Treat REST snapshots as recoverable state and socket events as updates. A future reconnect flow should refetch authoritative data before presenting the view as current.
- Preserve unsent text on failure and editing drafts when remote updates arrive. The brief uses `baseUpdatedAt` to detect conflicts; loading a teammate's version is an explicit user action.

## Layout

**Current implementation:** The window starts at 1280 × 800 with a minimum of 1000 × 650. Screens fill the viewport with `h-screen`. Home and Settings use centered `max-w-2xl` content; sign-in uses `max-w-sm`. A shared 48px draggable header reserves 96px at the left for native window controls; buttons and fields remain non-draggable.

The session has a top bar and three columns:

| Region | Sizing and behavior |
|---|---|
| Left sidebar | `w-56` (224px), fixed width; invite, brief, documents, members, branches; members capped with `max-h-36` |
| Center | Flexible width; independently scrolling messages, controls and composer below |
| Right tree | `w-44` (176px), fixed width; tree scrolls within its panel |
| Message content | Centered 760px maximum reading column including 24px side padding; own human messages align right on a neutral raised surface, assistant/agent prose sits on the canvas |
| Brief/document overlay | Shared text editor with full-window backdrop, `max-w-2xl`, maximum height `85vh`, scrolling body |
| Mention menu | Anchored above the composer, `w-64`, list capped with `max-h-48` |

The sidebars are currently always visible; there is no mobile layout or breakpoint-driven collapse.

**Conventions:** Preserve a usable composer and independent panel scrolling at the minimum window size. Use `min-w-0` for shrinking text columns and `min-h-0` for nested flex scroll regions. Truncate navigation labels, but wrap message content; allow code/configuration blocks to scroll horizontally. Check long names, model IDs, unbroken text, and large member lists. Keep native window controls clear when changing top-bar spacing, especially with macOS `hiddenInset` chrome.

## Visual language

**Current implementation:** The renderer uses the semantic dark palette below across screens, panels, controls, and the SVG tree. Tailwind maps the variables in `index.css` to semantic utilities and UI/prose/code font roles. Message authors remain explicit; assistant/agent prose uses the serif stack. No remote fonts or new styling dependencies are required.

### Reference roles

**Design direction:** Use Cursor as the reference for workspace density and understated chrome, Claude for typography and reading comfort, and Codex for familiar task/chat navigation and restrained controls. These are design references, not a requirement to reproduce another product pixel for pixel. Keep Tandem's identity and make multiplayer authors, branches, and agent activity easy to distinguish.

- Use warm charcoal surfaces with small differences in brightness between the sidebar, conversation, and composer. Start with dark mode; light/system modes remain a later product choice.
- Favor a continuous conversation canvas, compact navigation rows, subtle selected states, and monochrome icons. Reserve strong contrast for the primary action and keyboard focus.
- Keep saturated color sparse: links, active tree paths, mentions, and meaningful status. Use author names and small role labels to distinguish people and agents; large colored avatars and bright blue message fills should give way to neutral treatments.
- Keep hierarchy in typography, spacing, and alignment. Avoid decorative gradients, oversized headings, heavy shadows, and a separate card around every element.

### Semantic color tokens

The following values are Tandem's palette, not sampled values claimed to match any reference app exactly. `index.css` stores equivalent RGB channels in `--color-*` variables so Tailwind opacity modifiers work. The table uses the exact implemented variable names.

| Token | Dark value | Use |
|---|---|---|
| `--color-canvas` | `#1F1F1E` | Main conversation and screen background |
| `--color-sidebar` | `#191918` | Navigation and secondary panels |
| `--color-raised` | `#282827` | Composer, menus, dialogs, user messages |
| `--color-hover` | `#30302E` | Hovered rows and secondary controls |
| `--color-selected` | `#373734` | Selected navigation row |
| `--color-line` | `#393936` | Decorative separators and quiet outlines |
| `--color-control` | `#777770` | Control boundaries when needed for identification |
| `--color-primary` | `#ECECE7` | Body text and active labels |
| `--color-secondary` | `#B4B4AC` | Metadata and secondary labels |
| `--color-muted` | `#999991` | Supporting text and placeholders |
| `--color-action` | `#E8E8E1` | Primary button fill |
| `--color-action-ink` | `#20201E` | Text/icon on the primary button |
| `--color-accent` | `#A6BDD0` | Links, mentions, selected tree path, focus ring |
| `--color-success` | `#A3BAA1` | Online/success indicators |
| `--color-warning` | `#D7BD8D` | Conflicts and warnings |
| `--color-danger` | `#E3A09A` | Errors and destructive actions |

Use semantic utilities such as `bg-canvas`, `bg-raised`, and `text-primary` through the Tailwind configuration. The SVG tree uses these same tokens through CSS variables. Pair status color with a label or icon. Verify normal text contrast of at least 4.5:1 and meaningful control/focus contrast of at least 3:1 on the actual backgrounds; subtle separators are not a substitute for visible control states.

### Claude typography

**Design direction:** Use Anthropic Sans for interface text and human messages, Anthropic Serif for assistant/agent prose, and Anthropic Mono for code. Claude's public app styles expose `anthropic-sans`, `anthropic-serif`, and `anthropic-mono`, with the response font mapped to the serif family. This was verified against computed CSS on the [Claude sign-in page](https://claude.ai/login) on October 4, 2026; it is a typography reference, not a claim that every Claude surface or user preference uses the same font.

| Role | Family | Tandem size / line height | Weight |
|---|---|---|---|
| Navigation, buttons, menus | Anthropic Sans | 13px / 20px | 400; 500 selected |
| Metadata and small labels | Anthropic Sans | 12px / 18px | 400–500 |
| Panel and screen titles | Anthropic Sans | 15–18px / 22–26px | 500–600 |
| Composer and human messages | Anthropic Sans | 15px / 24px | 400 |
| Assistant/agent prose, shared summaries | Anthropic Serif | 16px / 26px | 400; 600 emphasis |
| Code, configuration, source editing | Anthropic Mono | 13px / 20px | 400 |

Use these local font stacks:

```css
--font-ui: "Anthropic Sans", -apple-system, "Segoe UI", system-ui, sans-serif;
--font-prose: "Anthropic Serif", Georgia, "Times New Roman", serif;
--font-code: "Anthropic Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

The exact Anthropic font files are not in this repository. Bundle them with local `@font-face` declarations once files with suitable redistribution rights are supplied, mapping them to the family names above and using `font-display: swap`. Until then, use the listed fallbacks and describe the result as an approximation. A font name alone does not load the font. Keep fonts local to the packaged app rather than depending on Claude's asset URLs. Check real font weights and fallback glyph coverage on both macOS and Windows.

Use sentence case for navigation headings, regular weight for body text, and medium weight for emphasis. Avoid tracking on body text and 10px functional labels. Keep code in the monospace role even inside serif responses. Long prose should have a comfortable measure of roughly 65–80 characters when space permits.

### Conversation and workspace treatment

- **Sidebar:** Preserve the current information architecture; make sessions/branches/documents feel like familiar workspace navigation through compact 30–34px rows, small icons, clear labels, and quiet selection backgrounds.
- **Conversation:** Center the reading column at approximately 760px maximum width, with 24–32px horizontal padding where space permits. Let it shrink with the window. Keep other participants' names visible so the familiar chat layout still communicates multiplayer authorship.
- **Messages:** Place assistant/agent prose directly on the canvas. Use a subtle raised surface for the current user's messages, with a 10–12px radius. Other human messages retain a clear author label and sans-serif text. Use 24–32px between turns and 6–8px between author metadata and content.
- **Composer:** Make it the clear interaction anchor at the bottom of the reading column, using a raised neutral surface, a fine border, 12–16px internal padding, and a 12px radius. Use a high-contrast neutral send button. Preserve existing sending and read-only states. Multiline behavior is a separate feature decision.
- **Tree:** Keep branches legible using thin connectors, neutral nodes, and one restrained active-path accent. Match the sidebar's chrome. Panel collapse/resizing can be added later without being a dependency of the visual refresh.
- **Brief/documents:** Reuse the same surface, typography, border, and button tokens as the chat. Source editing remains monospace. Keep conflict warnings visible and drafts intact.

### Spacing, shape, and motion

Use a 4px spacing rhythm, with 8/12/16/24/32px as the main steps. Use 6–8px radii for buttons and rows, 10–12px for message surfaces and menus, and 12–16px for dialogs. Use 1px separators and small monochrome SVG icons, typically 16px. Reserve shadows for overlays. Keep state transitions to approximately 120–160ms, honor reduced motion, and avoid layout shifts while streaming.

### Styling ownership

**Conventions:** Use Tailwind classes in components for layout and states. Keep `index.css` for font faces, semantic theme variables, and global defaults; map the tokens in `tailwind.config.js`. Prefer complete conditional utility strings so Tailwind can discover them; avoid constructed names such as `bg-${color}-600`.

Inline styles/SVG attributes are appropriate for calculated tree coordinates and drawing geometry. Keep literal colors in the token definitions. Extract repeated interactive patterns into small components with explicit variants when reuse warrants it; do not add a styling dependency just to shorten class strings. Migrate shared controls and whole surfaces together so the new theme does not become a mix of neutral controls and legacy bright-blue treatments.

## Interaction and content conventions

**Current implementation:** Messages, briefs, and documents render escaped plain text with preserved whitespace, not Markdown or highlighted code blocks. Recognized mentions in messages become React spans. The composer is a single-line input. Mention suggestions support Arrow Up/Down, Enter/Tab to select, and Escape to dismiss when there are matching items.

Pending messages show “Thinking…”, streaming messages a pulsing cursor, and failed messages a muted error surface. Busy actions use disabled controls and labels such as “Signing in…”, “Sharing…”, and “Saving…”. Read-only branches replace the input with an explanation and a branch action. Share summaries link back to their source branch.

**Conventions:**

- Give async interactions loading, empty, success, and error states where applicable. Place errors near the action and retain recoverable input.
- Use native buttons, inputs, labels, and form submission. Give icon-only controls accessible names and every interactive element a visible keyboard focus state.
- Keep hover actions keyboard-accessible. “Branch from here” appears on hover or keyboard focus; SVG tree nodes also support Enter/Space selection.
- For dialogs, preserve an accessible name, dialog semantics, focus containment, Escape dismissal, and focus restoration. The shared text editor implements these; Escape and backdrop clicks close only in read mode, preserving an in-progress draft.
- Keep the mention listbox and option IDs connected to the composer through combobox semantics and active-descendant state.
- Respect reduced-motion preferences. Global styles suppress animations/transitions, and streamed autoscrolling switches to immediate scrolling when reduced motion is requested.
- Keep message rendering safe. If Markdown is introduced, define code-block styling, link handling, and HTML sanitization before enabling it; do not render raw user HTML.

## Known gaps and future decisions

ARCHITECTURE.md includes intended desktop behavior beyond what the current renderer implements. In particular, Markdown/syntax highlighting, message timestamps, an active-branch model selector, tree visibility controls, and renderer-triggered new-message notifications are not implemented here. Do not infer their availability from the architecture's screen descriptions.

The current agent UI represents MCP tokens and mentions. First-class agent rosters, durable runs, tool activity, and stop controls belong to the later build-plan steps. Add their UI against the shared contracts as those steps ship.

The visual direction is set: a restrained Cursor-like workspace, familiar Claude/Codex interaction styling, and Claude's typography. The neutral theme, shared controls, centered conversation, and typography roles are implemented. Tune their values through visual review and record any departure here in the same change. Exact font assets are still needed. Product choices still open include light/system mode, resizable or collapsible panels, multiline composition, rich message rendering, and a shared component library.

## Verification and maintenance

For every change, run the repository-required checks:

```bash
npm run typecheck
npm test
```

For visual or interaction changes, also run `npm run dev` and inspect the affected screens at the default and minimum window sizes. Check keyboard use, overflow, focus, and relevant loading/error/disabled states. For multiplayer behavior, use `npm run dev:second` with a distinct identity and verify both windows. Use real agents only when the change requires them; report checks that could not be run.

Update this file when frontend structure, layout, shared styling, or interaction conventions change. Update ARCHITECTURE.md for changed flows/contracts and README.md for changed endpoints or setup. A documentation change alone does not mark a build-plan step complete.
