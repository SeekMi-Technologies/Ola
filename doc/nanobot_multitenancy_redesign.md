# nanobot 多租户隔离 — 设计与执行（#352 epic）

> 重建于 2026-06-16 · ZYD_FEAT
> 原权威文档在飞书 session 的分支 reset 中丢失，本文按 2026-06-08 四路审计结论 + 当前代码核实重写。
> 配套现状分析见 [`multitenancy_current_state.md`](multitenancy_current_state.md)。

## 0. 目标一句话

**一个 Admin 账号 = 一个公司**（schema 级假设，不变）。让 nanobot 的 **prompt / 工作区文件 / 文件读状态** 都按 acting admin 严格隔离，并在新用户首次进入时自动 provision、对存量用户一次性 backfill。请求驱动的隔离链路（已稳）不动。

## 1. 已经稳的，别碰

请求 → acting-as ContextVar → per-admin 路径 + per-`(server, acting_as)` MCP 连接 + CRM fail-closed 401 + WhatsApp HMAC。这条链路是稳的。
**红线：MCP header 在 connect 时烧入，禁止改回 send-time 读 ContextVar**（2026-05-06 串号根因）。

坏的全在请求链路**之外**：provisioning、Dream 自进化、后台任务（cron/heartbeat）、subagent、per-admin 人设。生产现在靠 **serve-only + 禁 cron** 才安全（stopgap）。

## 2. epic 拆解 — 一个 PR 干一件事

四个有序 stage，每个独立可测、独立成 PR（nanobot `ZYD_FEAT` → PR → `ola-dev`）。顺序内 #356 依赖 #354。

| Stage | Issue | 一句话 | 性质 | PR |
|---|---|---|---|---|
| 01 | #353 | per-admin prompt 读取 + 全局回退 | 纯读、零写 | PR-1 |
| 02 | #354 | lazy provisioning + USER.md 播种 | 写路径、幂等 | PR-2 |
| 03 | #355 | file_state 按 admin 隔离 | 内存状态键改造 | PR-3 |
| 04 | #356 | 存量用户 backfill 脚本 | 一次性幂等迁移 | PR-4（依赖 PR-2） |

执行节奏：完成一个 stage → `/ship` 出 PR → 合并到 `ola-dev` → rebase ZYD_FEAT → 下一个 stage。PR 之间不串味。

**地基之后的后续 epic**（详见 §8，依赖 #353 + #354）：人设控制面 —— 让我们在 devboard 看/改每个用户的人设，告别手改 box。

| Stage | 一句话 | 仓库 | 依赖 |
|---|---|---|---|
| P-A | nanobot 人设控制面 API（`/internal/persona/*`） | nanobot | #353 + #354 |
| P-B | devboard 人设管理页 + BFF | ola_devboard | P-A |

## 3. 锁定的设计决策

**D1 · prompt 文件 per-admin override + 全局回退（读时解析，不拷贝）**
- `AGENTS.md`：**永远全局**。它是安全层（authority from system），绝不接受 per-admin 覆盖，否则等于给注入提权开口。
- `SOUL.md` / `TOOLS.md`：`admins/<id>/<file>` 存在就用它，否则用 workspace 根的全局文件。**读时解析、不拷贝** —— 改全局文件立即触达所有未覆盖的 admin（拷贝会漂移）。
- `USER.md`：已经 per-admin（`memory.user_file`），不动。
- **不 seed、不自动写 AGENTS/TOOLS 的 per-admin 副本**。只有 USER.md 在 provisioning 时播种；per-号 SOUL 按需手动放。

**D2 · provisioning 走 lazy（#354）**
- 首次 `set_acting_as` 解析到一个新 admin 时调 `provision_admin()`，幂等（`.provisioned` 标记），永不覆盖已存在文件。
- CRM 侧创建钩子是**可选优化**，不是依赖 —— 不引入跨服务耦合。
- `_system` / None 不 provision。path-traversal id 拒绝。

**人设路由 = 按入口（号 / 认证身份）选，绝不靠 agent 读消息内容自判。** 违反就是注入提权。

**D3 · Dream 与 cron 在我们这里是关闭的**
- 生产 serve-only，cron/heartbeat 继续禁。本 epic **不接线 Dream（WS-B）、不租户化 cron（WS-C）**。它们留在 §6 延后区，落地前保持禁用。

## 4. Stage 01（#353）详细设计

### 设计思路

