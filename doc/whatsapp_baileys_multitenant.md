# Ola WhatsApp via Baileys — 多租户实现方案

> 状态：设计研判（前瞻），尚未实现。
> 作者：Yuandong + Claude，2026-05-26。
> 定位：决策从 Meta Tech Provider 反转回 Baileys 之后的新主线。这是一份**实现方案设计**——`Ola_bot/bridge/` 里那份 Baileys 代码是 HKUDS/OpenClaw 上游来的**单租户**实现，`whatsapp.enabled = false`，从未在 Ola prod 跑过。本文把「现有单租户代码的实地审计 + 我们前次项目的踩坑经验 + Ola 多租户需求」合成一套落地设计。

---

## 取证说明（已补齐）

初稿时 web session 只 clone 了 CRM 仓库，sibling `Ola_bot`（nanobot + Baileys bridge）不在手边，所以那些 nanobot 行号当时标了「未核实」。**现已把 `SeekMi-Technologies/Ola_bot`（分支 `ola-main`）clone 进来逐行核对**，本文所有行号——CRM 侧（`backend/src/...`）和 nanobot 侧（`Ola_bot/...`）——都是实地核实过的。下文不再有「未核实」标注。

> nanobot 路径写成 `Ola_bot/...`，对应生产部署里的 sibling `../nanobot/`。

---

## 0. 一段话总结

- **决策反转**：从 Meta WhatsApp Tech Provider（Cloud API / Embedded Signup）回到 Baileys。原因：Meta 在媒体、群、模板审批、Embedded Signup 商户审批上的实际可用能力，对早期外贸 CRM 门槛高、周期长，反而 < Baileys 的「扫码即用」。Tech Provider 路径的完整研判保留在 `whatsapp_multitenancy.md`（若本地存在）。
- **现状**：`Ola_bot/bridge/` 是一份**写死单租户**的 Baileys 接入（1 进程 = 1 socket = 1 authDir = 1 token = 1 WhatsApp 账号），`nanobot.config.template.json` 里 `whatsapp.enabled = false`，从未在 prod 启用。
- **多租户本质**：把这条单租户线复制成「每个销售一条」，并让每条线在 nanobot → CRM MCP 调用里注入正确的 `X-Acting-As`，使每个销售只看到自己的客户/报价。
- **关键利好**：**多租户在 MCP 层已经建好了**——nanobot 的 `MCPClientPool` 按 `(server, acting_as)` 分独立 httpx transport（`Ola_bot/nanobot/agent/tools/mcp.py:259-260`），CRM 侧 `X-Acting-As` 鉴权链也齐全。缺的只有两块：(1) bridge 从单连接变多连接；(2) WhatsApp channel 把 `_acting_as` 喂进消息 metadata（email channel 已经这么做了，WhatsApp 没做）。
- **推荐路径**：**单进程多 WebSocket route**（`/wa/<admin_id>`），per-admin 独立 authDir + 确定性 acting_as 注入 + 4 个历史坑全部前置规避。
- **acting_as 是隐藏主线**：CRM MCP server 要求 `X-Acting-As`，业务工具缺它就 401（`headerResolver.js:30-35`）。askola **网页**路径在 `chat.js:317` 注入了；但 channel 路径靠的是把 `_acting_as` 放进 `InboundMessage.metadata`，agent loop 再取出来设置（`loop.py:683-685`）。email 做了（`email.py:190-191`），**WhatsApp 没做**（`whatsapp.py:284-288` 的 metadata 里没有 `_acting_as`）——这是当前的核心缺口。

---

## 1. 当前代码状态 —— 单租户、acting_as 缺口

### 1.1 CRM 侧：WhatsApp 是关着的

`ola/nanobot.config.template.json` 的 channels 段：

```json
"whatsapp": {
  "enabled": false,
  "bridgeUrl": "ws://localhost:3001",
  "bridgeToken": "",
  "allowFrom": [],
  "groupPolicy": "open"
}
```

| 字段 | 现状 | 多租户含义 |
|---|---|---|
| `enabled` | `false` | 从未在 prod 启用 |
| `bridgeUrl` | 单一 `ws://localhost:3001` | **单连接**，无 per-admin 路由 |
| `bridgeToken` | 空 | nanobot 侧会自动生成本地 secret（见 §1.3） |
| `allowFrom` | `[]` | 无白名单 |
| `groupPolicy` | `open` | 群消息全收 |

