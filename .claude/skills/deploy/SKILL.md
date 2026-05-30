---
name: deploy
description: SSH-based production deploy for Ola CRM — Box1 (app: backend/MCP/frontend via docker compose) + Box2 (ai: nanobot serve+gateway via systemd/screen). Reads .secrets/SERVERS.env for SSH + fingerprint targets, walks operator phase-by-phase with confirm gates, then runs 4-assertion smoke + a functional askola login test. Use when shipping a merged dev/main change to https://app.olatech.ai (or app.olajob.cn during transition). Never deploys without explicit OK at each destructive step. Yuandong-only.
---

# Deploy — Ola CRM 生产部署 runbook（skill 化）

> **用户什么语言, 你就用什么语言.** Code identifiers stay English.
>
> **Deploy 协议是硬的：** 每个 destructive action（`docker compose up -d --build`、kill nanobot、`git pull origin main`）之前都要显式问 zyd「可以执行 X 了吗?」并等明确 OK。没人在 prod 上 debug — 任一 smoke assertion 失败 → **立即回滚**，不在 prod 上修代码（per memory feedback_production_rigor_2026_04_21.md）。

## 0. 谁能跑

仅限 **Yuandong** 可以跑这个 skill。任何其他人要部署 → 让 zyd 来。

理由：deploy 触碰 prod，且操作员要持有 .secrets/SERVERS.env + SSH 私钥。

## 1. 拓扑速查（per .secrets/SERVERS.env）

| Box | Role | 公网 IP | Tailscale IP | 跑什么 | 部署目录 + 分支 | 启动方式 |
|---|---|---|---|---|---|---|
| Box1 | `app` | 47.77.239.237 | 100.109.220.126 | backend (8888 loopback) + MCP (Box1 Tailscale:8889) + frontend (80→nginx) | `/app/crm` @ `main` | `docker compose up -d --build` (3 services) |
| Box2 | `ai` | 47.251.10.171 | 100.83.72.110 | nanobot serve (8900) askola + nanobot gateway (8901) channels (email) | `/root/nanobot` @ `ola-main` | systemd: `nanobot.service` + `nanobot-gateway.service` (gateway unit env: OLA_MCP_URL + MCP_SERVICE_TOKEN, see §13) |
| Box3 | `pdf` | 47.251.88.107 | 100.67.65.4 | Gotenberg PDF docker | — | docker (deploy 一般不动 Box3) |

**关键 env：**
- 项目根 `/app/crm/.env` 必须设 `MCP_BIND_ADDR=100.109.220.126`（Box1 Tailscale IP）— docker-compose mcp service 用 `${MCP_BIND_ADDR:?}` fail-fast 语法，没设这个 `docker compose up` 会立刻退出。MCP 容器对外只暴露 Tailscale IP，**不**绑 `127.0.0.1`，所以 Box1 内 `curl 127.0.0.1:8889` 会 connection-refused — 内网 smoke 必须用 `curl 100.109.220.126:8889`。
- backend/.env `NANOBOT_HOST=100.83.72.110` (Box2 TS), `MCP_HOST=100.109.220.126` (Box1 TS, 只用于 backend 知道往哪儿打), `GOTENBERG_URL=http://100.67.65.4:3000` (Box3 TS)
- Box2 `~/.nanobot/config.json` `tools.mcpServers.ola_crm.url = http://100.109.220.126:8889/mcp` — 跨 Tailscale 调 Box1 MCP
- Box2 `~/.nanobot/workspace/{SOUL,AGENTS,TOOLS}.md + skills/` — agent 加载这套作 prompts/skill。**`nanobot.service` 不会自动 sync repo 的 `ola/nanobot-workspace/` 副本** — Phase 2 §4.2 必须显式 scp 过去并 restart，否则 prod agent 用 stale 老 prompts

公网入口：Cloudflare Proxy（Flexible mode）→ Box1:80 → frontend nginx。Production URL: `https://app.olatech.ai`（主），`https://app.olajob.cn`（过渡期）。