读路径上每个 bootstrap 文件其实有一个固有属性：**它的租户作用域**（全局 / 可被 per-admin 覆盖）。现状把三个文件塞进一个扁平 list `["AGENTS.md","SOUL.md","TOOLS.md"]`，作用域是隐式的“全在根目录”。改造的本质不是“加一个 if”，而是**把作用域显式化成单一真相**，让读取逻辑由它驱动，而不是散落的魔法字符串。

所以不引入第二个 list（那会让 `"SOUL.md"` 这种字符串重复、两处易漂移）。改成 **文件 → 作用域 的声明式映射 + 一个枚举**，作用域只声明一次。

resolver 基于 `self.workspace`（当前进程的工作区根），因此对 serve 的 `api-workspace` 和 gateway 的 `workspace` **自动都生效**，无需区分进程。

### 安全约束（影响实现）

`MemoryStore.soul_file` **不只读、还写**（`read_soul` / `write_soul` 都用它，`write_soul` 会落盘）。#353 是纯读、零写，所以**不动 `soul_file`**。新增一个**只读** resolver 给 prompt 路径专用，写语义留给后续 stage 评估。

### 代码改动（3 文件，atomic）

**a) `nanobot/agent/context.py`** —— 作用域声明 + 读循环

```python
from enum import Enum

class BootstrapScope(Enum):
    GLOBAL = "global"            # 永远 workspace 根；安全层，不可 per-admin 覆盖
    OVERRIDABLE = "overridable"  # admins/<id>/<file> 优先，否则 workspace 根

# 单一真相：bootstrap 文件 -> 租户作用域。
BOOTSTRAP_FILES: dict[str, "BootstrapScope"] = {
    "AGENTS.md": BootstrapScope.GLOBAL,
    "SOUL.md": BootstrapScope.OVERRIDABLE,
    "TOOLS.md": BootstrapScope.OVERRIDABLE,
}
```

`_load_bootstrap_files` 由映射驱动（顺序、`## {filename}` 段格式、USER.md 段全部不变）：

```python
for filename, scope in self.BOOTSTRAP_FILES.items():
    path = (self.memory.resolve_overridable_file(filename)
            if scope is BootstrapScope.OVERRIDABLE
            else self.workspace / filename)
    if path.exists():
        parts.append(f"## {filename}\n\n{path.read_text(encoding='utf-8')}")
```

> `BOOTSTRAP_FILES` 由 list 变 dict，但 dict 迭代产出 key（文件名），`test_context_prompt_cache` 里 `for filename in ContextBuilder.BOOTSTRAP_FILES` 行为不变 —— 不需改那个测试。

**b) `nanobot/agent/memory.py`** —— 新增只读 resolver

```python
def resolve_overridable_file(self, filename: str) -> Path:
    """读时解析：admins/<acting-id>/<filename> 存在则用它，否则用全局
    workspace 根文件。不拷贝、不写。"""
    per_admin = self.workspace / "admins" / get_admin_dir_name() / filename
    return per_admin if per_admin.exists() else self.workspace / filename
```

`soul_file` / `read_soul` / `write_soul` / GitStore tracking 完全不动。

**c) `nanobot/tests/agent/test_context_per_admin.py`** —— 加 4 个 case 对齐验收。

### 验收（Phase 6：`pytest tests/agent`）

- `admins/<A>/SOUL.md` → A 用它；B 仍拿全局 SOUL
- per-admin `TOOLS.md` 同理；改全局 `TOOLS.md` 立即触达未覆盖 admin（证明不拷贝）
- `admins/<A>/AGENTS.md` 被忽略（负例：AGENTS 永远全局）
- 无任何 per-admin 文件 → prompt 与今天逐字一致（零行为变化）
- 现有 `tests/agent` 全绿（`test_soul_stays_global` / `test_global_workspace_files_still_loaded` / `test_context_prompt_cache` 不受影响）

## 5. 运维 — per-admin 文件在哪、怎么手改

nanobot 现在**跑在 docker**（CI/CD，GitHub Actions）。镜像 `ghcr.io/seekmi-technologies/ola-nanobot:<tag>`，Box2 上三个容器：`nanobot-api`(serve 8900) / `nanobot-gateway`(8901) / `nanobot-bridge`(3001)。

- 状态目录：宿主机 `${NANOBOT_STATE_DIR}`（prod = `/opt/ola-production/nanobot-state`）**bind-mount** 到容器 `/home/nanobot/.nanobot`，容器 uid 1000。
- **两个独立 workspace**（serve 和 gateway 不共用）：
  - askola/serve → `${NANOBOT_STATE_DIR}/api-workspace/`
  - channels/gateway（email、WhatsApp）→ `${NANOBOT_STATE_DIR}/workspace/`
