# Ola WhatsApp via Baileys — 多租户实现方案

> 状态：方案已定稿，待排期实现。
> 作者：Yuandong + Claude · 2026-05-26
> 范围：CRM（`SeekMi-Technologies/Ola`）+ nanobot（`SeekMi-Technologies/Ola_bot @ ola-main`）

---

## TL;DR

1. **决策反转**：放弃 Meta Tech Provider，回到 Baileys 自建（Meta 审批门槛 > Baileys 扫码即用）。
2. **架构已定**：每个销售扫**自己的** WhatsApp 号；bridge 用**单进程 + URL 路由**（`/wa/<admin_id>`）承载所有销售，省内存。
3. **隔离靠 acting_as**：每条连接绑定一个销售 id，注入 `X-Acting-As`，让每个销售只看到自己的客户/报价。多租户的 MCP 管道**已经建好**，缺的只是 bridge 改多连接 + WhatsApp channel 喂一个字段。
4. **一个先于一切的必修 bug**：现有 `syncFullHistory:false` 在我们锁的 Baileys 版本上会**静默丢掉所有消息**——这是 P0 第 0 项，也是其它几个坑的根因。
5. 这份文档的技术假设全部对着真实代码 + 联网核实的 Baileys v7 行为校准过（见附录）。

---

## 1. 已确定的决策

| # | 问题 | 决策 |
|---|---|---|
| **架构** | bridge 多租户结构 | **单进程 + URL 路由**（`/wa/<admin_id>`），进程内 `Map<admin_id, WhatsAppClient>`，省内存 |
| **号码模型** | 每销售各扫各号，还是共用公司号 | **各扫各号** —— 隔离干净，acting_as = 连接本身，无需查找 |
| **Token** | 每销售连 bridge 的鉴权 | **HMAC(`MCP_SERVICE_TOKEN`, admin_id) 现算** —— 不建表，两边各自算、必然一致（详见 §5.1） |
| **群消息** | 是否处理 | **暂不做** —— Baileys 群识别 bug 多（成员返回 @lid、退群断连），后续再说 |
| **authDir 备份** | 凭证丢了怎么办 | **不备份，重新扫码** —— authDir 可再生 |
| **多设备退出** | 销售手机端退出已链接设备 | **P1 做探测** —— bridge 感知后标 `logged_out` 提示重扫 |
| **PR 拆分** | 改动怎么提交 | **后续再定** —— 不阻塞设计 |

> 下文所有设计都基于「单进程 URL 路由 + 各扫各号」这个已定前提，不再列其它选项。

---

## 2. 现状：一份写死的单租户实现

`Ola_bot/bridge/` 是从 HKUDS / OpenClaw 上游来的 Baileys 接入，`whatsapp.enabled = false`，**从未在 Ola 启用过**。它的形态是：

```
1 个 Node 进程  =  1 个 Baileys socket  =  1 个 authDir  =  1 个 token  =  1 个 WhatsApp 账号
```

三个关键事实（行号见附录 A）：

- **单租户写死**：bridge 全局单 PORT / 单 authDir / 单 token；`BridgeServer` 只持有一个 `WhatsAppClient`；收到的消息广播给所有连上来的 Python client，没有路由概念。
- **acting_as 缺口**：CRM 的 MCP server 要求 `X-Acting-As`，业务工具缺它就 401。**网页 askola** 已注入；但 **WhatsApp 走的是 nanobot 自己的 channel loop，不经过网页那条路**，目前**完全没注入** acting_as → WhatsApp 消息触发业务工具会 401，或全员错归到同一个兜底账号。
- **好消息**：多租户的底层管道其实**已经建好**了 —— nanobot 的 MCP 客户端池按 acting_as 分独立连接，CRM 的鉴权链也齐全。WhatsApp 多租户的真正工作量只有两块：(1) bridge 从单连接变多连接；(2) WhatsApp channel 把销售 id 当 acting_as 喂进消息。

