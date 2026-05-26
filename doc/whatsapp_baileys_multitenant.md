# Ola WhatsApp via Baileys — 多租户实现方案（从零写起）

> 状态：设计研判（前瞻），尚未实现。
> 作者：Yuandong + Claude，2026-05-26。
> 定位：决策从 Meta Tech Provider 反转回 Baileys 之后的新主线。这是一份**实现方案设计**，不是 bug 报告——`nanobot/bridge/` 里那份 Baileys 代码是 HKUDS 上游附带的，从未在 Ola 启用过，等于白纸。本文把"白纸 + 我们前次项目的踩坑经验 + Ola 多租户需求"合成一套落地设计。

---

## 关于本文的取证边界（先说清楚）

写这份文档时所在的是 Claude Code web session，**只 clone 了 CRM 仓库 `SeekMi-Technologies/Ola`**，sibling 的 `../nanobot`（Python AI backend + Baileys bridge）**不在这个环境里**。所以：

- 凡是引用 **CRM 侧** 代码的地方（`backend/src/mcp/*`、`olaController/chat.js`、model、config template），都带了**真实文件名 + 行号**，是这次实地核实过的。
- 凡是讲 **nanobot / bridge / Baileys 行为** 的地方，依据是 **HKUDS 上游知识 + 我们前次项目（OpenClaw 等）的踩坑经验**，标注为「未在本环境核实」。落地实现时，第一步就是把 `../nanobot/bridge/whatsapp.ts`、`channels/whatsapp.py` 拉下来逐行对一遍本文的假设。

凡是本文写「待核实」的，都是因为代码不在手边，不是含糊其辞。

---

## 0. 一段话总结

- **决策反转**：从 Meta WhatsApp Tech Provider（Cloud API / Embedded Signup）回到 Baileys。原因：Meta 在媒体、群、模板审批、Embedded Signup 商户审批上的实际可用能力，对一个早期外贸 CRM 来说门槛高、周期长，反而 < Baileys 的「扫码即用」。Tech Provider 路径的完整研判保留在 `whatsapp_multitenancy.md`（如果该文件在你本地存在）。
- **现状**：nanobot 自带一份 Baileys bridge 代码，`nanobot.config.template.json` 里 `whatsapp.enabled = false`，从未在 prod 跑过。多租户改造**不是改 bug，是基于这份 starting point 设计实现**。
- **多租户本质**：把「1 个 Node bridge 进程 = 1 个 Baileys socket = 1 个 authDir = 1 个 WhatsApp 账号」这条线，复制成「每个销售一条」，并在 nanobot → CRM MCP 的调用里注入 `X-Acting-As`，让每个销售只看到自己的客户/报价。
- **推荐路径**：**单进程多 WebSocket route**（`/wa/<admin_id>`），per-admin 独立 authDir + 确定性 acting_as 注入 + 4 个历史坑全部前置规避。
- **acting_as 是隐藏主线**：CRM 的 MCP server 要求 `X-Acting-As`，业务工具缺它就 401（`headerResolver.js:30-35`）。askola **网页**路径已经在 `chat.js:317` 注入了，但 WhatsApp 入站走 nanobot 自己的 channel loop，**不经过 `chat.js`**——所以 acting_as 必须由 WhatsApp channel 自己注入。路径 C 让这件事变成确定性的（route 里就带着 admin_id）。

---

## 1. 当前代码状态 —— 等于白纸

### 1.1 CRM 侧：WhatsApp 是关着的

`ola/nanobot.config.template.json` 的 channels 段里：

```json
"whatsapp": {
  "enabled": false,
  "bridgeUrl": "ws://localhost:3001",
  "bridgeToken": "",
  "allowFrom": [],
  "groupPolicy": "open"
}
```

事实清单：

| 字段 | 现状 | 多租户含义 |
|---|---|---|
| `enabled` | `false` | 从未在 prod 启用 |
| `bridgeUrl` | 单一 `ws://localhost:3001` | **单连接**，没有 per-admin 路由概念 |
| `bridgeToken` | 空 | 没有鉴权 |
| `allowFrom` | `[]` | 没有白名单 |
| `groupPolicy` | `open` | 群消息全收（对比其他 channel 多是 `mention`） |