- 每个 workspace 内的布局：
  ```
  api-workspace/  (和 workspace/ 同构)
  ├── AGENTS.md  SOUL.md  TOOLS.md        # 全局；deploy 时被 repo 模板覆盖
  └── admins/<adminId>/
      ├── USER.md                         # #354 lazy provisioning 播种
      ├── SOUL.md / TOOLS.md              # 可选：手动放 = 覆盖全局（读时生效）
      └── memory/{MEMORY.md, history.jsonl}
  ```

**手改某用户人设：** 因为是 bind-mount，改宿主机目录 = 容器立即可见（同 inode）。直接编辑
`${NANOBOT_STATE_DIR}/api-workspace/admins/<adminId>/SOUL.md`（channels 用户走 `/workspace/...`），
**不用进容器、不用重启**（prompt 读时解析，下一条消息即生效）。改完 `chown 1000:1000`。

**⚠️ 两个坑：**
1. 全局根 `SOUL/AGENTS/TOOLS.md` 由 `deploy/provision-nanobot-workspaces.sh` **每次部署覆盖**（源 = repo `ola/nanobot-workspace/`）。改全局人设**必须改 repo 模板并 commit**，绝不在 box 上手改根文件。`admins/<id>/` 下的 per-admin 覆盖文件 provisioner **不碰**，手改安全。
2. serve 和 gateway 是**两个 workspace** —— 同一个 admin 在 askola 和在 WhatsApp/email 用的是**不同目录**的文件。手改人设要清楚目标渠道改对应那个。

### 为什么有两个 workspace —— 根因与长期修法

**根因：nanobot 是两个独立进程，不是一个。**

- `nanobot serve`(8900) = askola 网页用，只暴露 `/v1/chat/completions`。
- `nanobot gateway`(8901) = 渠道用（email / WhatsApp），只跑 ChannelManager。
- 两个模式在单进程里**互斥**，所以 Ola 必须**同时起两个进程**并排跑。

问题在于：**每个进程都往 workspace 写运行时状态** —— `sessions/`、`memory/MEMORY.md`、`history.jsonl`、`.cursor` / `.dream_cursor`、gitstore。而 nanobot 的 memory/session/git 层**没有为"两个进程同时写同一批文件"设计**（记录在案的并发 bug：cursor 写无锁、session `get_or_create` 无锁，见 §6 WS-C）。两个进程指向同一 workspace = cursor 损坏 / git 冲突 / session 写丢。

所以 dockerize 时（commit `d99331ad`，2026-04-06）给 api 进程单独切了 `api-workspace`，commit message 原话：*"isolated workspace to avoid session/memory conflicts with nanobot-gateway"*。

**判断：这个切分把"会变的运行时状态"隔开是对的；但它是钝刀，把整个 workspace 都切了，顺带把 `SOUL/TOOLS/USER` 这些只读 config 也切成两份 —— 人设根本不需要按进程隔离，是被误伤。** 这就是"同一 admin 两份人设、会人格分裂"的来源。

**长期修法（单独拍，现在不做）：** 把 workspace 拆成 **共享只读 config（persona / skills，一份）** + **per-进程可变状态（sessions / memory，各一份）**。那样人设天然只有一份，session/memory 仍隔离。人设控制面 API（§8）的设计要朝这个方向兼容：**现在"两份一起写"，将来 config 合一后改成"写一份"，上层 API 与 UI 不变。**

### deploy provisioner vs #354 lazy provisioning（互补，不冲突）

| | 作用域 | 时机 | 管什么 |
|---|---|---|---|
| `provision-nanobot-workspaces.sh`（已有） | 全局根文件 | 每次 deploy | 同步 SOUL/AGENTS/TOOLS + 首次播 USER/HEARTBEAT，**两个 workspace** |
| #354 `provision_admin()`（要做） | `admins/<id>/` | 首次 `set_acting_as` | 建 per-admin 目录 + 播 USER.md + memory 骨架 |

deploy provisioner 不碰 per-admin 目录，所以两者正交。

## 6. 延后（本 epic 不做，保持现状）

按 WS 排期，落地前 cron/heartbeat 维持禁用：

- **WS-B Dream 自进化接线** —— 零 `.dream_cursor` = 从没为真实租户跑过。需承载流量进程注册 Dream cron + 遍历 admins 逐租户跑 + per-admin git 追踪 MEMORY.md。含 bug：cursor 写无锁（`memory.py`）。
- **WS-C 后台任务租户化** —— cron 单全局 `jobs.json` 无 admin_id、fire 时落 `_system`；heartbeat 跨租户投递泄露。含并发 bug：session `get_or_create` 无锁、锁键按 session_key 非 `(admin,session)`、`api/server.py` lock dict 内存泄漏。
- **WS-F 客服 KB（`kb.search` RAG）** —— 文档 ingest + Atlas Vector Search + CRM MCP 工具。客服 v1 用 embedded FAQ + 转人工兜底即可。

