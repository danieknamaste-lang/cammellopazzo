# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this project is

**EllenChat** — a self-hosted ChatGPT-style AI chat app. A small Express server serves
a static vanilla-JS frontend and proxies chat requests to whichever LLM backend is
available, streaming tokens back over SSE. The same `public/` directory is also packaged
as an Android APK via Capacitor, where it runs **without a server** and talks to the
DeepSeek API directly from the device.

The assistant persona ("Ellen") is inspired by the writings of Ellen G. White; the whole
product is Italian-language.

## Repository layout

```
server.js                        Express server: backend detection, /api/status, /api/chat (SSE)
public/index.html                Full page markup (chat shell + settings modal)
public/app.js                    All frontend logic, single IIFE, no framework
public/style.css                 All styling, CSS custom properties in :root
capacitor.config.json            Capacitor: appId com.ellenchat.app, webDir "public"
.github/workflows/android-apk.yml  Builds a debug APK, uploads it as an artifact
package.json                     Deps + the only script: "start"
README.md                        User-facing docs (Italian)
```

There is no `src/`, no build step, no bundler, no transpiler, no test suite, and no
linter config. `public/` is shipped verbatim to both the browser and the APK.

## Commands

```bash
npm install
npm start                                   # http://localhost:3000, demo mode if unconfigured
DEEPSEEK_API_KEY=sk-... npm start           # DeepSeek backend
ANTHROPIC_API_KEY=sk-ant-... npm start      # Claude backend
npm start                                   # auto-detects a running Ollama
```

Requires Node >= 18 (the code relies on global `fetch`, `AbortSignal.timeout`, and async
iteration over `res.body`).

There is no test command. To verify a change, start the server and exercise the UI —
demo mode (no env vars) is enough to test streaming, conversation management, and the
Markdown renderer end to end.

## Architecture

### Backend selection (`detectBackend`, server.js:54)

Resolved **once at startup**, into a module-level `backend = { type, model }`. Priority:

1. `deepseek` — if `DEEPSEEK_API_KEY` is set
2. `anthropic` — if `ANTHROPIC_API_KEY` is set
3. `ollama` — if `GET {OLLAMA_URL}/api/tags` answers within 2s (picks `OLLAMA_MODEL`, else the first listed model)
4. `demo` — fallback; simulated word-by-word reply, no API calls

Changing env vars requires a restart. Each backend has its own `stream*` function
(server.js:128, :170, :194, :228) with one shared contract: call `send({type:'delta', text})`
for each chunk and return when finished. **Adding a backend means adding a branch in
`detectBackend`, a branch in the `/api/chat` dispatch (server.js:108-116), and one
`stream*` function** — nothing else changes.

### Wire protocol: `POST /api/chat`

Request: `{ messages: [{ role: 'user'|'assistant', content: string }] }` — the full
conversation history; the server is stateless and holds no sessions.

Response: SSE, one JSON object per `data:` line separated by a blank line:

- `{"type":"delta","text":"..."}` — append to the current bubble
- `{"type":"done"}` — end of turn
- `{"type":"error","message":"..."}` — sent in-band; HTTP status is already 200 by then

Errors after headers are flushed must go through the `error` event, not a status code.
Both sides hand-parse the stream (server.js:146-163, app.js:332-350); note the server's
`/api/chat` reader splits on `\n\n` while the upstream DeepSeek/Ollama readers split on
`\n`.

### Frontend modes (`isDirectMode`, app.js:46)

- **Server mode** — `/api/status` responded. Chat goes through `streamViaServer` (app.js:324).
- **Direct mode** — no server (the Android APK), or the user ticked "force direct" and
  saved a key. `streamDeepSeekDirect` (app.js:353) calls `api.deepseek.com` from the
  page. If `fetch` throws (CORS/network inside the WebView) it falls back to
  `deepSeekViaCapacitor` (app.js:406), which uses the native `CapacitorHttp` plugin with
  `stream: false` and fakes the streaming animation for visual consistency.

State lives in `localStorage` under `ellenchat.conversations` (the conversation list) and
`ellenchat.settings` (`{dsKey, dsModel, forceDirect}`). No database, no server-side
persistence. The DeepSeek key is stored in plaintext on the device by design — keep it
that way, and never send it anywhere but `api.deepseek.com`.

