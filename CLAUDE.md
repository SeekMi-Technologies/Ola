# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Read this first — Dual workflow source

Ola maintains **two parallel workflow doc sets** (as of 2026-04-26):

| Tool | Source of truth | How loaded |
|---|---|---|
| **Claude Code** (Yuandong / Ziyue / Angel) | [`.claude/skills/`](.claude/skills/) — 4 skills: `onboard`, `spec`, `ship`, `ui-tweak` | Auto-loaded via skill `description` matching; or invoke explicitly: `/onboard` `/spec` `/ship` `/ui-tweak` |
| **Antigravity** (Will, currently) | `.agents/workflows/*.md` + `.agents/context/*.md` | Antigravity reads `.agents/` directly |

**Claude Code users — start here:**

1. **`/onboard`** — identity gate (Yuandong / Ziyue / Will / Angel) + git/issue/task.md state report + routing
2. **`/spec`** — for any non-trivial code work (6-phase SDD loop). Required for Ziyue on every change (no trivial 豁免)
3. **`/ship`** — atomic commit + push (always asks first) + PR to dev (never main)
4. **`/ui-tweak`** — for Will / Angel making small UI changes (color, copy, AntD prop, layout)

**Skills are self-contained — they do NOT read `.agents/` at runtime.** All rules and identity tables are embedded in skill bodies, with pointers to live codebase for templates (e.g. `quoteController/index.js` is the canonical Controller pattern).

**Maintenance discipline:** workflow changes that apply to all team members must be edited in BOTH the relevant skill AND the matching `.agents/` file (until Will migrates off Antigravity, at which point `.agents/workflows/*.md` collapse to pure pointers — deferred Phase J5/J6 in `task.md`).

**Antigravity users (Will):** the legacy `.agents/` doc set is still canonical for you. Read in this order:

1. `.agents/workflows/onboard.md` — entry-point ruleset
2. `.agents/context/understanding.md` — company / product / data model
3. `.agents/context/code_conventions.md` — controller/model/response templates
4. `.agents/context/develop.md` — SDD 6-phase loop
5. `.agents/workflows/{push,pr,start}.md` — invoked as `/push`, `/pr`, `/start`

### Identity gating (ask "你是谁?" at the start of a new conversation)