## 7. 现状对照（#355 / #356 落点）

- **#355** `nanobot/agent/tools/file_state.py`：模块级 `_state: dict[str, ReadState] = {}` 只按解析后路径字符串做 key → read-before-edit gate 和 read dedup **跨租户共享污染**。改为按 `(acting admin, resolved path)` 做 key，并给 `filesystem.py` 提供 accessor 替换裸 `_state` 访问。
- **#356** 一次性幂等脚本 `scripts/backfill_admin_provisioning.py`：遍历 `workspace/admins/*`（跳 `_system`）对每个跑 `provision_admin`。依赖 #354。

## 8. 后续 epic — 人设控制面（P-A / P-B）

> 地基（#353–356）之后做。目标：在 devboard 看/改每个用户的人设，**彻底取消手改 box**。

### 8.1 为什么不能手改 box / 不能让别人伸手进 FS

手改 bind-mount 目录（或 `docker exec` 进去改）的根本问题：**有人从 nanobot 之外直接动了 nanobot 拥有的文件系统**。这既违反 CI/CD（手改 = 不可复现的漂移），又是 #266 踩过的跨服务 FS 耦合反模式（见 [[feedback_no_absolute_paths_in_shared_db]]）。devboard / CRM 直接读写 Box2 FS = 捅穿封装。

**关键区分：人设是运行时 state，不是 code。** 像 DB 行一样，运行时通过 API 改 state 是合法的；违反 CI/CD 的是手改文件，API 恰恰**消除**手改。

### 8.2 不破坏封装的唯一正确形态：nanobot 自暴露控制面，别人调 API

**原则：nanobot 是它 workspace 的唯一所有者。** 别人只能请求它改自己的文件。

```
devboard 前端 (人设管理页)
  → devboard 后端 (BFF，持 service token)
    → nanobot 内部控制面 API (Tailscale, /internal/persona/*)
      → nanobot 读写它自己的 workspace FS（两个 workspace 一起写，见 §5 长期修法）
```

放 devboard 而非 CRM：CRM 面向客户，"改任意用户人设"是内部超能力 → 属内部 ops 控制台（devboard，已在做 #380 LLM Tracing）。CRM 保持干净。BFF 必须存在：控制面在 Tailscale 内网 + service token，浏览器既到不了也不能裸持 token。

### 8.3 API 形态（复用 #353 resolver）

- `GET /internal/persona/:adminId` → 每个文件的**生效内容 + 来源**（global 默认 / per-admin 覆盖）。来源判定正是 #353 `resolve_overridable_file` 的产物。
- `PUT /internal/persona/:adminId/{SOUL.md|TOOLS.md|USER.md}` → 写 per-admin 覆盖文件，**两个 workspace 同时写**。
- `AGENTS.md` 只读（安全层，永不 per-admin）。service-token 鉴权，Tailscale-only，不公网。
- 协同：**#353 造解析原语 → P-A 把它暴露 → P-B 给 UI**。所以排在 #353/#354 之后。

### 8.4 硬约束（来自 §5）

| 改谁 | 怎么改 | deploy 后 |
|---|---|---|
| 全局默认 | `ola/nanobot-workspace/*.md`（repo）→ PR → CI/CD | 部署即生效 |
| 单用户覆盖 | `admins/<id>/*.md`（运行时）→ 人设 API | 存活（provisioner 不碰） |

→ **API 只能写 `admins/<id>/` 覆盖文件，绝不写全局根**（写了下次 deploy 被 `install` 无条件抹掉）。全局默认永远走 repo 模板。

### 8.5 长期方向（为什么现在按"资源"而非"文件"设计）

现在草台班子，人设硬写在 prompt 文件里，所以**内部 ops 工具先行**。等接入 **mem0 + Agent SDK** 后，人设从"文件"变成"结构化数据/记忆"：
- 后端 backing store 换掉（FS → mem0/DB），但 API 与 devboard UI **不变** —— 因为定义成"人设资源"抽象，不是"文件操作"。
- 那时把同样能力**下放给终端用户**（self-serve 人设）= 把 devboard 页面换皮搬进 CRM。

所以 P-A 的接口现在就按"资源"语义设计，为后面铺路，不返工。