**dev/main 注意**：CRM 的 `dev` 分支累 feature PR，**Yuandong 手动**在 GitHub 上点 "Merge dev → main"（per CLAUDE.md branch policy: "Yuandong-only, manually on GitHub"）。Box1 拉的是 main，不是 dev — 所以**部署前必须确认 main HEAD 已经包含本次要 ship 的 commit**。如果 dev 还没 merge 到 main，本 skill Phase 0 会卡住。

## 2. Phase 0 — Pre-flight（不会破坏任何东西，先做）

### 2.1 上游分支必须先合（Yuandong 手动）

部署目标分支：CRM `main` (Box1) + nanobot `ola-main` (Box2)。本次要 ship 的内容必须在这两个分支的 HEAD。

| Repo | 集成分支 | 部署目标分支 | 由谁合 |
|---|---|---|---|
| `SeekMi-Technologies/Ola` | `dev` | `main` | Yuandong 手动 (GitHub admin merge) |
| `SeekMi-Technologies/Ola_bot` | `ola-dev` | `ola-main` | Yuandong 手动 (PR `ola-dev` → `ola-main`) |

进 2.2 前 zyd 必须确认两条 merge 都到位 — skill 不替操作员做 main / ola-main 的合并。

### 2.2 本地代码核对

```bash
# 在本地 crm/ 跑
git fetch origin
git log origin/main -3 --oneline          # 期望最上面是本次要 ship 的 merge commit
git log origin/main..origin/dev --oneline # 应该为空（dev 上没有 main 缺的内容）

cd ../nanobot   # 或 ../Ola_bot
git fetch origin
git log origin/ola-main -3 --oneline
git log origin/ola-main..origin/ola-dev --oneline   # 应该为空
```

**门禁：**

- 本地两个仓 working tree clean
- `origin/main..origin/dev` 为空（dev 上没有 main 缺的 commit；反向方向 `origin/dev..origin/main` 含 merge wrappers + 直推 main 的 CI workflow，不是分歧不要看）
- `origin/ola-main..origin/ola-dev` 为空
- `origin/main` HEAD 第一行是本次要 ship 的 merge commit（操作员凭本次 PR # 核对）
- `origin/ola-main` HEAD 第一行是本次要 ship 的 nanobot merge commit

**Fingerprint 检查（per memory feedback_secrets_single_source_of_truth.md）：**

⚠️ `.secrets/SERVERS.env` 的值可能用单引号包裹（shell-style），所以 `tr` 必须同时剥单/双引号 + trailing whitespace。否则 sha256 会算到引号 char 上，三处永远不等。

```bash
# 本地 .secrets/SERVERS.env 的 MCP_SERVICE_TOKEN sha256[:8]
grep '^MCP_SERVICE_TOKEN=' .secrets/SERVERS.env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\n' | tr -d ' ' | sha256sum | cut -c1-8

# Box1 上 backend/.env 同样剥引号 + sha256
ssh root@47.77.239.237 "grep '^MCP_SERVICE_TOKEN=' /app/crm/backend/.env | cut -d= -f2- | tr -d '\"' | tr -d \"'\" | tr -d '\n' | tr -d ' ' | sha256sum | cut -c1-8"

# Box2 ~/.nanobot/config.json 的 bearer token sha256
ssh root@47.251.10.171 "python3 -c \"
import json, hashlib
d = json.load(open('/root/.nanobot/config.json'))
tok = d['tools']['mcpServers']['ola_crm']['headers']['Authorization'].split()[-1].strip()
print(hashlib.sha256(tok.encode()).hexdigest()[:8])
\""
```

三个 sha256[:8] 必须相等。任一不符 → 停，先 rotate secrets（参考 `.secrets/SERVERS.env` 的 SOP）。

报告给 zyd 这一步的结果，等明确 OK 才进 Phase 1。

## 3. Phase 1 — Box1 部署（backend + MCP + frontend，~5 min）

**操作前问 zyd：「可以 deploy Box1 了吗?」**

```bash
ssh root@47.77.239.237
cd /app/crm
git fetch origin
git log HEAD..origin/main --oneline   # 显示这次会拉的 commits
git pull origin main
docker compose up -d --build
docker compose ps                     # 确认 backend / mcp / frontend 都 running
```

**Per-Box1 health 校验（不接外网，先内网）：**