对照同文件里 **已启用** 的 `email` channel（`enabled: true`，完整 IMAP/SMTP 配置）——email 是当前唯一跑通的「非网页」入站通道，它的 acting_as 解析方式是 WhatsApp 要照抄的参照（见 §1.4、§4.4）。

### 1.2 nanobot 侧：上游附带，未核实

> 以下为上游知识，未在本环境核实（`../nanobot` 不在 web session 里）。

- 三文件架构（HKUDS 上游惯例）：`bridge/whatsapp.ts`（Baileys socket 包装）+ `bridge/server.ts`（WebSocket server，对应 `ws://localhost:3001`）+ `channels/whatsapp.py`（nanobot 侧 channel，连 bridge 的 WS 客户端）。
- bridge 注释提到 "Based on OpenClaw"——所以它跟我们前次项目同源，那 4 个坑大概率在这份代码里也存在或半成品。
- 认证：`useMultiFileAuthState`，authDir 物理落在 `~/.nanobot/whatsapp-auth/`（单目录，单账号）。
- `syncFullHistory` 大概率已是 `false`（上游默认）。

**落地第一步**：把这三文件拉下来，逐行核对 §1.2、§2 的每一条假设，把「未核实」替换成行号。

### 1.3 既有结构能复用什么

即便是白纸，starting point 仍有用：

- Baileys 的 `useMultiFileAuthState` + socket 生命周期包装——直接复用，不要重写。
- bridge ↔ nanobot 的 WebSocket 双向流模式——保留，改成多路由即可。
- nanobot channel 的 inbound→agent→outbound 管线——保留，加 acting_as 注入。

不必为了多租户从零重写 Baileys 接入，只需要在「连接维度」上从 1 变 N，并补 acting_as + contacts 持久化 + robustness。

### 1.4 一个 dormant 缺口：WhatsApp 入站没有 acting_as

这是本文唯一一个**已经存在于代码里、只是没被触发过**的问题（区别于 §2 的历史坑）。

CRM 的 MCP server 鉴权链（实地核实）：

- `backend/src/mcp/headerResolver.js:22-44` — `decideActingAdmin(rawHeader, toolLabel)`：
  - 没有 `X-Acting-As` 且工具**不在白名单** → `401 UNAUTHORIZED`（`headerResolver.js:30-35`）。
  - 没有 `X-Acting-As` 但工具**在白名单** `SYSTEM_TOOLS`（`headerResolver.js:9-20`：`initialize` / `tools/list` / `ping` / `salesperson.lookup_by_email` / `notifications/*`）→ 回退到 systemAdmin。
  - 有 `X-Acting-As` → `resolveActingAdmin(id)` 解析成具体 Admin（`bootstrap.js:88+`）。
- `backend/src/mcp/bootstrap.js:56-70` — systemAdmin = 第一个 `enabled & !removed` 的 owner（fallback admin/user）。这是 acting_as 缺失时的兜底身份。

CRM 网页路径**已经**注入了 acting_as：

- `backend/src/controllers/appControllers/olaController/chat.js:316-317` —
  ```js
  // X-Acting-As scopes MCP business tools to logged-in admin (#185)
  'X-Ola-Acting-As': userId.toString(),
  ```
  网页 askola 把登录销售的 `_id` 透传给 nanobot，nanobot 再转成 `X-Acting-As` 发给 MCP。

**缺口**：WhatsApp 入站消息**不经过 `chat.js`**——它从 Baileys → bridge → `channels/whatsapp.py` → nanobot agent loop 进来。这条路径上目前没有任何环节注入 acting_as。后果（基于上述鉴权链推断）：

- WhatsApp 触发的 MCP **业务工具**（`customer.*` / `merch.*` / `quote.*`）→ 缺 `X-Acting-As` → **401**，agent 干不了正事。
- 或者，如果 nanobot 侧偷懒走了 systemAdmin 兜底 → **所有销售的 WhatsApp 客户都记到同一个 owner 名下**，多租户直接失效。