| User | Branch | Mode | Allowed |
|---|---|---|---|
| **Yuandong / 张元东 / zyd / Duke** | `ZYD_FEAT` | 🟢 peer | Full-stack; trivial single-file fixes may skip Phase 1–3 |
| **Ziyue / 殷子越** | `ZIYUE_FEAT` | 🟢 peer (no trivial 豁免) | Full-stack; **must walk all 6 phases regardless of change size** (zyd's explicit decision) |
| **Will / 王梓珩 / Ziheng / wzh** | `WZH_UI` | 🟣 UI/UX | `.css/.less/.scss`, JSX className/文案/layout, AntD props. ❌ Forbidden: `backend/`, `models/`, API routes, `docker-compose.yml`, `.env`, `request/` config |
| **Angel / 文怡力 / Yili** | `YILI_UI` | 🟣 UI/UX | Same as Will. UT Dallas HCI PhD, UI/UX 专家 |
| **lzy / 刘致远 / Zack / Zhiyuan** | — | 🔵 experience | No code; collects product feedback for Yuandong. Not in code-skill identity gates |

### SDD discipline (always-on after onboard)

- **One backlog item at a time.** Track in `task.md`. Mark `[/]` in-progress, `[x]` done.
- **No code before APPROVE.** Restate the plan, list affected files + their import/require deps, and wait for explicit "approved / 开始 / 可以".
- **Test before advancing.** A failed item is fixed in place, never deferred. Out-of-scope discoveries → new backlog item, not an in-line fix.
- **Done = pushed.** Each finished item → `/ship` (Claude Code) or `/push` (Antigravity) → mark `[x]` → next item. All items done → `/pr` or `/ship`-PR.
- **Trivial exemption (Yuandong only):** single-line typo / CSS / rename / unambiguous single-file fix may skip 1–3. **Ziyue does NOT get this exemption** — must walk all 6 phases. Phase 5–6 are never skippable for anyone.
- **Push protocol:** before any `git push`, ask "可以 push 了吗?" and wait for explicit OK.

### Branch policy

**CRM (`SeekMi-Technologies/Ola`):**

| User | Dev branch | Merge target |
|---|---|---|
| Yuandong | `ZYD_FEAT` | PR → `dev` |
| Ziyue | `ZIYUE_FEAT` | PR → `dev` |
| Will (wzh) | `WZH_UI` | PR → `dev` |
| Angel (Yili) | `YILI_UI` | PR → `dev` |
| — | `dev` → `main` | Yuandong-only, manually on GitHub |

**nanobot (`SeekMi-Technologies/Ola_bot`, fork of HKUDS/nanobot):**

| Branch | Role |
|---|---|
| `ola-dev` | Development cumulative — feature branches PR here, local dev runs from here |
| `ola-main` | Production stable + repo default — deployment uses this; PR `ola-dev` → `ola-main` is the release flow |
| `main` | HKUDS upstream mirror — touched only when syncing from upstream, never developed on |

Never commit on `main` / `dev` / `ola-main`. CRM PRs target **`dev`**, not `main`. nanobot PRs target **`ola-main`** for release; intermediate feature work merges into `ola-dev` first. Before pushing, rebase on the appropriate upstream (`origin/dev` for CRM, `origin/ola-dev` for nanobot feature work).

### Hard boundaries (any mode)

- ❌ No silent errors. Every catch returns a specific message; never `catch(e){}`.
- ❌ No hacks: no `setTimeout` instead of real async, no hardcoded workarounds, no `// @ts-ignore`.
- ❌ Never drop Mongo collections/indexes — founder does that manually.
- ❌ Don't touch `docker-compose.yml` ports or `.env` content (tell the user what to add instead).
- ❌ No hardcoded secrets, no `eval/exec`.
- ✅ Soft-delete via `removed: true`, never physical delete.
- ✅ All endpoints behind `adminAuth.isValidAuthToken` (already wired in `app.js`).
- ✅ Migrations must be idempotent.
- ✅ Money math via `helpers.calculate.multiply/add/sub` — never native `+ - *` (float precision).
- **Core infra awareness:** Ola CRM is Ola Technologies' own MERN codebase. Modifying core infrastructure (`createCRUDController`, `errorHandlers`, the auto-route registration in `appApi.js`) requires explicit reasoning — these drive the entire CRUD layer.

### MVP product rules (Lead-to-Quote loop)

The product is **Ola** — AI-native foreign-trade ERP/CRM. MVP closed loop:
WhatsApp inquiry → Agent extracts product needs → match `Merch` (by `serialNumber`, `description_en/cn`) → assist user creating a `Quote` (status `draft`).

- ❌ Agent **never invents prices** — leave the price field empty for the salesperson.
- ❌ Agent **never silent-errors on missing Merch** — explicitly tell the user "未找到 [产品名]，请在 Merchandise 添加".
- ✅ Use a generic `channel` field — never hardcode `whatsapp` as the only source. WeChat / Email come next.
- The "Ask Ola" page is the AI entry point. UI shell exists; AI backend is wired through `controllers/appControllers/olaController` proxying to NanoBot.

## Sibling repo: `nanobot/` (Python AI backend)

`crm/` is opened, but **the sibling `../nanobot/` folder is also part of this work** — it's the AI backbone that powers Ola's Agent. Treat `../nanobot/` as readable source you may need to consult, even though this CLAUDE.md lives in `crm/`.

- **Source:** [HKUDS/nanobot](https://github.com/HKUDS/nanobot), version **v0.1.4.post6**, ~4k LOC core. **Do not rewrite in Node.js** — the decision is to keep it as a Python microservice.
- **Deployment model:** Nanobot runs as a separate service alongside CRM (Docker Compose). CRM's `olaController` HTTP-proxies `/api/ola/chat` to NanoBot's serve endpoint (see commit `b07adb3`).
- **Architecture inside `../nanobot/`:** `agent/` (loop, context, memory, skills, subagent, tools), `channels/` (13 channels incl. WhatsApp, WeChat, Email), `providers/` (OpenAI/Anthropic native SDKs after litellm was removed in v0.1.4), `bus/` `heartbeat/` `cron/` `skills/` `session/` `bridge/` (Node.js Baileys WhatsApp bridge).
- **Integration design:** MCP is the planned standard interface — CRM backend exposes business actions as MCP tools that NanoBot can call. When touching this seam, design tool schemas carefully (strong types, no nullable surprises).
- When working across both repos, state which side a change goes in **before** editing. A change in `../nanobot/` is not bound by Ola CRM's Node/Mongoose conventions but is bound by the same SDD discipline and "no silent errors" rule.

## Project

OlaCrm — Ola Technologies 自有 MERN product，CRM/ERP for clients, quotes, invoices, purchase orders, payments, comparisons, reporting. Node.js 20 + Express + MongoDB backend, React 18 + Vite + Ant Design + Redux Toolkit frontend. Production target: `https://app.olatech.ai` (primary). 过渡期 `https://app.olajob.cn` 并存，T+2 周后下架。

## Common commands

Backend (`cd backend`):
- `npm run dev` — nodemon on `src/server.js` (port `8888`)
- `npm start` — production start
- `npm run setup` / `npm run add-admin` / `npm run upgrade` / `npm run reset` — scripts in `src/setup/`
- Tests: jest is installed (with `mongodb-memory-server` + `supertest`) but there is no `test` script defined; run with `npx jest` (single file: `npx jest path/to/file.test.js`).

Frontend (`cd frontend`):
- `npm run dev` — Vite dev server on port `3000` (proxies `/api` and `/export` → `http://localhost:8888`)
- `npm run dev:remote` — dev server proxying to `VITE_BACKEND_SERVER` instead of localhost
- `npm run build` / `npm run preview`
- `npm run lint` — ESLint, `--max-warnings 0`
- Tests: vitest is installed but no `test` script; run with `npx vitest` (single file: `npx vitest run path/to/file.test.jsx`).

Deploy:
- `docker compose up -d --build` (frontend on 3000, backend on 8888, expects backend `.env`)
- `./deploy.sh` — rsyncs to `DEPLOY_SERVER_IP:DEPLOY_REMOTE_DIR` (defaults `43.99.57.106:/app/crm`), then runs docker compose remotely and hits `GET /health`.

**First-time setup on a fresh dev machine** → see [`ola/SETUP.md`](ola/SETUP.md). It covers the sibling `../nanobot` clone (SeekMi-Technologies fork, not upstream HKUDS), the 4 `backend/.env` variables, and the auto-provisioned `~/.nanobot/` workspace + config that makes Ask Ola behave as a tool-calling agent instead of a bare chat proxy.

## Architecture

### Backend (`backend/src`)

Entry: `server.js` → `app.js`. Module aliases via `module-alias`: `@` → `src` (used as `require('@/...')`).

Routing layers, all mounted in `app.js`:
- `coreAuthRouter` — public auth (`/api`)
- `coreApiRouter` — core (settings, users), behind `adminAuth.isValidAuthToken`
- `erpApiRouter` (`routes/appRoutes/appApi.js`) — entity CRUD, also auth-gated
- `coreDownloadRouter` (`/download`), `corePublicRouter` (`/public`)
- `exportRoutes` (`/export/excel`) — **no auth**
- `GET /health`, `GET /debug/settings` — utility

**Entity routes are auto-generated.** `models/utils/index.js` globs `src/models/appModels/**/*.js` and builds `routesList`. `appApi.js` then loops `routesList` and registers a standard set per entity against `controllers/appControllers[controllerName]`:

```
/<entity>/create | read/:id | update/:id | delete/:id | search | list | listAll | filter | summary
```

Plus conditional extras:
- `mail` for `invoice`, `quote`, `payment`
- `convert/:id` for `quote`
- `copy/:id` for `invoice`, `quote`, `purchaseorder`

Adding a new entity = add a Mongoose model under `models/appModels/` **and** a matching controller folder under `controllers/appControllers/` exported via its `index.js`. Special-case routes (e.g. `comparison/*`, `priceSearch/history`, `ola/chat`) are appended manually at the bottom of `appApi.js`.

Controllers use the `catchErrors` wrapper from `handlers/errorHandlers` (which also provides `notFound` and `productionErrors`).

PDF generation goes through Gotenberg (`GOTENBERG_URL`); excel export lives in `controllers/excelController` + `routes/exportRoutes.js`. The `olaController` proxies AI chat to a NanoBot serve backend (see recent commit `b07adb3`).

### Frontend (`frontend/src`)

Entry: `main.jsx` → `RootApp.jsx`. Routing split into `router/AuthRouter.jsx` and `router/AppRouter.jsx`; route table in `router/routes.jsx`. Path alias `@` → `src` (vite + jsconfig).

State: Redux Toolkit store in `redux/store.js` with reducers under `redux/{auth,crud,adavancedCrud,erp,settings}` plus `storePersist.js` for localStorage hydration.

The UI is built around reusable **Modules** in `src/modules/` that wrap generic CRUD/ERP behavior:
- `CrudModule` / `AdvancedCrudModule` — generic list/create/update/read/delete pages driven by config + a `dataTableColumns` / form component
- `ErpPanelModule` — quote/invoice/PO/payment-style document pages (line items, totals, PDF, mail)
- Domain wrappers: `QuoteModule`, `InvoiceModule`, `POModule`, `PaymentModule`, `ComparisonModule`, `EmailModule`, `DashboardModule`, `SettingModule`, `AuthModule`, `ProfileModule`

Per-entity pages under `src/pages/` typically just compose one of those modules with an entity config + form component from `src/forms/`.

`request/request.js` is the central axios client; `redux/crud` and `redux/erp` slices dispatch through it. `request/devMockInterceptor.js` can stub endpoints during dev. Locale files in `src/locale/`, layout shell in `src/layout/` and `src/apps/` (`ErpApp.jsx`, `Header`, `Navigation`, `OlaChatPanel`, `OlaOs.jsx`).

### Key env vars

Backend: `DATABASE`, `JWT_SECRET`, `MCP_SERVICE_TOKEN`, `GEMINI_API_KEY`, `PORT` (8888), `ALLOWED_ORIGINS` (CSV; falls back to permissive regex), `PUBLIC_SERVER_FILE`, `GOTENBERG_URL`, optional `RESEND_API`.

Frontend (build-time): `VITE_BACKEND_SERVER`, `VITE_APP_API_URL`, `VITE_FILE_BASE_URL`, `VITE_DEV_REMOTE` (set to `remote` to make `dev` proxy to `VITE_BACKEND_SERVER`), `VITE_PORT`/`PORT`, `VITE_DEV_BYPASS_AUTH` (dev-only mock interceptor toggle, tree-shaken in prod build).
