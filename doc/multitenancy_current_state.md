# Ola 多租户隔离 — 现状

> 写于 2026-05-25 · ZYD_FEAT
>
> 本文只描述**当前实际**的隔离机制，不含设计方案。读完应能回答："X 模块今天是怎么隔离的？强不强？"

## 0. 核心前提

- 只有 `Admin` model，**没有** `Organization` / `Membership` / `Team` 实体
- **一个 Admin 账号 = 一个公司**（产品级假设，schema 写死）
- JWT payload 只塞 `{ id: admin._id }`
- 所有业务隔离 boundary = `req.admin._id`
- `Admin.role` enum (`owner`/`admin`/`user`) 字段存在但**代码无任何地方读它**

---

## 1. 业务表 CRUD 隔离（Quote / Customer / Merch / ...）

### 机制
- 16 张 [appModel](backend/src/models/appModels/) 全部有 `createdBy: ref Admin` 字段
- generic CRUD ([createCRUDController/](backend/src/controllers/middlewaresControllers/createCRUDController/)) 在 9 个操作上自动按 `createdBy: req.admin._id` filter：`create / read / update / remove / list / listAll / search / filter / summary`
- 所有路由前置 `adminAuth.isValidAuthToken` → 注入 `req.admin`

### 强度分档

| 强度 | 标志 | Models |
|---|---|---|
| 🟢 强 | `required: true` + index | File, ChatSession, ChatMessage, LlmUsage |
| 🟡 中 | `required: true`，无 index | Quote, Invoice, Payment, PurchaseOrder, Comparison, Job |
| 🔴 弱 | `required: false` | Merch, Client, Factory, Currencies, PaymentMode, Taxes |

弱档隔离**靠 controller 注入兜底**，无 schema-level enforce。任一 `create` 调用没传 `createdBy` → 数据进 DB 但任何 admin 都查不到（孤儿数据）。

### 跨账号共享
**不支持**。同公司两个销售（两个 Admin）互相看不到对方的 Quote / Customer / Merch。

### 状态
- 单账号隔离：✅ 严密
- 多账号公司内共享：❌ 不存在

---

## 2. AskOla 聊天隔离（web channel）

### 路径
`frontend → POST /api/ola/chat (cookie auth) → CRM olaController HTTP-proxy → nanobot serve :8900 → agent loop → MCP HTTP → CRM controllers`

### 各层做了什么