### 1.2 nanobot bridge：写死单租户（实地核实）

`Ola_bot/bridge/src/` 四个文件：`index.ts`（入口）、`server.ts`（WS server）、`whatsapp.ts`（Baileys 包装）、`types.d.ts`。

**单租户铁证：**

- `Ola_bot/bridge/src/index.ts:26-28` — 三个全局单值：
  ```ts
  const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
  const AUTH_DIR = process.env.AUTH_DIR || join(homedir(), '.nanobot', 'whatsapp-auth');
  const TOKEN = process.env.BRIDGE_TOKEN?.trim();
  ```
  单端口、单 authDir、单 token。
- `Ola_bot/bridge/src/server.ts:33` — `BridgeServer` 持有 **唯一** 一个 `private wa: WhatsAppClient | null`。
- `server.ts:127-134` — `broadcast()` 把每条消息发给 **所有** 连上来的 Python client，没有路由概念。
- `server.ts:44-56` — WS server 绑 `127.0.0.1`、拒绝带 `Origin` 头的浏览器连接、要求首帧 `auth` token（`server.ts:72-85`）。安全基线不错，但 token 是单一全局的。

`whatsapp.ts` 里的 `WhatsAppClient`（`whatsapp.ts:43`）：

- `whatsapp.ts:79` — `useMultiFileAuthState(this.options.authDir)`，authDir 由构造参数注入（来自 index.ts 的单一 AUTH_DIR）。
- `whatsapp.ts:3` — 注释 "Based on OpenClaw's working implementation"——和我们前次项目同源。
- 只订阅三个事件：`connection.update`（`whatsapp.ts:106`）、`creds.update`（`whatsapp.ts:138`）、`messages.upsert`（`whatsapp.ts:141`）。**没有任何 `contacts.*` 订阅**（坑 2.1 的根源）。

### 1.3 bridge 启动 / token 自动发放

- `Ola_bot/nanobot/channels/whatsapp.py:39-53` — `_load_or_create_bridge_token()`：bridge token 不配就在 `~/.nanobot/whatsapp-auth/bridge-token` 自动生成（`secrets.token_urlsafe(32)`，chmod 600）。
- `whatsapp.py:309-357` — `_ensure_bridge_setup()`：把 bridge 源码 copy 到 `get_bridge_install_dir()`，`npm install` + `npm run build`，缓存 `dist/index.js`。
- `whatsapp.py:92-118` — `login()`：spawn `npm start` 跑 bridge 进程做 QR 扫码（阻塞到扫完）。

### 1.4 核心缺口：WhatsApp 入站没有 acting_as

这是当前代码里**已存在、只是没被触发**的问题（WhatsApp 没启用过）。

**acting_as 在 nanobot 里的真实流转机制（实地核实）：**

1. acting_as 是个 contextvar（`Ola_bot/nanobot/agent/admin_context.py`：`set_acting_as` / `get_acting_as`）。
2. **网页路径**：`Ola_bot/nanobot/api/server.py:236` — `set_acting_as(request.headers.get("X-Ola-Acting-As"))`。CRM 的 `chat.js:317` 发 `X-Ola-Acting-As`，server.py 设进 contextvar。
3. **channel 路径**：contextvar **不跨 bus queue 传播**，所以每个 channel 必须把 admin_id 放进 `InboundMessage.metadata["_acting_as"]`，agent loop 在 `_dispatch` 里取出来重新 set。原话见 `Ola_bot/nanobot/agent/loop.py:683-685`：
   ```python
   # Re-establish acting-as in this task's context: ContextVar does not
   # propagate across the bus queue, so channels carry it via metadata.
   _acting = (msg.metadata or {}).get("_acting_as")
   set_acting_as(_acting)
   ```
4. MCP 调用按 acting_as 分 transport：`Ola_bot/nanobot/agent/tools/mcp.py:259-260` — `MCPClientPool` 为每个 `(server, acting_as)` 建独立 httpx client，把 `X-Acting-As` 在 client 构造时 bake 进 header。**多租户在 MCP 层已经天然支持 N 个并发 acting_as。**

**email 怎么喂的（正确参照，实地核实）：**

