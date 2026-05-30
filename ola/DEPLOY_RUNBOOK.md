# Ola CRM 部署 Runbook — 2026-04-19 (app.olajob.cn)

**目标**：`https://app.olajob.cn` 上线可用 —— 可登录、Ask Ola 可用、Quote/PDF 可下载。

---

## 拓扑总览

```
                                               https://app.olajob.cn
                                                       │
                     Aliyun DNS A record app → 47.77.239.237
                                                       │
                        ┌──────────────────────────────▼───┐
                        │ Box1 = app                        │
                        │ Aliyun HK 47.77.239.237           │
                        │ caddy :443 (LE) → frontend :3000  │
                        │                  ↳ /api → backend :8888 (via nginx-in-frontend)
                        └──────┬────────────────────────────┘
                   Tailscale mesh (100.x)
                  ┌────────────┼─────────────┐
                  ▼                          ▼
          ┌───────────────┐          ┌──────────────┐
          │ Box2 = ai     │          │ Box3 = pdf   │
          │ nanobot :PORT │          │ gotenberg    │
          │ + WA bridge   │          │ :3000        │
          └───────────────┘          └──────────────┘
```

Mongo 在 Atlas（不占本地资源）。三台都是 Aliyun HK 2C/2GB。

---

## 分工

| 阶段 | Duke | Claude |
|---|---|---|
| Phase 0 代码准备 | 等 | 改 compose/Dockerfile/deploy.sh、开 PR |
| Phase 1 dev→main | GitHub web 发 PR + merge | 等 |
| Phase 2 Tailscale | 3 台 SSH 装 tailscale + up | 校验 ping 通 |
| Phase 3 Box3 gotenberg | SSH Box3 docker run | 校验 curl |
| Phase 4 Box2 nanobot | SSH Box2 clone + 起服务 | 校验 health |
| Phase 5 Box1 部署 | 给 IP + SSH key + Atlas string + OpenAI key | SSH Box1 编辑 backend/.env（值取自 .secrets/SERVERS.env）+ docker compose up -d --build |
| Phase 6 公网入口 | Aliyun DNS 加 A 记录 + 确认 443/80 开放 | SSH Box1 装 caddy + LE |
| Phase 7 冒烟 | 浏览器操作走 D1 | 看三台 logs 兜底 |

预计总时间：**~3 小时**

---

## Phase 0 — 代码准备（Claude，~30 min）

### 改动清单

1. **`docker-compose.yml`** — 只保留 backend + frontend（gotenberg 搬去 Box3 独立 docker run）
   - 移除 `gotenberg` service 块
   - backend 的 `depends_on: gotenberg` 删
   - `GOTENBERG_URL` 改成从 env_file 读取（不再 hardcode `http://gotenberg:3000`）
   - `ALLOWED_ORIGINS` 改 `https://app.olajob.cn`
   - `VITE_BACKEND_SERVER` / `VITE_APP_API_URL` 改 `app.olajob.cn`

2. **`frontend/Dockerfile.prod`** — nginx 加 `/api` `/download` `/export` `/public` proxy 到 backend 容器
   - 否则 CF Tunnel 只能指一个上游，单域名 /api 请求会 404
   - ARG 默认值 `erp.olajob.cn` → `app.olajob.cn`

3. **`deploy.sh`** — 顶部注释 erp→app，末尾 URL 提示 erp→app

4. **批量替换** `erp.olajob.cn` → `app.olajob.cn`：
   - `DEPLOY.md`（legacy 保留）
   - `README.md`
   - `CLAUDE.md`
   - `backend/.env.box1.example`
   - `backend/.env.example`
   - `.agents/workflows/start.md`
   - `.agents/workflows/onboard.md`
   - `.agents/context/understanding.md`

5. **本地验证**：`cd frontend && npx vite build`，backend 跑一次 `npm run dev` smoke test

6. **PR**：ZYD_FEAT → dev，标题 `chore(deploy): app.olajob.cn 三箱拓扑 + nginx /api proxy`，CI 通过后 gh merge

---

## Phase 1 — dev → main（Duke，~5 min）

Duke 操作：

- [ ] 在 GitHub 打开 https://github.com/SeekMi-Technologies/Ola/compare/main...dev
- [ ] 标题：`release: app.olajob.cn MVP deployment`
- [ ] body 可以直接列 `dev` 领先 main 的关键 commits（MCP + NanoBot 接入 + Lead-to-Quote 闭环 + Logo 上传 + P0 修复 + 三箱部署改造）
- [ ] review diff，确认无空壳/hardcode 漏网
- [ ] Merge (squash or merge commit 随意)

