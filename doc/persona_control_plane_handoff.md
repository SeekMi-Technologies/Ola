# Persona control-plane — deploy handoff (→ Binghan)

> 2026-07-01 · from Yuandong. Everything is coded, merged, and validated on staging.
> Remaining is deploy/ops work I couldn't finish because box4 + Box6 are key-only SSH.

## What this is
The devboard can now **edit a tenant's per-admin `SOUL.md` / `USER.md`** (and **view** the
global `SOUL/AGENTS/TOOLS` read-only) without touching any box by hand. It works by
mounting persona routes on nanobot's existing **`serve` :8900** (already Tailscale-exposed —
how the CRM reaches it), gated by a bearer token. **No new container, no compose/CD change.**

- Token per box = a file `<state-dir>/.persona_token` (or `PERSONA_API_TOKEN` env), read per-request.
- Editable per-admin: `SOUL.md`, `USER.md`. Read-only: `AGENTS.md`, `TOOLS.md`, and `GET /internal/global`.
- Routes: `GET /internal/persona`, `GET /internal/persona/{adminId}`, `GET /internal/global`,
  `PUT /internal/persona/{adminId}/{SOUL.md|USER.md}`.

## Done ✅
- Merged: **Ola_bot #15, #17, #18**; **Ola #385**; **Ola_devboard #1** (→ `main`).
- **Staging (Box6)** redeployed with persona-on-serve; validated end-to-end
  (`GET /internal/persona` 200 with token, lists real staging admins, 401 without token, global works).
  Token already dropped: `/opt/ola-staging/nanobot-state/.persona_token`.
- gingersoft persona hotfixed on **Box2** to full-Cantonese-first (interim, still in their `USER.md`;
  backup at `admins/6a03e003dcaca7e136b3fc03/USER.md.bak.pre-cantonese`).

## TODO (Binghan)
1. **Deploy the devboard (box4).** `devboard.olatech.ai`; I couldn't SSH (key-only, my key not on box4).
   - `cd <devboard checkout>` (e.g. `/opt/ola-devboard`) → `git pull origin main` (has persona code).
   - Add to its `.env`:
     ```
     PERSONA_STAGING_NANOBOT_URL=http://100.77.89.90:8900
     PERSONA_STAGING_TOKEN=<cat /opt/ola-staging/nanobot-state/.persona_token on Box6>
     PERSONA_STAGING_MONGO=<DEV_DATABASE from .secrets/SERVERS.env>
     ```
   - `docker compose build && docker compose up -d`. box4 must be on **Tailscale** (reach Box6 100.77.89.90 / Box2 100.83.72.110).
   - To grant me access instead: add pubkey `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILe/ghLqZq19q8gstgbJ/ORIeVnaj/DFSk7iw2iXrM7s ola-box6-persona-devboard` to box4 and I'll finish it.
2. **Prod promote.** `deploy-production` (workflow_dispatch) with the ola-dev-validated `crm_sha` + `nanobot_sha` (nanobot image must include #18). Gives Box2 `serve:8900` the persona routes + WS-D single workspace.
3. **Prod token.** Drop a **different** strong token: `/opt/ola-production/nanobot-state/.persona_token` (`chown 1000:1000`, `chmod 600`). In the devboard `.env`:
   `PERSONA_PROD_NANOBOT_URL=http://100.83.72.110:8900`, `PERSONA_PROD_TOKEN=<that token>`, `PERSONA_PROD_MONGO=<prod Atlas>`.
4. **gingersoft Phase 2.** At/after the prod promote, move gingersoft (`adminId 6a03e003dcaca7e136b3fc03`)
   persona from `USER.md` → `admins/6a03…/SOUL.md` on Box2, so lazy provisioning doesn't seed a generic
   SOUL over it. (Post-WS-D single workspace = one place; keep the Cantonese-first content.)
5. **Tailnet ACL.** Scope `:8900` on Box2/Box6 to the devboard host — persona is now read+**write** and
   there's no rate-limit on bad tokens (Tailnet-only is the current mitigation).

## Reference
| | Box6 (staging) | Box2 (prod) |
|---|---|---|
| Tailscale IP | `100.77.89.90` | `100.83.72.110` |
| state dir | `/opt/ola-staging/nanobot-state` | `/opt/ola-production/nanobot-state` |
| DB (for devboard names) | dev cluster (`DEV_DATABASE`) | prod cluster (`DATABASE`) |

Design doc: `doc/nanobot_multitenancy_redesign.md`. Persona code: `nanobot/api/persona_api.py` (+ `server.py` mount); devboard `backend/src/controllers/persona.js`, `frontend/.../PersonaPanel.jsx`.