- `Ola_bot/nanobot/channels/email.py:177` — `admin_id = await self._resolve_sender_acting_as(sender)`
- `email.py:267-345` — `_resolve_sender_acting_as` 调白名单 MCP 工具 `salesperson.lookup_by_email`（发件人邮箱 → admin._id）。这工具被 CRM 放进 `SYSTEM_TOOLS` 白名单（`headerResolver.js:15`），解决「先有鸡还是先有蛋」——它本身不需要 acting_as 就能调。
- `email.py:190-191` — `item_metadata["_acting_as"] = admin_id`
- `email.py:193-198` — `_handle_message(..., metadata=item_metadata)`，把 acting_as 喂进去。

**WhatsApp 的缺口（实地核实）：**

- `Ola_bot/nanobot/channels/whatsapp.py:279-289` — 调 `_handle_message` 时 `metadata` 只有 `{message_id, timestamp, is_group}`，**没有 `_acting_as`**：
  ```python
  await self._handle_message(
      sender_id=sender_id,
      chat_id=sender,
      content=content,
      media=media_paths,
      metadata={
          "message_id": message_id,
          "timestamp": data.get("timestamp"),
          "is_group": data.get("isGroup", False),
      },
  )
  ```
- 后果（结合 `loop.py:684` + `headerResolver.js`）：WhatsApp 消息进 loop 时 `_acting = None` → `set_acting_as(None)` → MCP 业务工具（`customer.*` / `merch.*` / `quote.*`）缺 `X-Acting-As` → **401**（`headerResolver.js:30-35`，非白名单工具）。agent 干不了正事。

**CRM 侧鉴权链（实地核实）：**

- `backend/src/mcp/headerResolver.js:22-44` — `decideActingAdmin`：无 acting_as 且非白名单 → 401；白名单工具（`SYSTEM_TOOLS`，`headerResolver.js:9-20`）→ 回退 systemAdmin；有 acting_as → `resolveActingAdmin`。
- `backend/src/mcp/bootstrap.js:56-70` — systemAdmin = 第一个 enabled owner（acting_as 缺失兜底）。
- `backend/src/controllers/appControllers/olaController/chat.js:316-317` — 网页 askola 注入 `X-Ola-Acting-As`。

> **结论**：多租户的 MCP 管道（per-acting_as transport）+ CRM 鉴权 + email 的注入范式**全都现成**。WhatsApp 多租户的核心改造量集中在两点：bridge 多连接（§3/§4.2）+ WhatsApp channel 把 `_acting_as` 喂进 metadata（§4.4）。

### 1.5 既有结构能复用什么

- Baileys socket 生命周期包装（`whatsapp.ts` 的 `WhatsAppClient`）、media 下载（`whatsapp.ts:190-217`）、文本/语音/媒体内容提取（`whatsapp.ts:219-251`）——直接复用。
- 语音转写已接好：`whatsapp.py:259-269` 调 `self.transcribe_audio`（和 #257 STT 工作同源）。
- 消息去重：`whatsapp.py:77` + `217-222`（OrderedDict 上限 1000）——复用。
- bridge ↔ Python WebSocket 双向流模式——保留，改成多路由。

不需要从零重写 Baileys 接入，只需把「连接维度」从 1 改 N，并补 acting_as + contacts 持久化 + robustness。

---

## 2. 4 个历史坑 —— 现已在本代码库定位

> 这 4 个是我们前次项目（OpenClaw 等）踩过的。因为本 bridge 同源（`whatsapp.ts:3`），逐行核对后确认它们**在现有代码里全部存在或半成品**。每条：现象 → Baileys 真相 → 现有代码定位 → 多租户设计要点。

### 2.1 联系人自定义名字看不见

- **现象**：销售在手机里给客户改了备注「老王 - 美的厨具」，但入站消息里只有 phone/JID，CRM 客户列表全是号码。
- **Baileys 真相**：`pushName` 每条消息都带（对方自设的 profile name，非销售备注）；销售手机端的备注名要靠 `contacts.upsert` / `contacts.update` 事件同步，启动时 `contacts.set` 给一次快照。
- **现有代码定位**：
  - `whatsapp.ts` **完全没订阅 `contacts.*`**（只有 connection/creds/messages 三个事件，`whatsapp.ts:106/138/141`）。
  - 入站 payload（`whatsapp.ts:176-185`）只暴露 `sender`（`msg.key.remoteJid`）+ `pn`（`msg.key.remoteJidAlt`），**既无 pushName 也无 displayName**。