```bash
# 在 Box1 ssh 内
curl -sS http://127.0.0.1:8888/health           # 应 {"status":"ok"} 或 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8888/api/setting/listAll  # 401（auth gate 生效）
```

**MCP acting-as fail-closed 验证（每次部署必跑，产品红线）：** 直接打 Box1 MCP 端口验证 `headerResolver.js` 的 fail-closed gate 仍在 prod 起作用。这是 multi-admin 数据隔离的硬保障，不论本次部署改了什么，这条 smoke 永远跑。

⚠️ **MCP 在 prod 上只绑 Box1 Tailscale IP**（`100.109.220.126:8889`），**不**绑 `127.0.0.1` — docker-compose 的 `MCP_BIND_ADDR=100.109.220.126` 决定。所以 Box1 ssh 内必须用 Tailscale IP curl，不是 loopback。

```bash
# 在 Box1 ssh 内
TOKEN=$(grep '^MCP_SERVICE_TOKEN=' /app/crm/backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\n' | tr -d ' ')
URL=http://100.109.220.126:8889/mcp     # Box1 Tailscale IP, NOT 127.0.0.1
ACCEPT='application/json, text/event-stream'

# 1. 缺 X-Acting-As 调 business tool → 401 UNAUTHORIZED
curl -sS -o /dev/null -w '1_business_no_header: %{http_code}\n' -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Accept: $ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"customer.create","arguments":{}}}'
# 期望: 1_business_no_header: 401

# 2. 缺 X-Acting-As 调 system tool (salesperson.lookup_by_email) → 200
curl -sS -o /dev/null -w '2_system_no_header: %{http_code}\n' -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Accept: $ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"salesperson.lookup_by_email","arguments":{"email":"admin@admin.com"}}}'
# 期望: 2_system_no_header: 200

# 3. 错 ObjectId → 400 VALIDATION
curl -sS -o /dev/null -w '3_bad_objectid: %{http_code}\n' -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Acting-As: not-a-valid-id' \
  -H 'Content-Type: application/json' \
  -H "Accept: $ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"customer.create","arguments":{}}}'
# 期望: 3_bad_objectid: 400
```

任 1/2/3 不符预期 → fail-closed gate 没真上 prod（数据隔离保护失效），回滚（Phase 6）。

任一 health 失败 → `docker compose logs --tail=80 backend mcp frontend`，给 zyd 看 → 回滚（Phase 6）。

## 4. Phase 2 — Box2 部署（nanobot serve + gateway，~3 min）

**操作前问 zyd：「Box2 nanobot 可以 restart 了吗?」**（kill nanobot 进程会断 askola 几秒）

**Box2 服务模型**：两个 systemd unit 跑同一套 nanobot 源码：
- `nanobot.service` — `python -m nanobot serve --host 0.0.0.0 --port 8900`（askola 后端）
- `nanobot-gateway.service` — `python -m nanobot gateway --port 8901`（channels: email/etc）

两者都 enable + active；都从 `/root/nanobot/` 源码加载，`git pull` 后必须**双 restart**才能真上线。Gateway unit 含两个 `Environment=` (OLA_MCP_URL + MCP_SERVICE_TOKEN)，详见 §13 first-time install。

**关键：nanobot 不是 pip 包，是 source-tree import。** 不需要 `pip install` — `git pull` 拉到的 `/root/nanobot/nanobot/*.py` 直接被 `python -m nanobot` 加载。也没有 `requirements.txt`，依赖在 `pyproject.toml`（生产 Box2 已经装好），只有真新增 dep 的 release 才需要 `pip install -e .`。

### 4.1 nanobot code (git pull + restart 两个 unit)

```bash
ssh root@47.251.10.171
cd /root/nanobot

# 切到 ola-main 拉最新（command 幂等：already-on-ola-main 也 OK）
git fetch origin
git checkout ola-main
git pull origin ola-main
git log -1 --oneline                     # 报告 HEAD commit 给 zyd 核对

# 双 restart — 两个 unit 共用 source tree
systemctl restart nanobot.service nanobot-gateway.service
sleep 4
systemctl is-active nanobot.service nanobot-gateway.service
curl -sS -o /dev/null -w 'serve_health: %{http_code}\n' --max-time 5 http://127.0.0.1:8900/health
curl -sS -o /dev/null -w 'gateway_health: %{http_code}\n' --max-time 5 http://127.0.0.1:8901/health
```