告诉 Claude 合并完成。

---

## Phase 2 — Tailscale mesh（Duke，~20 min）

Duke 操作：

1. 登录 https://login.tailscale.com，Admin → Keys → Generate auth key
   - **Reusable** = true
   - **Ephemeral** = false
   - **Tags** = 空（或者 `tag:ola-prod`）
   - 有效期 72h 足够
2. SSH 到每台 box，执行：

```bash
# Box1
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=tskey-auth-xxxx --hostname=box1-app --ssh

# Box2
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=tskey-auth-xxxx --hostname=box2-ai --ssh

# Box3
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=tskey-auth-xxxx --hostname=box3-pdf --ssh
```

3. 在 Tailscale admin 页面确认 3 台机器都出现，状态 Connected

**校验**：从 Box1 `tailscale ping box2-ai` 和 `tailscale ping box3-pdf` 都要通。

---

## Phase 3 — Box3 Gotenberg（Duke 15 min）

Duke SSH 到 Box3：

```bash
# 如果 docker 没装
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 启动 gotenberg
docker run -d \
  --name gotenberg \
  --restart unless-stopped \
  -p 3000:3000 \
  gotenberg/gotenberg:8
```

Claude 校验（从 Box1）：
```bash
curl -sI http://box3-pdf:3000/version  # 预期 200
```

---

## Phase 4 — Box2 NanoBot（Duke，~45 min）

Duke SSH 到 Box2：

1. 装 python 3.11+、git、pip3、build-essentials
2. 按 `ola/SETUP.md` 第二段走：
   - `git clone https://github.com/SeekMi-Technologies/Ola_bot ~/nanobot`
   - **生产部署必须 checkout `ola-main` 分支** (repo default)：
     `cd ~/nanobot && git checkout ola-main && git pull origin ola-main`
   - 进 `~/nanobot`，`pip install -r requirements.txt` (or `uv sync`)
   - 创建 `~/.nanobot/` workspace，按 SETUP.md 配 config
3. 启动方式（选一）：
   - **简单版**：`screen -S nanobot; python -m nanobot serve --host 0.0.0.0 --port 8900`
   - **推荐**：写个 systemd unit（参考 ola/SETUP.md）

Duke 告诉 Claude：
- nanobot 监听端口（默认 8900）
- 已在 Box2 `.env` 或 `~/.nanobot/config` 配好 `GEMINI_API_KEY`

Claude 校验（从 Box1）：
```bash
curl http://box2-ai:8900/health  # 具体 endpoint 看 nanobot 文档
```

---

## Phase 5 — Box1 部署（Duke + Claude，~30 min）

**前置**：Phase 3 + Phase 4 已完成。

### Duke 提供

- Box1 公网 IP（供 deploy.sh 用）或 Tailscale IP
- SSH key 路径（或 root 密码，Claude 用 ssh 连接）
- Atlas connection string（mongodb+srv://...）
- 要用的 JWT_SECRET（random 64-char，可用 `openssl rand -hex 32` 生成）
- GEMINI_API_KEY（NanoBot 用；由 backend/.env 渲染到 `~/.nanobot/config.json`）
- MCP_SERVICE_TOKEN（CRM ↔ NanoBot loopback service token，`openssl rand -hex 32`）

### Claude 操作

1. **切到 main 分支** — `git checkout main && git pull origin main`，确保部署的代码是 main HEAD
2. **SSH Box1 直接编辑 `backend/.env`**（不再用 `.env.production` — 那是已废弃的 drift trap，见 PR #174）：

```bash
ssh box1
cd /app/crm
nano backend/.env  # 值从本地 .secrets/SERVERS.env 拷贝过来
```

`backend/.env` 需要的字段（参照 `backend/.env.box1.example`）：
```env
DATABASE=<Atlas URI>
JWT_SECRET=<64-char random>
PORT=8888
ALLOWED_ORIGINS=https://app.olatech.ai
PUBLIC_SERVER_FILE=https://app.olatech.ai/
GOTENBERG_URL=http://box3-pdf:3000
NANOBOT_HOST=<Box2 Tailscale IP>
NANOBOT_PORT=8900
GEMINI_API_KEY=<key>
MCP_SERVICE_TOKEN=<32-hex, 必须与 .secrets/SERVERS.env + Box2 ~/.nanobot/config.json 一致>
```

3. **指纹核对**：`sha256sum backend/.env | cut -c1-8` 必须与本地 `.secrets/SERVERS.env` 的 MCP_SERVICE_TOKEN fingerprint 一致（见 ola/SETUP.md §Secrets management）
4. `git pull && docker compose up -d --build`
5. 预期：frontend:3000 + backend:8888/health 都 200