- **多租户设计要点**：
  1. bridge per-admin client 各自订阅 `contacts.upsert` + `contacts.update` + 启动 `contacts.set`。
  2. 入站 payload 加 `displayName`，优先级 `contacts 备注名 > pushName > phone > LID`。
  3. per-admin 持久化 `jid → displayName`（§4.1 `state.json`），重启不丢。

### 2.2 超长号码（LID 长数字串）

- **现象**：sender 显示成 `...@lid.whatsapp.net` 的 19-20 位长串，不是 `+86` 电话，跟 CRM Client 对不上。
- **Baileys 真相**：WhatsApp 2024 多设备协议起把部分场景的 phone 换成不透明 **LID**，新对话/群成员常拿不到 phone↔LID 映射。
- **现有代码定位**（已有处理，但脆弱）：
  - `whatsapp.py:232-251` 已按 JID 后缀分类 phone/LID 并算 `sender_id`，fallback 链 `whatsapp.py:251`：`phone_id or self._lid_to_phone.get(lid_id) or lid_id or id_a or id_b`。
  - **但 `self._lid_to_phone` 是进程内 dict（`whatsapp.py:78`），只在「同一条消息里 phone 和 LID 同时出现」时才写入（`whatsapp.py:249-250`），且 bridge/进程重启全丢**——这正是前次踩的坑。
  - `whatsapp.py:281` 用 `chat_id=sender`（完整 LID）做回复地址。
- **多租户设计要点**：
  1. per-admin `state.json` 持久化 `lid → phone`，启动加载。
  2. bridge 订 `contacts.set` 启动快照，bootstrap 一批 lid↔phone。
  3. 显示层 fallback `displayName > phone > LID`，**LID 只做内部主键，永不直接展示给销售**。
  4. CRM Client 绑定字段（§5.2）记 `wa_jid` + `wa_jid_kind`（phone/lid），将来拿到 phone 回填。

### 2.3 Baileys 历史信息导入 API 不可靠

- **现象**：销售期望看到接入前几个月的 WA 对话，但多设备协议下即使开 `syncFullHistory` 也只有最近 ~50 会话，且该 API 半年内多次 breaking。
- **Baileys 真相**：历史回看是多设备协议本身的限制，开关救不了。
- **现有代码定位**：`whatsapp.ts:94` — `syncFullHistory: false`（现状已关，是对的）。
- **多租户设计要点**：
  1. `syncFullHistory: false` 保留。
  2. 产品端明确文案：「Ola 接管后只处理**新对话**，历史在你手机里」（onboarding 扫码页写清）。
  3. 不写依赖历史回看的功能；真要历史，走 nanobot message store 从启用起自累积。

### 2.4 Bridge 连接不稳

- **现象**：长跑后偶尔「不收消息但也不报 disconnect」（zombie）；或重连风暴；或固定 5s 重连撞 ws server 重启。
- **Baileys 真相**：socket 的 `'close'` 事件不可靠，必须有应用层 staleness 检测。
- **现有代码定位**（两侧都是裸 5s，无 backoff/heartbeat）：
  - bridge：`whatsapp.ts:116-130` — `connection === 'close'` 时固定 `setTimeout(reconnect, 5000)`，只靠 `reconnecting` 布尔防重入，**无 heartbeat、无 backoff、无 staleness 检测**。
  - Python：`whatsapp.py:154-156` — 连接异常后固定 `await asyncio.sleep(5)` 重连，**同样无 backoff**。
- **多租户设计要点**：
  1. heartbeat：每 30s 检查上次收消息时间，>90s 无 traffic 主动 reconnect（不等 close 事件）。
  2. backoff：`5s → 15s → 45s → 120s`（cap），连上后 reset。
  3. 状态机扩 `reconnecting` / `stale_detected`，broadcast 给 Python → CRM → 前端。
  4. **per-admin 隔离**：一个销售的重连风暴不能拖累别人——单进程方案必须把每个 client 的事件 handler 用 try/catch 包在 client 边界内（符合 CLAUDE.md「无 silent error」：catch 里 log 具体 admin_id + 错误）。

---

## 3. 多租户改造的核心选项（三选一）

### 选项 A：每租户独立 Node bridge 进程