### 4.2 nanobot prompts + skills sync（**每次部署必跑**）

`nanobot.service` 直接 `python -m nanobot serve` 启动，**没**跑 `start-dev.sh` 里的 prompts sync。所以 `~/.nanobot/workspace/{SOUL,AGENTS,TOOLS}.md` + `skills/` 不会跟随 `git pull` 自动更新 — 必须显式从本地 repo `scp` 过去。漏这步的症状：agent 在 prod 用 stale 老 prompts（quote 双打、skill 没生效、新 agent 行为不上 prod）。

```bash
# 在本地 crm/ 仓根跑（用 sshpass + scp，因为 Box2 没装 rsync）
set -a; source .secrets/SERVERS.env; set +a

# 同步 canonical prompts（每次部署 always overwrite）
sshpass -p "$BOX2_PASS" scp -o StrictHostKeyChecking=no \
  ola/nanobot-workspace/SOUL.md \
  ola/nanobot-workspace/AGENTS.md \
  ola/nanobot-workspace/TOOLS.md \
  root@$BOX2_HOST:/root/.nanobot/workspace/

# 同步 skills/（递归）
sshpass -p "$BOX2_PASS" scp -r -o StrictHostKeyChecking=no \
  ola/nanobot-workspace/skills \
  root@$BOX2_HOST:/root/.nanobot/workspace/

# 重启两个 unit 拉取新 prompts（systemd 不会自动 reload prompts，必须重启进程）
sshpass -p "$BOX2_PASS" ssh -o StrictHostKeyChecking=no root@$BOX2_HOST \
  "systemctl restart nanobot.service nanobot-gateway.service && sleep 4 && systemctl is-active nanobot.service nanobot-gateway.service"
```

**校验：**

```bash
sshpass -p "$BOX2_PASS" ssh -o StrictHostKeyChecking=no root@$BOX2_HOST "
ls -la /root/.nanobot/workspace/SOUL.md   # mtime 应当是今天
find /root/.nanobot/workspace/skills/ -type f
"
```

任一步失败 → `journalctl -u nanobot.service -n 100 --no-pager` 或 `journalctl -u nanobot-gateway.service -n 100 --no-pager`，给 zyd 看 → 回滚（Phase 6）。

## 5. Phase 3 — Public smoke（curl 4 条断言，必须全绿）

**任一断言失败 → 立即 rollback，不在 prod debug**（per memory feedback_infra_change_curl_e2e.md）。

```bash
# 本地或 Box1，curl 公网
PROD=https://app.olatech.ai

# 1. Health 200
curl -sS -o /dev/null -w 'health: %{http_code}\n' $PROD/health
# 期望: health: 200

# 2. /api 不带 cookie → 401（auth gate 生效）
curl -sS -o /dev/null -w 'api_unauth: %{http_code}\n' $PROD/api/setting/listAll
# 期望: api_unauth: 401

# 3. 完整 login + cookie
COOKIEDIR=$(mktemp -d)
curl -sS -c $COOKIEDIR/cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@admin.com","password":"admin123"}' \
  -o /dev/null -w 'login: %{http_code}\n' \
  $PROD/api/login
# 期望: login: 200
test -s $COOKIEDIR/cookies.txt || echo 'FAIL: no cookie set'

# 4. 用 cookie 拿受保护接口
curl -sS -b $COOKIEDIR/cookies.txt -o /dev/null -w 'protected: %{http_code}\n' \
  $PROD/api/setting/listAll
# 期望: protected: 200

rm -rf "$COOKIEDIR"
```

报告 4 条结果。任一不符预期 → 回滚（Phase 5）。

## 6. Phase 4 — Functional smoke askola（→ MCP → nanobot → backend → DB 全链路 + 跨 admin 隔离）

这步证明 prod 端 acting-as 多 admin 数据隔离**真的 work**（每次部署必跑，产品红线）。**测试数据用 ZYD-DEPLOY-{ts}-* 前缀**。

跑两次：先 admin@admin.com 创 doc，再 yuz371@ucsd.edu 创 doc，最后**互相验证看不到对方的 doc**。