### acting_as 是怎么流转的（照抄 email 即可）

nanobot 里 acting_as 的传递机制是固定的：**channel 把 admin_id 放进消息的 metadata，agent loop 取出来设置，MCP 客户端据此注入 `X-Acting-As`。**

- **email 做对了**：收到邮件 → 用白名单工具按发件人查出归属销售 → 把 `_acting_as` 塞进 metadata。
- **WhatsApp 没做**：它的 metadata 里只有 `message_id / timestamp / is_group`，没有 `_acting_as`。

所以 WhatsApp 的修法就是照抄 email 的注入动作 —— 而且更简单：路径 C 下销售 id 就是连接的 route，连"查找归属"这步都省了（详见 §4.2）。

---

## 3. 上线前必须规避的技术坑

> 这些坑分两类：**坑 0** 是我们这份代码 + 这个 Baileys 版本上的**实打实 bug**；**坑 1–4** 是前次项目（OpenClaw 等）踩过、且在现有代码里得到印证的设计约束。全部基于联网核实的 Baileys `7.0.0-rc.9` 行为（来源见附录 B）。

### 🔴 坑 0：`syncFullHistory:false` 在 v7 静默丢掉所有消息（P0 第 0 项）

- **症状**：连接显示 ✅，但消息收不到、LID 映射建不起来、群消息不到。
- **根因**：现有代码设了 `syncFullHistory: false` 但**没给 `shouldSyncHistoryMessage` 回调**。在 Baileys v7 里这会让它默认拒绝**所有**同步类型（不只是完整历史，连建立 LID 映射的 `INITIAL_BOOTSTRAP`、会话元数据的 `RECENT` 也一并拒了），消息因此无法路由。
- **实锤**：OpenClaw #14069（**就是我们 bridge 的上游**）+ hermes-agent #11951（同款架构）。bug 在 Baileys 源码已修，但**没发新 npm**，最新仍是我们锁的版本 —— 必须自己加回调。
- **修法**（一行）：
  ```ts
  syncFullHistory: false,
  shouldSyncHistoryMessage: ({ syncType }) => syncType !== 2,  // 只拒 FULL(=2)，放行 BOOTSTRAP/RECENT/ON_DEMAND
  ```
- **为什么排第 0**：坑 1（备注名）、坑 2（LID）之所以会咬人，根源就是这条把初始同步掐了。**哪怕暂不做多租户，这条都该先修。**

### 坑 1：联系人备注名看不见

- **现象**：销售在手机里给客户存了备注「老王 - 美的厨具」，但 CRM 里只显示号码。
- **Baileys 真相**：对方的 profile 名（pushName）能拿到（每条消息都带，`contacts.update` 也会推 `notify` 字段）；但**销售自己存的私人备注名只在 WhatsApp Business 账号才可靠同步**（普通账号未必有）。
- **现有代码**：bridge 完全没订阅联系人事件，入站只暴露号码/JID。
- **对策**：
  1. 订阅 `contacts.update` 拿 pushName，每条消息回填；备注名当「Business 才有」的增强，不依赖。
  2. 显示名优先级：`备注名(若有) > pushName > phone > LID`。
  3. **兜底**：CRM 里允许销售手动给 WA 联系人改名 —— 比死磕 Business 同步更实在。

### 坑 2：超长号码（LID）

- **现象**：发件人显示成 `…@lid.whatsapp.net` 的 19–20 位长串，不是电话号，跟 CRM 客户对不上。
- **Baileys 真相**：WhatsApp 新协议用不透明的 **LID** 替代电话号。官方明确：**PN（电话号）越来越不可靠，应以 LID 为稳定主键**，不要费劲还原成电话。
- **现有代码**：有 LID 处理，但映射存在进程内 dict、重启全丢，且没用上 v7 自带的映射存储。
- **对策**：
  1. **LID 当主键**（CRM 的 `wa_jid` 存 LID），电话号作展示增强、拿到再回填。
  2. 用 Baileys v7 内建的 `signalRepository.lidMapping`（`getPNForLID` 等）+ `lid-mapping.update` 事件，**持久化映射**，重启回灌。
  3. 前提是先修坑 0 —— 没有初始同步，LID 映射根本不下发。