email channel 怎么解的（参照）：`salesperson.lookup_by_email` 被特意放进 `SYSTEM_TOOLS` 白名单（`headerResolver.js:15` + 注释 4-6 行），解决「先有鸡还是先有蛋」——email 用这个工具先把 sender 解析成 `admin._id`，再用它做后续业务调用的 acting_as。

WhatsApp 的解法更简单（见 §4.4）：路径 C 里 **route 本身就是 `admin_id`**，连查找工具都不需要——这条连接收到的每条消息，acting_as 恒等于路由的 admin_id。

---

## 2. 我们之前踩过的 4 个坑 —— 设计前置约束

> 这 4 个是我们在前次项目（OpenClaw 等 Baileys 接入）踩过的，不是本 repo 现有 bug。写在这里是**为了在新实现里前置规避**。每条结构：现象 → Baileys 真相 → 多租户设计要点。

### 2.1 联系人自定义名字看不见

- **现象**：销售在自己手机里给客户改了备注「老王 - 美的厨具」，但 bridge 推给 nanobot 的 inbound payload 里只有 phone/JID，agent 和 CRM 都拿不到这个备注名，客户列表里全是号码。
- **Baileys 真相**：
  - `pushName` 字段**每条消息都带**——但那是**对方自己设的** profile name，不是销售设的备注。
  - 销售手机端的备注名，要靠订阅 `contacts.upsert` / `contacts.update` 事件才能同步过来（linked device 协议会把主机的通讯录改动推给从设备）。
  - 启动时 Baileys 还会发一次 `contacts.set`（≈ 同步一份初始通讯录快照）。
- **多租户设计要点**：
  1. bridge **per-admin client 各自订阅** `contacts.upsert` + `contacts.update`（每个销售的连接只同步自己手机的通讯录）。
  2. inbound payload 加 `displayName` 字段，按优先级填：`contacts 备注名 > pushName > phone > LID`。
  3. per-admin 持久化 `jid → displayName` 映射（见 §4.1 的 `state.json`），重启不丢。

### 2.2 超长号码（LID 长数字串）

- **现象**：用户看到 sender 是 `98765432109876543210@lid.whatsapp.net` 这种 19-20 位长串，不是 `+86...` 电话，没法跟 CRM Client 对上。
- **Baileys 真相**：WhatsApp 2024 起多设备协议把部分场景的 phone 替换成 **LID（Linked ID）**，是个不透明长整数。某些场景（尤其新对话、群成员）拿不到 phone↔LID 映射，只有 LID。
- **多租户设计要点**：
  1. per-admin `state.json` 持久化 `lid → phone` 映射，进程启动时加载（**关键**：映射只能是内存 dict 的话，bridge 重启就全丢——这正是前次踩的坑）。
  2. bridge 启动订阅 `contacts.set`（Baileys 启动快照），尽量 bootstrap 一批 lid↔phone。
  3. 显示层 fallback 链：`displayName > phone > LID`。**LID 只做内部主键兜底，永远不直接展示给销售**。
  4. CRM Client 绑定字段（§5.2 `wa_jid`）存「稳定主键」——优先 phone（E.164），phone 拿不到才退 LID，并记 `wa_jid_kind` 标明类型，将来拿到 phone 再回填。

### 2.3 Baileys 历史信息导入 API 不可靠

- **现象**：接入后销售期望看到「之前 6 个月的 WA 对话」，但 `syncFullHistory` 即使开了，多设备协议下也只能拿最近 ~50 个会话 + 少量消息，而且这个 API 在 Baileys 半年内多次 breaking change。
- **Baileys 真相**：历史回看是 WhatsApp 多设备协议本身的限制，不是 Baileys 的 bug，开关也救不了。
- **多租户设计要点**：
  1. `syncFullHistory: false` 保留（少同步少出错）。
  2. **产品端明确文案**：「Ola 接管 WA 后只处理**新对话**，历史记录在你手机里」。Onboarding 扫码页就要写清楚，避免销售期待落空。
  3. 不写任何依赖历史回看的产品功能。如果业务真要历史，走 nanobot 的 message store **从启用那天起自己累积**，不依赖 Baileys 拉历史。