- N 进程 × ~120-150MB，N 端口，N supervisor 单元。
- ✅ 隔离最彻底；authDir 进程级 + 文件级双隔离；坑 2.4 传染风险 = 0。
- ❌ 资源最贵（8 销售 ≈ 1GB+）；端口/supervisor 复杂；动态增删销售要动 supervisor。

### 选项 B：单进程多 socket，payload 打 tenant_id tag

- 1 进程 N 个 Baileys socket，inbound/outbound payload 加 `tenant_id` 路由。
- ✅ 资源最低。
- ❌ 路由靠 tag 易串号（现有 `broadcast` 是发给所有 client，`server.ts:127-134`，要彻底改造）；同进程多 socket 错误隔离未验证；坑 2.4 一个 socket 抖动可能拖全员。

### 选项 C ★ 推荐：单进程多 WebSocket route（`/wa/<admin_id>`）

- bridge 暴露路由级接口 `/wa/<admin_id>?token=<per_admin_token>`。
- 进程内 `Map<admin_id, WhatsAppClient>`，每路由独立 authDir + state.json。
- nanobot 侧每个启用 WA 的销售一个 channel 实例连自己的 route。
- ✅ 资源共享 + **路由级隔离**（连接维度带 admin_id，outbound 不可能串号）；**acting_as 确定性**（route 即 admin_id，§4.4 零查找）；动态增删销售 = 加/删一条路由。
- ❌ 单进程 fate-share——靠 systemd auto-restart + client 边界 try/catch 缓解；authDir 在磁盘，重启自动恢复会话免重扫码。

### 对比表

| 维度 | A 多进程 | B 单进程多 socket | C 单进程多 route ★ |
|---|---|---|---|
| 资源（8 销售） | ~1GB+ | 最低 | 低 |
| 隔离强度 | 最强 | 弱（靠 tag） | 强（靠 route） |
| 部署复杂度 | 高 | 低 | 低 |
| 坑 2.4 传染风险 | 0 | 高 | 低（client 边界） |
| outbound 串号风险 | 0 | 中 | 0（route 物理隔离） |
| acting_as 注入 | 需查找 | 需查找 | **确定性（route=admin_id）** |
| 改动量（对照现有代码） | 重写 supervisor + 进程管理 | 重写 broadcast 路由 + socket 管理 | 重写 server.ts 为多路由 + channel 绑 admin_id |
| 动态增删销售 | 改 supervisor | 改 config | 加/删路由 |

**推荐 C**：综合最优，且最贴合现有架构——MCP 层（`mcp.py` per-acting_as transport）已支持 N 租户，bridge 只需从「单 `wa`」变「`Map<admin_id, wa>`」，channel 只需把 route 的 admin_id 当 `_acting_as` 喂进 metadata。单进程 fate-share 是唯一真实代价，systemd auto-restart + 磁盘 authDir 把它压到可接受。规模真大时可平滑演进成「每 N 销售一进程」分片。

> **与 email 模型的对比**：email 是「单公司邮箱 + 按发件人查归属销售」（`salesperson.lookup_by_email`）。WhatsApp 路径 C 是「每销售自己的 WA 号 + acting_as = 连接本身」，**不需要查找工具**——因为身份是「哪条 route 收到的」而非「sender 是谁」。这是 WhatsApp 比 email 更干净的地方。

---

## 4. 推荐方案（路径 C）落地设计

### 4.1 文件结构（per-admin 隔离）

```
~/.nanobot/wa/<admin_id>/
├── auth/          ← Baileys useMultiFileAuthState 目录（替代现 ~/.nanobot/whatsapp-auth/）
├── media/         ← 下载的媒体（现 whatsapp.ts:192 是 authDir/../media，改成 per-admin）
└── state.json     ← lid→phone 映射 + jid→displayName 映射 + 元数据
```

`state.json` 是坑 2.1 + 2.2 的持久化载体（替代现 `whatsapp.py:78` 的进程内 `_lid_to_phone`）：

```jsonc
{
  "admin_id": "665f...",
  "contacts": {
    "<jid>": {
      "displayName": "老王 - 美的厨具",   // contacts.update 来
      "pushName": "Wang",                  // messages.upsert 带
      "phone": "+8613800138000",           // E.164，可能 null
      "lid": "98765432109876543210",       // 可能 null
      "source": "contacts",                // contacts | pushName | manual
      "updatedAt": 1716700000
    }
  },
  "lidToPhone": { "98765432109876543210": "+8613800138000" }
}
```

