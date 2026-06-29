# Ola AI-Native Transformation — Plan

**Owner:** Yuandong · **Date:** 2026-06-26 · **Status:** Approved direction, one open item (D4) · **Window:** 2–3 weeks
**Reference architecture:** `Hidden_Layer_Internal` (Python: OpenAI Agents SDK + mem0 + Composio — already proven live).

---

## TL;DR

Replace the Python **nanobot** AI backend with a new **Ola AI Core** (Python: OpenAI Agents SDK + mem0 + Composio MCP), modelled on Hidden Layer. The **Ola CRM, web panel, MongoDB Atlas, and our MCP tool server stay unchanged.** The new core speaks the *same* chat contract nanobot did, so cutover is essentially an env repoint. Cutover scope is **web "Ask Ola" only**; email and WhatsApp are rebuilt fresh afterward. Channels leaving the critical path makes **2 weeks realistic.**

---

## What changes vs what stays

| Stays (untouched) | Replaced / Added |
|---|---|
| Ola CRM (Node/Express/Mongoose) | nanobot → **Ola AI Core** (Python) |
| React web panel ("Ask Ola") | nanobot serve `/v1/chat/completions` → **new core FastAPI facade** |
| MongoDB Atlas (system of record) | File-based agent memory → **mem0** (pgvector, per-tenant) |
| Our MCP server `:8889` + 17 tools + `Bearer` + `X-Acting-As` | (none — preserved as-is) |
| `createdBy` data isolation | + **Composio MCP** for external tools |
| ola CI/CD | ola_bot CD → retired after channels rebuilt (staged) |

**The migration boundary is held constant on purpose:** new core exposes the same `/v1/chat/completions` SSE contract (`delta` chunks + `event: tool_event` + `event: usage` + `[DONE]`) and the same `X-Ola-Acting-As` header. CRM-side change ≈ rename one env var.

---

## Target architecture

```
  Web "Ask Ola" ───────▶  Ola CRM (KEEP)                       ┐
                          • /api/ola/chat  (SSE proxy)         │ our MCP, unchanged
                          • MCP server :8889  (Bearer+ActingAs)│ (Bearer + X-Acting-As)
                          • MongoDB Atlas (createdBy isolation)│
                                  │ /v1/chat/completions (SSE)  │
                                  ▼  X-Ola-Acting-As: <adminId> │
                          Ola AI Core (Python, NEW)           ◀┘
                          • FastAPI serve (SSE facade)
                          • OpenAI Agents SDK — router + worker ───▶ Composio MCP
                          • acting_as ContextVar (fail-closed)      (x-api-key + ?user_id=adminId)
                          • mem0 (pgvector, 1 collection / tenant) ─▶ pgvector
  Email / WhatsApp ─────▶  • gateway (channels — Phase 2)
   (Phase 2, fresh)
```

---

## Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| **D1** | CRM data isolation | Keep `createdBy` doc-level for cutover. Per-tenant schema needs → **custom-fields registry** (separate CRM track). DB-per-tenant reserved as escalation for specific enterprise tenants. |
| **D2** | New core repo | **Fresh Ola build, Hidden Layer as reference** (lift patterns + solved gotchas, write clean for lead-to-quote). |
| **D3** | Channels in cutover window | **Web Ask Ola only.** Email + WhatsApp rebuilt fresh in Phase 2 (ideas/experience, not code). Feishu not in product. → staged nanobot deprecation. |
| **D5** | Agent topology | **Router + worker** (small structured router → deepseek worker, two separate runs). |
| **Auth** | Our MCP + Composio MCP coexistence | **No change to either scheme.** Agents SDK attaches headers per-MCP-server, so one run holds both. Bind `Composio user_id := adminId`. |
| **D4** | First Composio toolkit | **OPEN** — Gmail / GitHub / Notion / other? (lowest-risk first targets: GitHub or Notion, both proven in Hidden Layer.) |

---

## Isolation model