### 2.4 Bridge 连接不稳

- **现象**：长时间运行后偶尔「不收消息但也不报 disconnect」（zombie connection）；或短时间多次重连风暴；或固定 5s 重连撞上 ws server 重启。
- **Baileys 真相**：socket 的 `'close'` 事件**不可靠**——服务端可能静默 drop 连接而 client 不报 close。必须有**应用层 staleness 检测**，不能只依赖 close 事件触发重连。
- **多租户设计要点**：
  1. **heartbeat**：每 30s 检查「上次收到任何 traffic 的时间」，超过 90s 无 traffic 主动 reconnect（不等 close 事件）。
  2. **reconnect backoff**：`5s → 15s → 45s → 120s`（cap），不要固定 5s（固定 5s 会在 ws server 重启时打出重连风暴）。
  3. 状态机扩出 `reconnecting` / `stale_detected`，broadcast 给 nanobot 侧，再透传给前端展示（销售能看到「连接中…」而不是默默丢消息）。
  4. **per-admin 隔离**：一个销售的重连风暴**不能拖累别人**。这是路径选型（§3）的关键考量——单进程方案必须保证一个 client 的异常被 try/catch 在 client 边界内，不冒泡到事件循环。

---

## 3. 多租户改造的核心选项（三选一）

### 选项 A：每租户独立 Node bridge 进程

- N 个进程，每个 ~120-150MB，N 个端口，N 个 supervisor 单元。
- ✅ 隔离最彻底：一个挂不影响别的；authDir 进程级 + 文件级双隔离；坑 2.4 的传染风险 = 0。
- ❌ 资源最贵（8 销售 ≈ 1GB+ 常驻）；端口/supervisor 管理复杂；动态增删销售要动 supervisor 配置。

### 选项 B：单进程多 socket，payload 打 tenant_id tag

- 1 个进程内 N 个 Baileys socket，inbound/outbound payload 加 `tenant_id` 字段路由。
- ✅ 资源最低。
- ❌ 路由全靠 payload tag，容易串号（outbound 错发是灾难）；Baileys 在同进程内多 socket 的错误隔离能力**未经我们验证**；坑 2.4 一个 socket 抖动可能拖累全员。

### 选项 C ★ 推荐：单进程多 WebSocket route（`/wa/<admin_id>`）

- bridge 进程暴露 **路由级** 接口：`/wa/<admin_id>?token=<per_admin_token>`。
- 进程内每条路由一个 `WhatsAppClient` 实例 + 独立 authDir + 独立 state.json。
- nanobot 侧每个启用 WA 的销售一个 channel 实例，连自己的 route。
- ✅ 资源共享（单进程）+ **路由级隔离**（连接维度天然带 admin_id，outbound 不可能串号）；**acting_as 确定性**（route 即 admin_id，§4.4）；动态增删销售 = 加/删一条路由，不重启进程。
- ❌ 单进程 fate-share（进程崩了全员断）——靠 systemd auto-restart + 进程内 client 边界 try/catch 缓解；authDir 在磁盘，重启后各 client 自动恢复会话不用重扫码。

### 对比表

| 维度 | A 多进程 | B 单进程多 socket | C 单进程多 route ★ |
|---|---|---|---|
| 资源（8 销售） | ~1GB+ | 最低 | 低 |
| 隔离强度 | 最强 | 弱（靠 tag） | 强（靠 route） |
| 部署复杂度 | 高（N supervisor） | 低 | 低 |
| 坑 2.4 传染风险 | 0 | 高 | 低（client 边界隔离） |
| outbound 串号风险 | 0 | 中 | 0（route 物理隔离） |
| acting_as 注入 | 需查找 | 需查找 | **确定性（route=admin_id）** |
| 动态增删销售 | 改 supervisor | 改 config | 加/删一条路由 |
| 上线速度 | 慢 | 中 | 快 |