> 现有单 authDir `~/.nanobot/whatsapp-auth/`（`index.ts:27`）作废，第一个销售直接走新结构，无需迁移（WA 从没启用过）。

### 4.2 bridge 接口（新）

把 `server.ts` 的单 `wa` 改成 `Map<admin_id, WhatsAppClient>`，按 WS 路径路由：

| 方法 | 路径 | 作用 |
|---|---|---|
| `WS` | `/wa/<admin_id>?token=<per_admin_token>` | 双向流：auth + inbound + outbound（替代现 `broadcast` 全员广播） |
| `GET` | `/wa/<admin_id>/status` | `connected`/`qr_pending`/`reconnecting`/`disconnected`/`logged_out` |
| `POST` | `/wa/<admin_id>/login` | 触发该销售 QR 生成 |
| `DELETE` | `/wa/<admin_id>` | logout + 清 `auth/` |

- `per_admin_token`：每销售一个，不要复用现在的单一全局 token（`index.ts:28`）。建议 `HMAC(MCP_SERVICE_TOKEN, admin_id)` 派生，免存 token 表。
- 保留现有安全基线：绑 `127.0.0.1`、拒 Origin（`server.ts:44-56`）。

### 4.3 nanobot config —— 从静态 section 改 DB-driven

现状是静态单 `[whatsapp]` section（`WhatsAppConfig`，`whatsapp.py:23-30`）。多租户：

- ❌ N 个静态 `[whatsapp.tenants.<admin_id>]`：每加销售改 config + 重启，运维噩梦。
- ✅ **推荐**：留一个总开关，销售列表从 Mongo 拉——nanobot 启动查 `Admin.find({ wa_enabled: true })`（§5.1），为每个销售起一个 `WhatsAppChannel` 实例连对应 route。启用/停用改 DB → nanobot reconcile（或 CRM 调 reload 接口）。加销售 = 纯数据操作，零 config 改动、零重启。

### 4.4 acting_as 注入（解 §1.4 缺口）—— 改动很小

路径 C 让它变确定性，且完全套用 email 已验证的范式：

1. `WhatsAppChannel.__init__`（`whatsapp.py:71`）**绑定 `admin_id`**（它连的那条 route 的 id）。
2. `_handle_bridge_message`（`whatsapp.py:279-289`）调 `_handle_message` 时，metadata 加一行：
   ```python
   metadata={
       "message_id": message_id,
       "timestamp": data.get("timestamp"),
       "is_group": data.get("isGroup", False),
       "_acting_as": self._admin_id,   # ← 新增，对照 email.py:191
   },
   ```
3. 下游全自动跑通：`loop.py:684` 取 `_acting_as` → `set_acting_as` → `mcp.py:259-260` 把 `X-Acting-As` bake 进该 admin 的 transport → CRM `resolveActingAdmin`（`bootstrap.js:88+`）正确 scope。
4. **不需要** email 那种 `salesperson.lookup_by_email`——WhatsApp 的销售身份来自 route，不是 sender。sender（客户 phone/LID）只用来匹配/创建 Client（`assigned` = 该 admin，§5.2）。

### 4.5 contacts / pushName 持久化（解坑 2.1 + 2.2）

bridge per-admin client：

1. 订阅 `contacts.set`（启动快照）+ `contacts.upsert` + `contacts.update` → 写 `state.json` 的 `contacts` + `lidToPhone`。
2. 每条 `messages.upsert`（`whatsapp.ts:141`）取 `msg.pushName`，按优先级回填 `displayName`（不覆盖已有 contacts 备注）。
3. 入站 payload（`whatsapp.ts:176-185`）加 `displayName` 字段（已算好），Python/CRM 不重复算。
4. `state.json` 写盘 debounce（~5s），避免高频消息打爆磁盘。

CRM 侧：Client 落 `wa_jid` + `wa_display_name`（§5.2），展示用 `wa_display_name`，匹配用 `wa_jid`。

### 4.6 connection robustness（解坑 2.4）

每个 `WhatsAppClient` 内置（替代现 `whatsapp.ts:123-129` 的裸 5s）：