| 层 | 隔离机制 |
|---|---|
| CRM olaController | cookie auth → 拿 `req.admin._id` → 注入 `X-Ola-Acting-As: <admin._id>` 到 proxy header |
| nanobot serve | [api/server.py:229](../nanobot/nanobot/api/server.py#L229) 读 header → 写 `contextvars.ContextVar('ola_acting_admin')` |
| nanobot session/memory | 文件路径 `~/.nanobot/workspace/admins/<adminId>/{sessions,memory}/` |
| nanobot MCP client | [agent/tools/mcp.py:202](../nanobot/nanobot/agent/tools/mcp.py#L202) transport pool 按 `(server, acting_as)` 分桶 → 出站请求自动注 `X-Acting-As: <adminId>` |
| CRM MCP server | [mcp/headerResolver.js](backend/src/mcp/headerResolver.js) 业务工具必须带 X-Acting-As（无则 401），系统工具豁免 |
| CRM MCP controllerAdapter | 用 actingAdmin 注入 `req.admin` → 复用 §1 的 generic CRUD filter |

### ChatSession / ChatMessage 表
- schema 用 `userId: ref Admin`（≈ adminId，**历史命名跟其他表的 createdBy 不一致**）
- CRUD 按 userId filter

### 状态
- ✅ 完整 isolation（header → ContextVar → MCP header → CRUD filter 全程贯通）

---

## 3. 邮件 channel 隔离（nanobot gateway）

### 配置
- nanobot gateway :8901 持有**单一** IMAP/SMTP config（`~/.nanobot/config.json` `channels.email`）
- 唯一收件箱：`ola@olatech.ai`
- 所有公司共用同一个收件箱（multi-tenant gap）

### 入站邮件 → admin 映射
1. IMAP poll 30s 拉一批 message
2. 取 `From` header → MCP `salesperson.lookup_by_email` → 回 `admin._id`
3. 写入 `item_metadata._acting_as = admin_id`，发到内部 bus
4. agent loop 读 message ([agent/loop.py:684](../nanobot/nanobot/agent/loop.py#L684)) → `set_acting_as(_acting)` → ContextVar
5. 后续 MCP / session / memory 全部 per-admin scope

### Gap
- 🟡 `salesperson.lookup_by_email` 是 system tool（豁免 X-Acting-As）→ 能查所有公司的 salesperson。多租户后会变成跨公司信息泄漏。
- 🟡 IMAP/SMTP 配置 global → 公司不能用自己的邮箱接入
- 🔴 cron job ([commands.py:738](../nanobot/nanobot/cli/commands.py#L738)) 不 set acting_as → 后台跑落到 `_system/` 工作区

### 状态
- 入站 sender → admin 映射：✅
- 收件箱多租户：❌ 单收件箱模型
- cron 上下文：🔴 缺失

---

## 4. 文件 / 音频存储隔离

### 上传
- `POST /api/file/upload` ([fileController/upload.js](backend/src/controllers/appControllers/fileController/upload.js))
- 落盘：`UPLOADS_DIR/<adminId>/YYYY/MM/<uuid>.ext`
- File doc：`{createdBy, path, contentHash, ...}`
- 读 / list：走 controller，按 `createdBy: req.admin._id` filter ✅

### 公开路径（给 nanobot 拉转写源）
- `GET /public/audio/:adminId/:year/:month/:filename` ([corePublicAudioRouter.js](backend/src/routes/coreRoutes/corePublicAudioRouter.js))
- ❌ **无 auth**
- 防护：4 段 regex 校验 + path-traversal `startsWith` check + UUID-as-secret (122 bits 不可猜)
- 风险：URL 一旦泄漏 → 任何人都能下；admin 之间 URL 互发 → 跨账号泄漏

### 状态
- 私有读：✅
- 公开读：🟡（"URL 即 capability" 模型，跨账号 URL 互泄漏即穿透）

---

## 5. MCP server 隔离（X-Acting-As · issue #185 已落地）

### 机制
- Bearer service token auth ([mcp/auth.js](backend/src/mcp/auth.js))
- Header `X-Acting-As: <admin._id>` 业务工具必带，系统工具豁免
- AsyncLocalStorage 注 actingAdmin 到 request scope ([mcp/context.js](backend/src/mcp/context.js))
- [controllerAdapter.js:64-69](backend/src/mcp/adapters/controllerAdapter.js#L64) 3-tier resolution：`input.admin > context > null`
- [bootstrap.js:102-149](backend/src/mcp/bootstrap.js#L102) `resolveActingAdmin()` 5 分钟 TTL cache + `enabled+!removed` 校验

### 工具集
- 7 read + 11 write = 18 业务工具（必带 X-Acting-As）
- 2 system tool 豁免：`salesperson.lookup_by_email`, `health.ping`

### 状态
- ✅ 完整（jest + curl smoke 覆盖）

---

## 6. 公开下载接口 — 🔴 SECURITY GAP（单/多租户共有）

两条路由**完全无 auth + 完全无 createdBy filter**：

| 路由 | 文件 | 风险 |
|---|---|---|
| `GET /download/:directory/:file` | [downloadHandler/downloadPdf.js](backend/src/handlers/downloadHandler/downloadPdf.js) | 知道 ObjectId 就能下任何公司 PDF |
| `GET /export/excel/...` | [routes/exportRoutes.js](backend/src/routes/exportRoutes.js)（[app.js:115](backend/src/app.js#L115) 注释明确 "不需要身份验证"） | 同上，能导任何公司 Excel |

### 状态
- 🔴 **CRITICAL** — 跟多租户改造**正交**，必须独立修

---

## 7. 前端

- Redux auth slice 只存 admin user 对象（name/email/photo/language/onboarded）
- 零 Organization / Team / Membership 概念
- 路由对登录用户一律放行，无 role gating
- Settings → Team 页 ([SettingsMembers.jsx](frontend/src/pages/Settings/SettingsMembers.jsx)) 是 hardcode mock，无后端 endpoint

### 状态
- N/A（后端就没 org 概念）

---

## 总览表

| # | 模块 | 单账号隔离 | 公司内共享 | 总评 |
|---|---|---|---|---|
| 1 | 业务表 CRUD | ✅ 严密（部分弱档靠 controller） | ❌ 不存在 | ✅ 单账号 / ❌ 多账号 |
| 2 | AskOla 聊天 | ✅ 完整 5 层链路 | ❌ per-admin | ✅ 单账号 / ❌ 多账号 |
| 3 | 邮件入站 sender→admin | ✅ | ❌ 单收件箱 | 🟡 |
| 3b | 邮件 cron 上下文 | 🔴 跑在 `_system/` | — | 🔴 |
| 4 | 文件 upload | ✅ path+DB 双层 | N/A | ✅ |
| 4b | 文件 public read | ❌ 无 auth，UUID-as-secret | N/A | 🟡 |
| 5 | MCP server | ✅ X-Acting-As | ❌ 单 admin | ✅ |
| 6a | `/download` PDF | 🔴 无 auth 无 filter | N/A | 🔴 CRITICAL |
| 6b | `/export/excel` | 🔴 无 auth 无 filter | N/A | 🔴 CRITICAL |
| 7 | 前端 | N/A | ❌ 零 org 概念 | — |

## 一句话总结

**单账号隔离整体严密**（业务表 CRUD / AskOla / MCP 三大主链路都过关），但有两个洞要分开看：

1. 🔴 `/download` `/export/excel` 公开接口**无 auth 无 filter** — 跟多租户改造**无关**，是独立 security bug，应立刻修
2. ❌ "一个 Admin = 一个公司" 是 schema 级假设 — **没有任何机制允许"同公司多用户共享数据"**，这是真正要做的多租户改造

🟡 次要 gap：`/public/audio` URL-as-secret 模型、邮件单收件箱、cron 缺 admin context、`Merch/Client` 等弱档 createdBy。