**推荐 C**：在「资源、隔离、acting_as 确定性、上线速度」上综合最优。单进程 fate-share 是它唯一的真实代价，但 systemd auto-restart + 磁盘 authDir（重启免重扫码）把代价压到可接受。规模真到几十个销售、单进程扛不住时，C 可以平滑演进成「每 N 个销售一个进程」的分片（A 和 C 的混合），代码改动小。

---

## 4. 推荐方案（路径 C）落地设计

### 4.1 文件结构（per-admin 隔离）

```
~/.nanobot/wa/<admin_id>/
├── auth/          ← Baileys useMultiFileAuthState 目录（每销售独立，扫码凭证）
├── media/         ← 下载的媒体文件（图片/语音/文档）
└── state.json     ← { lid→phone 映射, jid→displayName 映射, 元数据 }
```

`state.json` 解坑 2.1 + 2.2 的持久化载体：

```jsonc
{
  "admin_id": "665f...",
  "contacts": {
    "<jid>": {
      "displayName": "老王 - 美的厨具",   // 销售手机备注名（contacts.update 来）
      "pushName": "Wang",                  // 对方 profile（消息带的）
      "phone": "+8613800138000",           // E.164，可能为 null
      "lid": "98765432109876543210",       // LID 长串，可能为 null
      "source": "contacts",                // contacts | pushName | manual
      "updatedAt": 1716700000
    }
  },
  "lidToPhone": { "98765432109876543210": "+8613800138000" }
}
```

> 旧的 `~/.nanobot/whatsapp-auth/`（单账号）作废，迁移成 `~/.nanobot/wa/<admin_id>/auth/`。第一个销售上线时直接走新结构，不需要迁移老数据（反正 WA 从没启用过）。

### 4.2 bridge 接口（新）

| 方法 | 路径 | 作用 |
|---|---|---|
| `WS` | `/wa/<admin_id>?token=<per_admin_token>` | 双向流：auth 事件 + inbound 消息 + outbound 指令 |
| `GET` | `/wa/<admin_id>/status` | `connected` / `qr_pending` / `reconnecting` / `disconnected` / `logged_out` |
| `POST` | `/wa/<admin_id>/login` | 触发该销售的 QR 生成（返回 QR 给前端展示） |
| `DELETE` | `/wa/<admin_id>` | logout + 清 `auth/`（销售解绑/换号） |

- `per_admin_token`：每个销售一个，bridge 校验。不要用单一全局 token（那等于没隔离）。可以是 `HMAC(MCP_SERVICE_TOKEN, admin_id)` 派生，避免再存一张 token 表。
- bridge 进程内维护 `Map<admin_id, WhatsAppClient>`，路由命中时 lazy 创建/复用 client。

### 4.3 nanobot config —— 从静态 section 改 DB-driven

现状是静态单 `[whatsapp]` section（§1.1）。多租户两种改法：

- ❌ 改成 N 个 `[whatsapp.tenants.<admin_id>]` 静态 section：每加一个销售要改 config + 重启 nanobot，运维噩梦。
- ✅ **推荐**：保留一个 `[whatsapp]` 总开关，**销售列表 + 启用状态从 Mongo 拉**。nanobot 启动时查 `Admin.find({ wa_enabled: true })`（§5.1 新字段），为每个销售起一个 channel 实例连对应 route。销售启用/停用 WA → 改 DB → nanobot 定期 reconcile（或 CRM 调一个 nanobot 的 reload 接口）。

这样「加销售」是纯数据操作，零 config 改动、零重启。

### 4.4 acting_as 注入（解 §1.4 缺口）

路径 C 让这件事变确定性：

- `channels/whatsapp.py` 的 `WhatsAppChannel` 实例化时**绑定 `admin_id`**（就是它连的那条 route 的 admin_id）。
- 该 channel 收到 inbound、调 MCP 工具时，**无条件注入** `X-Acting-As: <admin_id>`。
- 对照 CRM 侧鉴权链（§1.4）：有了 `X-Acting-As`，业务工具走 `resolveActingAdmin`（`bootstrap.js:88+`）→ 正确 scope 到该销售。
- **不需要** email 那种 `salesperson.lookup_by_email` 查找工具——因为 WhatsApp 的销售身份是「哪条 route 收到的」，不是「sender 是谁」。sender（客户）只用来匹配/创建 Client，acting_as 恒等于 route 的 admin_id。