```bash
PROD=https://app.olatech.ai
TS=$(date +%s)
COOKIEDIR=$(mktemp -d)

# ─── Round 1: admin@admin.com 创建 customer ──────────────────────
NAME_ADMIN="ZYD-DEPLOY-${TS}-CUST-admin"
curl -sS -c $COOKIEDIR/c_admin.txt -H 'Content-Type: application/json' \
  -d '{"email":"admin@admin.com","password":"admin123"}' \
  $PROD/api/login > /dev/null
curl -sS -N -b $COOKIEDIR/c_admin.txt -H 'Content-Type: application/json' \
  -d "{\"message\":\"创建客户 $NAME_ADMIN, 国家 US, 联系人 deploy smoke, 邮箱 zyde2e@example.com\"}" \
  $PROD/api/ola/chat 2>&1 | grep -E "event: done|tool_event|customer.create" | head -5

# ─── Round 2: yuz371@ucsd.edu 创建 customer ──────────────────────
NAME_YUZ="ZYD-DEPLOY-${TS}-CUST-yuz371"
curl -sS -c $COOKIEDIR/c_yuz.txt -H 'Content-Type: application/json' \
  -d '{"email":"yuz371@ucsd.edu","password":"12345678"}' \
  $PROD/api/login > /dev/null
curl -sS -N -b $COOKIEDIR/c_yuz.txt -H 'Content-Type: application/json' \
  -d "{\"message\":\"创建客户 $NAME_YUZ, 国家 US, 联系人 deploy smoke, 邮箱 zyde2e@example.com\"}" \
  $PROD/api/ola/chat 2>&1 | grep -E "event: done|tool_event|customer.create" | head -5

# Wait briefly for the writes to settle
sleep 3

# ─── Cross-admin 验证 ─────────────────────────────────────────────
# admin 应能看到自己的 admin doc，但看不到 yuz371 的
curl -sS -b $COOKIEDIR/c_admin.txt "$PROD/api/client/search?fields=name&q=$NAME_ADMIN" | python3 -c "import json,sys; r=json.load(sys.stdin); print('admin sees admin doc:', any(c['name']==\"$NAME_ADMIN\" for c in r.get('result',[])))"
curl -sS -b $COOKIEDIR/c_admin.txt "$PROD/api/client/search?fields=name&q=$NAME_YUZ"   | python3 -c "import json,sys; r=json.load(sys.stdin); print('admin sees yuz371 doc (must be False):', any(c['name']==\"$NAME_YUZ\" for c in r.get('result',[])))"

# yuz371 应能看到自己的 yuz371 doc，但看不到 admin 的
curl -sS -b $COOKIEDIR/c_yuz.txt "$PROD/api/client/search?fields=name&q=$NAME_YUZ"   | python3 -c "import json,sys; r=json.load(sys.stdin); print('yuz371 sees yuz371 doc:', any(c['name']==\"$NAME_YUZ\" for c in r.get('result',[])))"
curl -sS -b $COOKIEDIR/c_yuz.txt "$PROD/api/client/search?fields=name&q=$NAME_ADMIN" | python3 -c "import json,sys; r=json.load(sys.stdin); print('yuz371 sees admin doc (must be False):', any(c['name']==\"$NAME_ADMIN\" for c in r.get('result',[])))"

rm -rf "$COOKIEDIR"
```

**预期 4 行输出：**

```
admin sees admin doc: True
admin sees yuz371 doc (must be False): False
yuz371 sees yuz371 doc: True
yuz371 sees admin doc (must be False): False
```

任一不符预期 → 跨 admin 隔离在 prod 没真 work，**回滚**。

**手动浏览器 sanity（zyd 自己做）：**

打开 https://app.olatech.ai 双 incognito 同时登 admin@admin.com 和 yuz371@ucsd.edu，进 Ask Ola，各自发"我有什么客户"。两边只看到自己的 namespace。

## 7. Phase 4b — Email channel sanity（每次部署必跑，产品红线）

prod 上 email channel 真在跑（Box2 `nanobot-gateway.service` enabled + active），acting-as 路径 + Tailscale MCP 调用都已经端到端验证过。**部署 nanobot 任何 channel 改动都要跑这条**，否则 email 链路 regression 会 silent。