### Markdown rendering (app.js:434-515)

A ~80-line hand-rolled renderer: HTML is escaped **first**, then inline/block markup is
re-introduced. Supports fenced code blocks, `ul`/`ol`, blockquotes, paragraphs, inline
code, bold, italic, and links. Do not add a Markdown library — it would need bundling,
which this project deliberately avoids. When touching it, preserve the escape-then-render
order: `renderMarkdown` inserts raw HTML into `bubble.innerHTML`, so any path that skips
`escapeHtml` is an XSS hole. The fence split in `renderMarkdown` (app.js:455-462) yields a
period-4 parts array; the `i += 4` stride is intentional.

## Conventions

- **Italian everywhere user-visible**: UI strings, error messages, code comments, commit
  messages, README. Identifiers stay English.
- Vanilla JS only. No frameworks, no build tooling, no runtime deps beyond `express` and
  `@anthropic-ai/sdk` (which is lazily `require`d inside `streamAnthropic` so the app runs
  without it configured).
- CommonJS (`require`) on the server; a single IIFE with `'use strict'` on the client.
- 2-space indent, semicolons, single quotes, trailing commas in multiline literals.
- Section banners (`// ---- Titolo ----`) separate the logical blocks in both `server.js`
  and `app.js`; follow the existing style when adding one.
- Styling goes through the CSS custom properties in `:root` (style.css:3-18) — accent is
  `--accent: #6c5ce7`. Don't hardcode colors.
- DOM is built with `document.createElement` + `textContent` for anything user-supplied;
  `innerHTML` is reserved for renderer output and static templates.

## Things that must be kept in sync

These are duplicated on purpose (the APK has no server), so a change to one needs the
same change to the other:

1. **The system prompt** — `DEFAULT_SYSTEM_PROMPT` (server.js:32) and `SYSTEM_PROMPT`
   (app.js:11) are the same text.
2. **Backend labels** — `updateBadge` (app.js:74-79) maps every `backend.type` the server
   can report; a new backend needs a new label.
3. **The README** — it currently documents only three backends and omits the
   `DEEPSEEK_*` variables that `server.js` reads. If you touch env-var handling, fix the
   config table.
4. **The demo reply** (server.js:228) lists the setup options; keep it truthful.

## Environment variables

| Variable | Default | Read at |
| --- | --- | --- |
| `PORT` | `3000` | server.js:25 |
| `DEEPSEEK_API_KEY` | — | server.js:55 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | server.js:26 |
| `DEEPSEEK_API_URL` | `https://api.deepseek.com/chat/completions` | server.js:27 |
| `ANTHROPIC_API_KEY` | — | server.js:59 (also read by the SDK) |
| `CLAUDE_MODEL` | `claude-opus-4-8` | server.js:28 |
| `OLLAMA_URL` | `http://localhost:11434` | server.js:29 |
| `OLLAMA_MODEL` | first model reported by Ollama | server.js:68 |
| `ASSISTANT_NAME` | `Ellen` | server.js:30 |
| `SYSTEM_PROMPT` | the Ellen persona | server.js:33 |

`.env` is gitignored but nothing loads it — export the variables in the shell instead.
Never commit a key.

## Android / Capacitor

`.github/workflows/android-apk.yml` runs `npx cap add android` (or `cap sync` if
`android/` exists), then `./gradlew assembleDebug`, and uploads `EllenChat-apk`. The
`android/` directory is **not** committed — it is generated on every CI run, so changes
to native Android config belong in `capacitor.config.json`.

Note the workflow's push trigger lists specific branches (`main` and one `claude/*`
branch); a build on another branch needs either a `workflow_dispatch` run or an update to
that list.

Since the APK ships `public/` with no server, anything the frontend needs at runtime must
work with `serverAvailable === false`. Never make a new feature depend on `/api/*` without
a direct-mode path.

## Git

The remote has no `main` branch — work happens on `claude/*` feature branches. Push with
`git push -u origin <branch>`. Commit messages are written in Italian, imperative-ish,
one line (see `git log`).