> 落地校验点（核对 nanobot 代码时确认）：`whatsapp.py` 的 inbound handler 调 `_handle_message` 时，确实把 `_acting_as=admin_id` 透传到了 MCP 调用的 header 链路上。email channel 是怎么传的，照抄那条链路。

### 4.5 contacts / pushName 持久化（解坑 2.1 + 2.2）

bridge 侧 per-admin client：

1. 订阅 `contacts.set`（启动快照）、`contacts.upsert`、`contacts.update`（增量）→ 更新 `state.json` 的 `contacts` + `lidToPhone`。
2. 每条 `messages.upsert` 取 `pushName`，按优先级回填 `displayName`（不覆盖已有的 contacts 备注名）。
3. inbound payload 加 `displayName`（已按 `contacts > pushName > phone > LID` 算好），nanobot/CRM 不用自己再算。
4. `state.json` 写盘节流（debounce，比如 5s），避免高频消息打爆磁盘 IO。

CRM 侧（§5.2）：Client 落 `wa_jid` + `wa_display_name`，列表/详情展示用 `wa_display_name`，匹配用 `wa_jid`。

### 4.6 connection robustness（解坑 2.4）

每个 `WhatsAppClient` 内置：

1. **heartbeat 定时器**：每 30s 检查 `lastTrafficAt`，`now - lastTrafficAt > 90s` → 主动 `reconnect()`（不等 close 事件）。
2. **backoff 状态**：`5s → 15s → 45s → 120s`（cap），成功连上后 reset。
3. **状态广播**：`connected` / `reconnecting` / `stale_detected` / `logged_out`，经 WS 推给 nanobot → CRM → 前端。
4. **错误边界**：单个 client 的所有事件 handler 包 try/catch，异常只 log + 标记该 client 状态，**绝不冒泡到进程事件循环**（保护其他销售的 client）。符合 CLAUDE.md「无 silent error」——catch 里要 log 具体 admin_id + 错误，不能 `catch(e){}`。

---

## 5. Ola CRM 侧 schema 改动（最小集合）

> 沿用 repo 既有的「可选字段 + 默认值 + 不需要 migration」模式（见 `Admin.js` 的 `language` / `transcribeProvider` 字段写法：旧文档读到 `undefined`/`null`，consumer 端 fallback）。

### 5.1 Admin model（`backend/src/models/coreModels/Admin.js`）

加 3 个字段：

```js
// WhatsApp 多租户接入（per-salesperson Baileys 连接）
wa_enabled: { type: Boolean, default: false },   // nanobot 据此决定是否为该销售起 channel
wa_bridge_status: {
  type: String,
  enum: ['connected', 'qr_pending', 'reconnecting', 'disconnected', 'logged_out'],
  default: 'disconnected',
},
wa_phone_number: { type: String, default: null },  // 绑定后的展示号码（E.164）
```

旧 Admin 文档读到 `wa_enabled=false`（default），nanobot 不为其起 channel——零 migration，行为不变。

### 5.2 Client model（`backend/src/models/appModels/Client.js`）

加 2-3 个字段，把 WA 联系人绑到 Ola Client：

```js
wa_jid: { type: String, default: null, index: true },   // 稳定主键：优先 E.164，退 LID
wa_jid_kind: { type: String, enum: ['phone', 'lid'], default: null },  // 标明 wa_jid 类型（坑 2.2）
wa_display_name: { type: String, default: null },        // 从 bridge 同步的备注名
```

注意 Client 已有 `assigned: { ref: 'Admin' }`（`Client.js:21`）——**这就是现成的销售归属字段**。WA 入站匹配/创建 Client 时，`assigned` = acting_as 的 admin_id，多租户的客户归属天然落到这里，不用新造归属概念。

### 5.3（推迟到 Phase 2）Organization / Membership

本期模型：**1 admin = 1 公司 / 1 个 WA 业务号**，各连各的。`whatsapp_multitenancy.md §3` 描述的「6 销售 + 2 主管共享一个组织视图」是 Phase 2，**不阻塞本期**——本期先把「每个销售独立连、独立隔离」跑通。