### 坑 3：历史消息导不进来

- **现象**：销售期望看到接入前的历史对话。
- **Baileys 真相**：多设备协议本身的限制，开关救不了（且坑 0 说明：盲目关历史反而更糟）。
- **对策**：保持只接管**新对话**；产品文案写清「历史在你手机里」；真要历史就让 nanobot 从启用起自己累积，不依赖 Baileys 拉。

### 坑 4：连接不稳

- **现象**：长跑后偶尔「不报错但也不收消息」（僵尸连接）；或重连风暴。
- **Baileys 真相**：socket 的 close 事件不可靠，必须有应用层检测。Baileys 自带 `keepAliveIntervalMs` 心跳要配好，但防不住僵尸连接。⚠️ v7 **不再发已读 ACK**（WhatsApp 在封这种号）—— 别加任何已读回执逻辑。
- **现有代码**：bridge 和 Python 两侧都是裸的「固定 5 秒重连」，无退避、无心跳、无僵尸检测。
- **对策**：
  1. 显式设 `keepAliveIntervalMs`（~30s）+ 应用层僵尸检测（>90s 无消息主动重连）。
  2. 重连退避：`5s → 15s → 45s → 120s`（封顶），连上后归零。
  3. 状态机加 `reconnecting` / `stale`，透传到前端让销售看得见。
  4. **错误隔离**：单进程方案下，一个销售的连接异常必须被 try/catch 包在自己的 client 边界内，绝不拖垮其他销售。

---

## 4. 目标架构

### 整体形态

```
                          ┌─────────────── 单个 Node bridge 进程 ───────────────┐
 销售A 手机 ──扫码──▶ WA   │  /wa/<A>  → WhatsAppClient A → authDir A / state A   │
 销售B 手机 ──扫码──▶ WA   │  /wa/<B>  → WhatsAppClient B → authDir B / state B   │
                          │  Map<admin_id, WhatsAppClient>                       │
                          └──────────────┬──────────────────────────────────────┘
                                         │ 每条 route 一个 WS（per-admin token）
                          ┌──────────────▼─────────────┐
                          │ nanobot: 每销售一个          │  inbound 带 _acting_as=admin_id
                          │ WhatsAppChannel 实例         │──────────┐
                          └─────────────────────────────┘          │
                                                    ┌───────────────▼──────────────┐
                                                    │ CRM MCP server                │
                                                    │ X-Acting-As → 只读写该销售数据 │
                                                    └───────────────────────────────┘
```

### 文件布局（per-admin 隔离）

```
~/.nanobot/wa/<admin_id>/
├── auth/         ← 扫码凭证（每销售独立；丢了重扫码）
├── media/        ← 下载的图片/语音/文档
└── state.json    ← LID↔phone 映射 + 显示名映射（持久化，重启不丢）
```

---

## 5. 落地设计（三层）

### 5.1 bridge（Node）

把现有「单 `WhatsAppClient`」改成「按 route 管理的 `Map`」：

| 方法 | 路径 | 作用 |
|---|---|---|
| `WS` | `/wa/<admin_id>?token=<per_admin_token>` | 双向流：扫码事件 + 入站消息 + 出站指令 |
| `GET` | `/wa/<admin_id>/status` | `connected` / `qr_pending` / `reconnecting` / `disconnected` / `logged_out` |
| `POST` | `/wa/<admin_id>/login` | 触发该销售的二维码生成 |
| `DELETE` | `/wa/<admin_id>` | 登出 + 清该销售的 authDir |