**前置健康检查（gate）：**

```bash
sshpass -p "$BOX2_PASS" ssh -o StrictHostKeyChecking=no root@$BOX2_HOST "
systemctl is-active nanobot-gateway.service   # 应当 active
ss -tlnp 2>/dev/null | grep ':8901\b'          # 应当 LISTEN
"
```

任一不健康 → gateway 没起，先 fix 再跑这条（一般是 systemd unit 缺 Environment 变量，参考 §13 first-time install 的 unit 模板）。

**跑法：**

操作员的本地 Python 必须有 `imaplib`（标准库）+ `pymongo`。设 `NANOBOT_PY` env 指向你的 venv（缺省走 Duke 的 macbook 路径，其他人必须 override）：

```bash
# 在本地（不在 prod box 上跑，避免污染 prod）
set -a; source .secrets/SERVERS.env; set +a
RUN_ID=$(date +%s)
SENDER='yuz371@ucsd.edu'
NAME="ZYD-DEPLOY-EMAIL-${RUN_ID}-CUST-yuz371"

# 操作员可 export NANOBOT_PY=/path/to/your/.venv/bin/python 覆盖
PY=${NANOBOT_PY:-/Users/duke/Documents/GitHub/nanobot/.venv/bin/python}
test -x "$PY" || { echo "FAIL: $PY not executable; export NANOBOT_PY=<your venv python>"; exit 1; }

"$PY" <<EOF
import imaplib, os
from email.message import EmailMessage
from email.utils import make_msgid, formatdate
mu = os.environ['ZOHO_OLA_EMAIL']; mp = os.environ['ZOHO_OLA_APP_PASSWORD']; ih = os.environ['ZOHO_IMAP_HOST']
msg = EmailMessage()
msg["From"] = "$SENDER"; msg["To"] = mu
msg["Subject"] = f"[deploy-smoke] yuz371 #${RUN_ID}"
msg["Message-ID"] = make_msgid(); msg["Date"] = formatdate()
msg["Authentication-Results"] = f"{ih}; dkim=pass; spf=pass"
msg.set_content("Please create customer ${NAME}, country US, contact deploy-smoke, email zyde2e@example.com.")
with imaplib.IMAP4_SSL(ih, 993) as M:
    M.login(mu, mp)
    M.append("INBOX", "()", None, msg.as_bytes())  # empty flags so Zoho doesn't auto-\\Seen
EOF

# Bounded retry — 24 × 5s = 2min upper bound, exits early on success
set -a; source backend/.env; set +a
for i in $(seq 1 24); do
  sleep 5
  result=$("$PY" <<EOF
import os
from pymongo import MongoClient
db = MongoClient(os.environ['DATABASE'], tls=True, tlsAllowInvalidCertificates=True)['mydatabase']
expected = db.admins.find_one({'email': '$SENDER'})['_id']
c = db.clients.find_one({'name': '$NAME'})
if c is None:
    print('pending')
elif c.get('createdBy') == expected:
    print('PASS')
else:
    print(f'FAIL createdBy={c.get(\"createdBy\")} expected={expected}')
EOF
)
  case "$result" in
    PASS) echo "✓ ${i}*5=$((i*5))s — exists + createdBy match"; break ;;
    pending) echo "  ${i}*5=$((i*5))s — waiting for Box2 gateway poll + agent"; ;;
    *) echo "✗ ${result}"; break ;;
  esac
done
```

**预期：** 上面循环以 `✓ ... PASS` 结束。任一 `FAIL ...` → 回滚（Phase 6）。如果跑满 2 分钟还停在 `pending` → 看 Box2 `journalctl -u nanobot-gateway.service --since '3 min ago'`。

## 8. Phase 4c — Release-specific verification（操作员每次根据本次 PR 改动加）

Phase 1-4b 都是**每次部署都跑的产品红线 smoke**（acting-as fail-closed / 跨 admin 隔离 / health / login）— 跟具体改动无关。

但本次部署如果引入了**新 feature / 新 endpoint / 新 schema 字段 / 新 MCP tool / 新依赖**，要在这条加 ad-hoc smoke：