---

## 6. 上线路径

### P0（上线 blocker）

按依赖顺序：

1. **核对 nanobot bridge 代码**（把 §1.2 / §2 的「未核实」换成行号）——动手第一件事。
2. **bridge 多租户路由改造**（§4.2）：`/wa/<admin_id>` + per-admin client Map + token 校验。
3. **per-admin authDir + state.json**（§4.1）。
4. **acting_as 注入**（§4.4）：WhatsAppChannel 绑 admin_id，无条件注入 `X-Acting-As`。**这是多租户隔离的命门，没它一切归 systemAdmin。**
5. **contacts 持久化**（§4.5）→ 一并解坑 2.1 + 2.2。
6. **heartbeat + backoff**（§4.6）→ 解坑 2.4。
7. **CRM schema**（§5.1 + §5.2）。
8. **Onboarding UX**：QR 扫码页 + 状态展示（含坑 2.3 的「只接管新对话」文案）。

### P1（上线后迭代）

- acting_as 解析失败的 fallback 行为（销售没绑 WA / 解析不到 → agent 该回什么，而不是 401 裸奔）。
- 多设备 / 多端 logout 探测（销售在手机上「退出已链接设备」→ bridge 怎么感知并标 `logged_out`）。
- WA 媒体从本地 `media/` 下沉到对象存储。
- 坑 2.3 的产品文案打磨 + 自累积 message store（如果业务要历史）。

---

## 7. 待 Yuandong 决策的开放问题

| # | 优先级 | 问题 | 我的倾向 |
|---|---|---|---|
| Q1 | P0 | 路径选 A / B / C？ | **C**（理由见 §3 对比表，acting_as 确定性 + 路由隔离） |
| Q2 | P0 | bridge / nanobot / CRM 三处改动一个 PR 还是拆？ | **拆 2 个**：nanobot PR（含 bridge + whatsapp.py + acting_as + contacts + robustness）；CRM PR（schema + onboarding UI）。bridge 在 nanobot PR 内。 |
| Q3 | P0 | per_admin_token 怎么发？ | **HMAC(MCP_SERVICE_TOKEN, admin_id) 派生**，免存 token 表（§4.2） |
| Q4 | P1 | authDir 备份策略？ | ECS 本地 + 定期快照；丢了大不了重扫码（authDir 不是不可再生） |
| Q5 | P1 | 一个销售同时多设备登录？ | Baileys 是 linked device，主机退链即废——P1 探测 + 提示重扫，本期不处理 |
| Q6 | P2 | 群消息政策？ | 现 `groupPolicy: open` 收全部；建议改 `mention`（对齐其他 channel），P2 再定 |

---

## 附：本文引用的 CRM 侧真实代码锚点

| 文件 | 行 | 内容 |
|---|---|---|
| `ola/nanobot.config.template.json` | whatsapp 段 | `enabled:false` / `bridgeUrl:ws://localhost:3001` 单连接 |
| `backend/src/mcp/headerResolver.js` | 9-20 | `SYSTEM_TOOLS` 白名单 |
| `backend/src/mcp/headerResolver.js` | 22-44 | `decideActingAdmin`：缺 acting_as 且非白名单 → 401 |
| `backend/src/mcp/bootstrap.js` | 56-70 | systemAdmin 解析（acting_as 缺失兜底） |
| `backend/src/mcp/bootstrap.js` | 88+ | `resolveActingAdmin` |
| `backend/src/controllers/appControllers/olaController/chat.js` | 316-317 | 网页 askola 注入 `X-Ola-Acting-As`（WhatsApp 路径没有） |
| `backend/src/mcp/README.md` | 38-42 | MCP 安全模型（Bearer + 网络隔离两道防线） |
| `backend/src/models/coreModels/Admin.js` | 39-55 | 可选字段模式（`language` / `transcribeProvider`） |
| `backend/src/models/appModels/Client.js` | 21 | `assigned: ref Admin`（现成的销售归属字段） |