1. heartbeat：每 30s 检查 `lastTrafficAt`，`now - lastTrafficAt > 90s` → 主动 reconnect。
2. backoff：`5s → 15s → 45s → 120s`（cap），连上 reset。
3. 状态广播 `connected/reconnecting/stale_detected/logged_out`，经 WS → Python（`whatsapp.py:291-299` 的 status 分支扩展）→ CRM → 前端。
4. 错误边界：单 client 所有 handler 包 try/catch，异常只 log（带 admin_id）+ 标该 client 状态，**绝不冒泡到进程事件循环**（保护其他销售）。Python 侧 `whatsapp.py:154-156` 同步加 backoff。

---

## 5. Ola CRM 侧 schema 改动（最小集合）

> 沿用 repo 既有「可选字段 + 默认值 + 无 migration」模式（`Admin.js` 的 `language` / `transcribeProvider`：旧文档读 `undefined`/`null`，consumer fallback）。

### 5.1 Admin model（`backend/src/models/coreModels/Admin.js`）

```js
// WhatsApp 多租户接入（per-salesperson Baileys 连接）
wa_enabled: { type: Boolean, default: false },   // nanobot 据此决定是否起 channel
wa_bridge_status: {
  type: String,
  enum: ['connected', 'qr_pending', 'reconnecting', 'disconnected', 'logged_out'],
  default: 'disconnected',
},
wa_phone_number: { type: String, default: null },  // 绑定后展示号码（E.164）
```

旧 Admin 读到 `wa_enabled=false`，nanobot 不为其起 channel——零 migration。

### 5.2 Client model（`backend/src/models/appModels/Client.js`）

```js
wa_jid: { type: String, default: null, index: true },                 // 稳定主键：优先 E.164，退 LID
wa_jid_kind: { type: String, enum: ['phone', 'lid'], default: null }, // 标明 wa_jid 类型（坑 2.2）
wa_display_name: { type: String, default: null },                     // bridge 同步的备注名
```

Client 已有 `assigned: { ref: 'Admin' }`（`Client.js:21`）——**现成的销售归属字段**。WA 入站匹配/创建 Client 时 `assigned` = acting_as 的 admin_id，多租户客户归属天然落这里。

### 5.3（推迟到 Phase 2）Organization / Membership

本期：**1 admin = 1 WA 业务号**，各连各的。`whatsapp_multitenancy.md §3` 的「6 销售 + 2 主管共享组织视图」是 Phase 2，不阻塞本期。

---

## 6. 上线路径

### P0（上线 blocker）

1. **bridge 多租户路由改造**：`server.ts` 单 `wa` → `Map<admin_id, WhatsAppClient>`，`/wa/<admin_id>` 路由（§4.2）。
2. **per-admin authDir + state.json**（§4.1）。
3. **acting_as 注入**（§4.4）：`WhatsAppChannel` 绑 admin_id，metadata 加 `_acting_as`。**多租户隔离的命门，一行的事但漏了就全员归 systemAdmin。**
4. **contacts 持久化**（§4.5）→ 解坑 2.1 + 2.2。
5. **heartbeat + backoff**（§4.6）→ 解坑 2.4。
6. **CRM schema**（§5.1 + §5.2）。
7. **Onboarding UX**：QR 扫码页 + 状态展示（含坑 2.3「只接管新对话」文案）。

### P1（上线后迭代）

- acting_as 解析失败 fallback（销售没绑 WA / 解析不到 → agent 回什么，而非 401 裸奔）。
- 多设备 / 多端 logout 探测（销售手机「退出已链接设备」→ bridge 标 `logged_out`）。
- WA 媒体从本地 `media/` 下沉对象存储。
- 坑 2.3 产品文案 + 自累积 message store。

---

## 7. 待 Yuandong 决策的开放问题