| 改动类型 | 建议 ad-hoc smoke |
|---|---|
| 新 backend route / controller | `curl` 对应 endpoint，最少 3 条断言（happy / 401 / 400 — 不接受"endpoint 不 500 就算过"） |
| 新 MCP tool | 用 `MCP_SERVICE_TOKEN` + `X-Acting-As` 真打那条 tool/call，验返回 envelope `{ok:true, data:...}` |
| 新 Mongoose 字段 | 测一次 create 把字段写进去 + read 拿回来 |
| 新前端组件 | 浏览器手测（zyd 自己看），不在本 skill 自动跑 |
| 新 npm / pip 依赖 | docker compose build / pip install 必须真用了新包（不是只 install 没用上） |
| 新环境变量 | grep `/app/crm/backend/.env` 或 `~/.nanobot/config.json` 确认 prod 真设了 |

操作员（zyd）部署前看本次 PR description "Verification" 段，把对应 ad-hoc smoke 复制进 Phase 4c 跑一次，绿了再去 Phase 5 cleanup。

如果本次部署只是 bug fix / 重构 / 文档 / CI 改动 → Phase 4c 跳过，写 "no release-specific surface" 给 zyd。

## 9. Phase 5 — Cleanup deploy 测试数据

```bash
# Box1
cd /app/crm/backend
node scripts/cleanup_zyd_e2e_data.js
# 确认 "soft-deleted: clients=N" 包含本次 ZYD-DEPLOY-*
```

或者本地连 Atlas 跑相同 script。

## 10. Phase 6 — 回滚 SOP（任一 phase 失败时立即跑）

**Box1 回滚：**

```bash
ssh root@47.77.239.237
cd /app/crm
git log --oneline -5                # 找上一个已知 good commit
git reset --hard <prev-good-commit>
docker compose up -d --build
curl -sS http://127.0.0.1:8888/health  # 200 确认回到 good
```

**Box2 回滚：**

```bash
ssh root@47.251.10.171
cd /root/nanobot
git log --oneline -5
git reset --hard <prev-good-commit>
# 双 unit restart — 跟 Phase 2 / §4.2 一致；nanobot source-tree import，无需 pip install
systemctl restart nanobot.service nanobot-gateway.service
sleep 4
systemctl is-active nanobot.service nanobot-gateway.service
```

回滚后再跑一次 Phase 3 + Phase 4 smoke 确认 prod 真回到了 good。

报告给 zyd 触发回滚的具体 fail，列出哪一步、哪个 assertion 没满足、原始 stderr。**不在 prod debug**。

## 11. 横切红线

- **任一 destructive action 必须先问 zyd**（git pull / docker compose up -d / kill nanobot / git reset --hard）。这条不是建议，是 zyd 的 push protocol 推论
- **不在 prod 跑 nano backend/.env 编辑** — 真要改 env 走 `.secrets/SERVERS.env` rotation SOP，不是手动改 .env
- **永远 fingerprint 核对 .env** Box1 vs 本地 secrets，部署前 + 部署后都要
- **Smoke 全绿才算部署成功**。哪怕 health 200 但 askola tool_event 不出，仍然是 fail
- **历史 commit 留 5 个**（git log -5）作为 rollback 候选；不 force-push 任何东西到 main / ola-main

## 12. 出口

部署成功 → 报告给 zyd：
- Box1 / Box2 git HEAD commit hash
- Phase 3 4 条 + Phase 4 functional 全绿
- ZYD-DEPLOY-* 测试数据 cleanup 计数
- 部署用时

部署失败 → 完成回滚 + 报告：
- 触发的 assertion / phase
- 回滚到的 commit hash
- prod 当前是否健康（4 条 smoke 重跑结果）
- 下一步建议（修哪个 commit、哪条测试要补）

## 13. Appendix — 一次性安装：Box2 nanobot-gateway.service

> 拓扑变化或新 box 接管 ai role 时才跑。日常部署 Phase 0-6 已 cover 既有 unit 的 git pull + restart。

**前置（本 appendix 不 cover）**：`/root/nanobot/` git clone + `pip install -e .` + `nanobot.service` (serve, 8900) 已经装好并 active。这是建 ai role box 的最早一步，参考 `ola/DEPLOY_RUNBOOK.md` Phase 4。如果连 `nanobot.service` 还没起，先去走那条 SOP，再回到这里装 gateway。