如果 health check 失败，抓 `docker compose logs --tail=50` 排查。

---

## Phase 6 — 公网入口：Cloudflare Proxy（Duke + Claude，~10 min）

**方案决策**：olajob.cn 已迁到 Cloudflare（NS = elaine/gerald.ns.cloudflare.com，已全球传播）。用 CF 直接代理 Box1:80，不在 Box1 跑 caddy / LE。CF 终结 HTTPS，origin 走 HTTP。

### Duke 操作

1. CF Dashboard → `olajob.cn` → DNS：
   - A 记录 `app` → `47.77.239.237`，代理状态 = **橙云 (Proxied)**
2. CF Dashboard → `olajob.cn` → SSL/TLS → Overview → Encryption mode = **Flexible**
   - Box1 没跑 TLS，必须 Flexible（CF→origin 明文），Full/Full strict 会 526
3. Aliyun ECS Box1 安全组入方向放开 TCP 80 源 `0.0.0.0/0`（CF 访问用）
4. 告诉 Claude 配置完成

### 校验（Claude）

```bash
curl -sI https://app.olajob.cn                    # 200
curl -sI https://app.olajob.cn/api/setting/listAll # 401（说明 /api proxy 生效）
```

### 旧的 Caddy + LE 方案（不再使用）

如需紧急切回直连：1) CF app 记录切灰云 2) Box1 装 caddy 3) Caddyfile 写 `app.olajob.cn { reverse_proxy localhost:80 }` 4) systemctl start caddy。

### 未来升级：CF Tunnel

届时：registrar 改 NS → CF → 建 Tunnel → 关 Caddy → DNS 切到 CF。老 Caddy 配置保留作为 fallback 文档。

---

## Phase 7 — 冒烟测试（Duke，~15 min）

Duke 浏览器打开 https://app.olajob.cn：

- [ ] 登录页加载
- [ ] 注册一个测试账号 → Onboarding 走完 → 进 Dashboard（验证 #83 已修）
- [ ] 去 Settings → Company 上传 logo → 保存
- [ ] 去 Merchandise → 加 1-2 个 SKU（如果没有）
- [ ] 去 Ask Ola → 模拟客户询价 → Agent 响应 + 推荐 Merch + draft Quote
- [ ] 去 Quote → 下载 PDF → 打开看 logo + 公司网站超链接（验证 logo 修复 + #82）
- [ ] 负面：Ask Ola 问一个完全不存在的产品 → Agent 明确说「未找到」

任一失败 → 告诉 Claude 从对应 box 抓日志定位。

---

## Phase 8（可选，冒烟后）— 观察期基线记录

Claude 在 Box1/Box2/Box3 各自跑：

```bash
ssh <box> "free -m; uptime; docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'"
```

记录到 `ola/DEPLOY_BASELINE_20260419.md`，作为 T+2 周观察期的对照基线。

---

## 应急回滚

| 故障 | 排查 | 回滚 |
|---|---|---|
| `https://app.olajob.cn` 404 | Box1 caddy logs `journalctl -u caddy` + DNS 是否传播（`dig app.olajob.cn`） | 重启 caddy：`systemctl restart caddy` |
| 登录 500 | Box1 backend logs | DB 连接？JWT_SECRET？`docker compose logs backend` |
| PDF 下载失败 | Box3 gotenberg 状态 + Tailscale 连通性 | `tailscale ping box3-pdf`，重启 gotenberg 容器 |
| Ask Ola 挂 | Box2 nanobot logs + NANOBOT_HOST env | 重启 nanobot，检查 GEMINI_API_KEY |
| GFW 阻 CF IP | 短期无解（罕见） | 临时用 Box1 公网 IP 加 caddy + LE（见 ola/DEPLOYMENT_FALLBACK.md，待写） |

---

## Duke 现在要做的第一件事

**给 Claude 提供**：
1. 3 台 ECS 的公网 IP（Box1/Box2/Box3，随便哪台当哪个角色都行，选内存最空的当 Box3）
2. SSH 登录方式（key 文件路径，或者 root 密码）
3. Cloudflare 登录方式（Claude 无法登 CF dashboard，Phase 6 得 Duke 操作；但需确认 olajob.cn 在哪个 CF account）
4. Atlas MongoDB connection string（Phase 5 backend .env 要）
5. OpenAI API key（NanoBot 要）

Claude 先动 Phase 0（代码），Duke 这边边凑边给就行。