- **per-admin token**：`HMAC-SHA256(密钥=MCP_SERVICE_TOKEN, 数据=admin_id)`。bridge 和 nanobot 两边都知道 `MCP_SERVICE_TOKEN`，对同一个 admin_id 各自算出**完全相同**的 token，**不需要建表存**；销售 A 算不出销售 B 的 token，天然隔离。
- 保留现有安全基线（绑 `127.0.0.1`、拒浏览器 Origin）。
- 每个 client 内置坑 0 / 坑 2 / 坑 4 的修法（`shouldSyncHistoryMessage`、`signalRepository.lidMapping`、`keepAliveIntervalMs` + 退避 + 错误隔离）。

### 5.2 nanobot（Python channel）

- 销售列表**从 Mongo 拉**（查 `wa_enabled: true` 的 Admin），为每个销售起一个 `WhatsAppChannel` 实例连对应 route。**加销售 = 改数据库，零 config 改动、零重启。**
- 每个 channel 实例绑定自己的 `admin_id`，入站消息时把 `_acting_as = admin_id` 塞进 metadata —— 就这一行，下游 acting_as 全自动跑通（照抄 email 的注入动作）。
- 不需要 email 那种「按发件人查归属」的查找工具：销售身份来自 route，不是发件人。发件人（客户）只用来匹配/创建 CRM 客户。

### 5.3 CRM（Node / Mongo）

- 新增 schema 字段（§6）。
- WhatsApp 绑定流程的前端：扫码页（展示二维码 + 连接状态）。
- 入站客户匹配：按 `wa_jid`（LID）找/建 Client，归属（`assigned`）= 该销售。

---

## 6. CRM schema 改动（最小集合）

沿用既有「可选字段 + 默认值 + 无需迁移」模式（旧文档读到默认值，行为不变）。

**Admin**（`backend/src/models/coreModels/Admin.js`）：

```js
wa_enabled:       { type: Boolean, default: false },  // nanobot 据此决定是否起 channel
wa_bridge_status: { type: String, enum: ['connected','qr_pending','reconnecting','disconnected','logged_out'], default: 'disconnected' },
wa_phone_number:  { type: String, default: null },    // 绑定后展示号码
```

**Client**（`backend/src/models/appModels/Client.js`）：

```js
wa_jid:          { type: String, default: null, index: true },  // 稳定主键 = LID（v7 官方建议；PN 不可靠）
wa_phone:        { type: String, default: null },               // E.164 展示增强，可能始终为空
wa_display_name: { type: String, default: null },               // 备注/pushName，或销售手动设
```

> Client 已有 `assigned`（ref Admin）—— **现成的销售归属字段**，WA 客户归属直接落这里，不用新造概念。

---

## 7. 上线路径

### P0（上线必须）

| # | 事项 | 解决 |
|---|---|---|
| **0** | 🔴 `shouldSyncHistoryMessage` 修复 | 坑 0 —— 独立小修复，可最先落地 |
| 1 | bridge 单连接 → 多 route（`Map<admin_id, client>`） | 架构 |
| 2 | per-admin authDir + state.json | 文件隔离 |
| 3 | acting_as 注入（channel 绑 admin_id，metadata 加 `_acting_as`） | **隔离命门** |
| 4 | LID / 联系人持久化（内建 lidMapping + 持久化） | 坑 1 + 坑 2 |
| 5 | keepAlive + 僵尸检测 + 退避 + 错误隔离 | 坑 4 |
| 6 | CRM schema（§6） | — |
| 7 | 扫码 onboarding 页 + 状态展示 | 含坑 3「只接管新对话」文案 |

### P1（上线后迭代）

- acting_as 解析失败的兜底（销售没绑 WA 时 agent 回什么，而非裸 401）。
- 多设备退出探测（手机端「退出已链接设备」→ 标 `logged_out` 提示重扫）。
- 媒体文件从本地下沉到对象存储。
- 真要历史回看 → nanobot 自累积消息存储。

---

## 8. 仍待确认