| # | 优先级 | 问题 | 我的倾向 |
|---|---|---|---|
| Q1 | P0 | 路径选 A / B / C？ | **C**（§3 对比表：acting_as 确定性 + 路由隔离 + 最贴合现有 MCP 多租户管道） |
| Q2 | P0 | bridge / nanobot / CRM 三处改动一个 PR 还是拆？ | **拆 2 个**：Ola_bot PR（bridge 多路由 + whatsapp.py acting_as + contacts + robustness，PR → `ola-dev`）；CRM PR（schema + onboarding UI，PR → `dev`） |
| Q3 | P0 | per_admin_token 怎么发？ | **HMAC(MCP_SERVICE_TOKEN, admin_id) 派生**，免存 token 表（§4.2） |
| Q4 | P0 | WA 业务号模型：每销售各扫各的号（路径 C 前提），还是单公司号 + 按客户查归属（email 模型）？ | **每销售各扫各号**——隔离干净、acting_as 零查找。若要单号共享走 email 模型那套，是另一条路。 |
| Q5 | P1 | authDir 备份策略？ | ECS 本地 + 定期快照；丢了重扫码（authDir 可再生） |
| Q6 | P1 | 一个销售多设备登录？ | Baileys 是 linked device，主机退链即废——P1 探测 + 提示重扫 |
| Q7 | P2 | 群消息政策？ | 现 `groupPolicy: open`（`whatsapp.py:30/228-230`）；建议改 `mention` 对齐其他 channel |

---

## 附：本文引用的真实代码锚点

### CRM 侧（`SeekMi-Technologies/Ola`）

| 文件 | 行 | 内容 |
|---|---|---|
| `ola/nanobot.config.template.json` | whatsapp 段 | `enabled:false` / 单 `bridgeUrl` |
| `backend/src/mcp/headerResolver.js` | 9-20 | `SYSTEM_TOOLS` 白名单（含 `salesperson.lookup_by_email`） |
| `backend/src/mcp/headerResolver.js` | 22-44 | `decideActingAdmin`：缺 acting_as 且非白名单 → 401 |
| `backend/src/mcp/bootstrap.js` | 56-70 | systemAdmin 兜底 |
| `backend/src/mcp/bootstrap.js` | 88+ | `resolveActingAdmin` |
| `backend/src/controllers/appControllers/olaController/chat.js` | 316-317 | 网页注入 `X-Ola-Acting-As` |
| `backend/src/models/coreModels/Admin.js` | 39-55 | 可选字段模式参照 |
| `backend/src/models/appModels/Client.js` | 21 | `assigned: ref Admin`（现成销售归属） |

### nanobot 侧（`SeekMi-Technologies/Ola_bot` @ `ola-main`）

| 文件 | 行 | 内容 |
|---|---|---|
| `bridge/src/index.ts` | 26-28 | 单 PORT / 单 AUTH_DIR / 单 TOKEN |
| `bridge/src/server.ts` | 33 | 单 `wa: WhatsAppClient`（单租户） |
| `bridge/src/server.ts` | 127-134 | `broadcast` 全员广播（无路由） |
| `bridge/src/server.ts` | 44-56 | 绑 127.0.0.1 + 拒 Origin + 单 token |
| `bridge/src/whatsapp.ts` | 3 | "Based on OpenClaw" |
| `bridge/src/whatsapp.ts` | 94 | `syncFullHistory: false`（坑 2.3） |
| `bridge/src/whatsapp.ts` | 106/138/141 | 仅订阅 connection/creds/messages，**无 contacts.\***（坑 2.1） |
| `bridge/src/whatsapp.ts` | 116-130 | 固定 5s 重连，无 heartbeat/backoff（坑 2.4） |
| `bridge/src/whatsapp.ts` | 176-185 | 入站 payload 只有 sender+pn，无 pushName/displayName（坑 2.1） |
| `nanobot/channels/whatsapp.py` | 78 / 249-251 | `_lid_to_phone` 进程内 dict，重启丢（坑 2.2） |
| `nanobot/channels/whatsapp.py` | 154-156 | Python 侧固定 5s 重连（坑 2.4） |
| `nanobot/channels/whatsapp.py` | 279-289 | `_handle_message` metadata **缺 `_acting_as`**（核心缺口） |
| `nanobot/channels/email.py` | 177 / 190-191 / 193-198 | email 解析 + 注入 `_acting_as`（正确参照） |
| `nanobot/channels/email.py` | 267-345 | `_resolve_sender_acting_as` 走 `salesperson.lookup_by_email` |
| `nanobot/agent/loop.py` | 683-685 | `_dispatch` 从 metadata 取 `_acting_as` → `set_acting_as` |
| `nanobot/agent/tools/mcp.py` | 259-260 | `MCPClientPool` 按 acting_as bake `X-Acting-As`（多租户管道已建好） |
| `nanobot/api/server.py` | 236 | 网页路径 `set_acting_as(X-Ola-Acting-As)` |
| `nanobot/agent/admin_context.py` | — | acting_as contextvar 定义 |