### 13.1 systemd unit 模板

```bash
ssh root@<box2-public-ip>

cat > /etc/systemd/system/nanobot-gateway.service <<'UNIT'
# /etc/systemd/system/nanobot-gateway.service
[Unit]
Description=Ola NanoBot Gateway (channels: email, etc)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/nanobot
# OLA_MCP_URL: gateway 调 MCP 的 URL（Ola#204）— Box2 ≠ Box1 时必填
Environment=OLA_MCP_URL=http://<Box1-Tailscale-IP>:8889/mcp
# MCP_SERVICE_TOKEN: email 反查 sender → admin 时 Bearer auth — 跟 Box1 backend/.env 的同一个 token
Environment=MCP_SERVICE_TOKEN=<token>
ExecStart=/usr/bin/python3.11 -m nanobot gateway --port 8901
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# unit 含 token，限模式 600
chmod 600 /etc/systemd/system/nanobot-gateway.service
```

⚠️ **两个 `Environment=` 都必填，缺哪个都 broken：**
- 缺 `OLA_MCP_URL` → gateway 调 `127.0.0.1:8889/mcp` connection-refused → 邮件全 drop
- 缺 `MCP_SERVICE_TOKEN` → `_resolve_sender_acting_as` raise `RuntimeError: MCP_SERVICE_TOKEN env var is not set` → 邮件全 drop（journal 里看得见）

### 13.2 邮件 channel config

`~/.nanobot/config.json` 必须有 `channels.email.*`（注意 **camelCase** key），最少：

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "consentGranted": true,
      "imapHost": "imappro.zoho.com",
      "imapPort": 993,
      "imapUsername": "ola@olatech.ai",
      "imapPassword": "<password from .secrets/SERVERS.env ZOHO_OLA_APP_PASSWORD>",
      "imapMailbox": "INBOX",
      "imapUseSsl": true,
      "smtpHost": "smtppro.zoho.com",
      "smtpPort": 587,
      "smtpUsername": "ola@olatech.ai",
      "smtpPassword": "<same as imapPassword>",
      "smtpUseTls": true,
      "smtpUseSsl": false,
      "fromAddress": "ola@olatech.ai",
      "autoReplyEnabled": true,
      "pollIntervalSeconds": 30,
      "markSeen": true,
      "maxBodyChars": 12000,
      "subjectPrefix": "Re: ",
      "allowFrom": ["*"],
      "verifyDkim": false,
      "verifySpf": false
    }
  }
}
```

合并到现有 `~/.nanobot/config.json`（不要覆盖整个文件 — 会丢掉 mcpServers / agents 等其它字段）：

```bash
# 本地构造 email block (从 .secrets/SERVERS.env)，scp 给 Box2，python 合并
cp ~/.nanobot/config.json ~/.nanobot/config.json.bak.$(date +%s)
python3 -c "
import json
cfg = json.load(open('/root/.nanobot/config.json'))
new_email = json.load(open('/tmp/email_block.json'))
cfg.setdefault('channels', {})['email'] = new_email
json.dump(cfg, open('/root/.nanobot/config.json', 'w'), indent=2)
"
chmod 600 /root/.nanobot/config.json
```

### 13.3 启动 + enable

```bash
systemctl daemon-reload
systemctl enable nanobot-gateway.service
systemctl start nanobot-gateway.service
sleep 4
systemctl is-active nanobot-gateway.service     # active
ss -tlnp 2>/dev/null | grep ':8901\b'             # LISTEN

# 第一封测试邮件
journalctl -u nanobot-gateway.service -f
# 在另一个 shell 用 IMAP append 注入测试邮件 (参考 Phase 4b 跑法)
```

预期 journal 看到：
```
Tool call: mcp_ola_crm_salesperson.lookup_by_email({"email": "<sender>"})
Tool call: mcp_ola_crm_customer.create({...})
Response to email:<sender>: 已成功创建...
```

不见 → 缺 env 变量（参考 §13.1 ⚠️）。

完成 §13 后，回主流 Phase 4b 走端到端测试。