绝大部分已在 §1 定稿。只剩一项实现期再定：

- **PR 拆分方式**：倾向 Ola_bot 一个 PR（bridge + channel）+ CRM 一个 PR（schema + UI），分别 PR 到各自的 dev 分支。开工前确认即可。

---

## 附录 A：代码锚点

### CRM（`SeekMi-Technologies/Ola`）

| 文件 | 行 | 内容 |
|---|---|---|
| `ola/nanobot.config.template.json` | whatsapp 段 | `enabled:false` + 单 `bridgeUrl` |
| `backend/src/mcp/headerResolver.js` | 9-20 / 22-44 | 白名单工具 / 缺 acting_as 非白名单 → 401 |
| `backend/src/mcp/bootstrap.js` | 56-70 / 88+ | systemAdmin 兜底 / `resolveActingAdmin` |
| `backend/src/controllers/appControllers/olaController/chat.js` | 316-317 | 网页注入 `X-Ola-Acting-As` |
| `backend/src/models/coreModels/Admin.js` | 39-55 | 可选字段模式参照 |
| `backend/src/models/appModels/Client.js` | 21 | `assigned: ref Admin`（现成归属字段） |

### nanobot（`SeekMi-Technologies/Ola_bot @ ola-main`，Baileys `7.0.0-rc.9`）

| 文件 | 行 | 内容 |
|---|---|---|
| `bridge/src/index.ts` | 26-28 | 单 PORT / authDir / TOKEN |
| `bridge/src/server.ts` | 33 / 127-134 | 单 `WhatsAppClient` / 全员广播（无路由） |
| `bridge/src/whatsapp.ts` | 94 | `syncFullHistory:false`（**坑 0**） |
| `bridge/src/whatsapp.ts` | 106/138/141 | 仅订阅 connection/creds/messages，无 contacts.*（坑 1） |
| `bridge/src/whatsapp.ts` | 116-130 | 固定 5s 重连，无心跳/退避（坑 4） |
| `bridge/src/whatsapp.ts` | 176-185 | 入站只有 sender+pn，无 pushName/displayName（坑 1） |
| `nanobot/channels/whatsapp.py` | 78 / 249-251 | LID 映射进程内 dict、重启丢（坑 2） |
| `nanobot/channels/whatsapp.py` | 154-156 | Python 侧固定 5s 重连（坑 4） |
| `nanobot/channels/whatsapp.py` | 279-289 | `_handle_message` metadata **缺 `_acting_as`**（核心缺口） |
| `nanobot/channels/email.py` | 177 / 190-198 / 267-345 | email 查归属 + 注入 `_acting_as`（正确参照） |
| `nanobot/agent/loop.py` | 683-685 | 从 metadata 取 `_acting_as` → 设置 |
| `nanobot/agent/tools/mcp.py` | 259-260 | MCP 客户端池按 acting_as 注入 `X-Acting-As`（多租户管道已建好） |
| `nanobot/api/server.py` | 236 | 网页路径设置 acting_as |

## 附录 B：Baileys 联网核实来源（2026-05）

| 主题 | 来源 |
|---|---|
| `syncFullHistory:false` 在 v7 静默丢消息 + 修法 | OpenClaw #14069（本 bridge 上游）、hermes-agent #11951 |
| bug 已修但未发新 npm（仍 `7.0.0-rc.9`） | WhiskeySockets/Baileys releases |
| LID 为稳定主键、PN 不可靠；`signalRepository.lidMapping` / `lid-mapping.update` | Baileys WhatsApp IDs 文档、#2259、#2263 |
| `contacts.upsert` 备注名可能仅 Business；`contacts.update` 带 pushName | Baileys #522 + 社区文档 |
| 群成员返回 @lid、退群断连 | #1505 / #1935 / #2233 / #1226 |
| v7 不再发已读 ACK（封号规避）；`keepAliveIntervalMs` | Baileys v7 迁移指南 |