- **CRM/ERP data** — `createdBy: adminId` document scoping (today's model, works, no refactor).
- **Per-tenant schema differences** — **custom-fields registry** (the Salesforce/HubSpot pattern): a `CustomFieldDef` collection per tenant + a declared `customFields` container on entities + dynamic form/table rendering. Tenants define their own fields **with no code and no deploy**; the AI agent picks them up at runtime from the same registry. One shared DB, zero connection refactor. *Runs as a parallel CRM track, does not block the AI cutover.* (Spec: `doc/custom_fields_registry.md`, to be written.)
- **Agent memory** — one **mem0 pgvector collection per tenant** (`ola_mem_<adminId>`) = hard wall.
- **Identity propagation** — `acting_as` ContextVar stamped once at the inbound boundary, flowing to all three: mem0 scope, our MCP `X-Acting-As`, Composio `user_id`. **Fail-closed** everywhere; negative cross-tenant test at each seam (this is our historical failure point — non-negotiable gate).

---

## The three external pieces (load-bearing facts)

**OpenAI Agents SDK** — Python `openai-agents` 0.17.x (mature; pin it).
- Multi-provider: deepseek/gemini via `OpenAIChatCompletionsModel(base_url=…)`; Claude via `LitellmModel`. Set `chat_completions` API + disable OpenAI tracing for non-OpenAI keys.
- **No official server** → we hand-roll the FastAPI SSE facade (the glue that keeps the CRM seam constant).
- **MCP headers are per-server, set at connection time. No per-call header API exists** (the feature was rejected). For per-request `X-Acting-As`: mint a short-lived server per identity (simplest, safest) or share a connection with an `httpx.Auth` reading a contextvar.

**mem0** — pin `mem0ai==2.0.8` (v3 is breaking).
- Self-hosted: pgvector + fastembed + **native deepseek** extraction (not litellm). One collection per tenant.
- `search()` is cheap (~200ms p95) → inline before reply. `add(infer=True)` is expensive → **background it** off the reply path.

**Composio** — two auth layers, don't conflate:
- `x-api-key` header = org-level app auth, **mandatory** (401 without it since Mar 2026).
- `user_id` = the acting tenant, **you choose it**, carried **in the MCP URL** (`?user_id=…` / pre-signed Tool Router session), **not a header**. → we keep an `adminId → composio session/url` cache.
- Connect each tenant's external account (Gmail/GitHub/…) via OAuth ahead of time. Cloud-hosted, tool-call metered (Free 20K → $29/200K → $229/2M).

**Gotchas to copy from Hidden Layer (already solved there):** lowercase tenant ids (pg folds identifiers); mem0 fastembed returns ndarray → custom embedder returns list; mem0 native deepseek provider not litellm; Composio URLs need `/mcp` path; text-only sessions; pre-warm fastembed before threads on macOS.

---

## Workstreams & milestones

**Track A — AI Core**
- A1 FastAPI SSE facade + Agents SDK agent on our existing MCP tools → **web Ask Ola runs on new core**.
- A2 mem0 (pgvector, per-tenant, async record).
- A3 Composio MCP (Tool Router per adminId, fail-closed, tool allowlist, OAuth connect for D4 toolkit).
- A4 Router + worker topology; models (deepseek/gemini/claude); Ola workflows (`lead_to_quote`, `recordings`, `knowledge_qa`).

**Track C — CRM seam + isolation**
- C1 Repoint `/api/ola/chat` (env); verify SSE frame fidelity against the frontend parser.
- C2 Isolation hardening: `acting_as` end-to-end + **negative cross-tenant tests** (mem0, our MCP, Composio).

**Track D — CI/CD + cutover**
- D-CD Dockerize new core + pgvector; mirror Box2 topology.
- D-Stg Staging cutover + full E2E + smoke.
- D-Prod Prod web cutover; retire nanobot-serve (keep gateway + ola_bot CD for prod email until Phase 2).

**Phase 2 (after cutover, in the new product):** rebuild email, then WhatsApp, fresh → fully retire nanobot + ola_bot.
**Parallel CRM track (independent):** custom-fields registry.

### Calendar

| Days | Work | Milestone |
|---|---|---|
| 1–2 | New repo, pgvector, version pins, copy gotchas | |
| 2–4 | A1 facade + web Ask Ola on new core | **M1 — web on new core** |
| 4–7 | A2 mem0 ‖ A3 Composio ‖ A4 router+worker | |
| 7–9 | C1 seam + C2 isolation (negative tests) | **M2 — all-green local** |
| 9–11 | D-CD + D-Stg staging E2E + harden | **M3 — staging cutover** |
| 11–13 | D-Prod web cutover, retire nanobot-serve, buffer | **M4 — prod web on new core** |

---

## Risks & mitigations

1. **Cross-tenant leak** (mem0 / our MCP / Composio) — our recurring pain. → contextvar discipline, fail-closed, negative tests at every seam; prefer per-identity MCP server.
2. **SSE frame fidelity** (no official SDK server) → contract-test the facade against the frontend parser before cutover.
3. **Composio** — cloud-only, metered, GA-but-young → pin versions, fail-closed, watch tool-call cost.
4. **mem0 v3 + gotchas** → pin 2.0.8, copy Hidden Layer's fixes.
5. **No email regression during transition** → keep nanobot-gateway alive until Phase 2 email ships.

---

## Open item

**D4 — first Composio toolkit to wire end-to-end** (with the per-tenant OAuth flow in A3). Recommend GitHub or Notion (both proven in Hidden Layer); choose by Ola sales value.

---

## Appendix — engineer reference

**Seam contract (held constant):** `POST /v1/chat/completions`, body `{messages, session_id, stream:true}`, header `X-Ola-Acting-As: <adminId>`; response SSE = `delta` chunks + `event: tool_event` + `event: usage` + `[DONE]`.

**Auth reconciliation (one agent, both MCP servers):**
```python
ola = MCPServerStreamableHttp(name="ola", params={
    "url": "http://127.0.0.1:8889/api/mcp",
    "headers": {"Authorization": f"Bearer {OLA_MCP_SERVICE_TOKEN}", "X-Acting-As": admin_id},
})
composio = MCPServerStreamableHttp(name="composio", params={
    "url": composio_url_for(admin_id),          # contains ?user_id=<admin_id>
    "headers": {"x-api-key": COMPOSIO_API_KEY},
})
agent = Agent(name="Ola", mcp_servers=[ola, composio])   # per-server headers — no scheme change needed
```

**Custom-fields registry (per-tenant schema, no code per field):** `CustomFieldDef` model (auto-registers CRUD via the model glob) + `customFieldsPlugin` adding a declared `customFields: Mixed` path with `pre('validate')` / `pre('findOneAndUpdate')` validation against the tenant's defs + dynamic frontend rendering + widened MCP tool inputs (`customFields: z.record(z.any())`). Build once (~1 week, mostly frontend); fields become pure data thereafter.
