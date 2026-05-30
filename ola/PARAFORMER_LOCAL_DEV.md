# Paraformer 本地开发 SOP

> 配套 #257 — DashScope Paraformer-v2 转写引擎接入。OpenAI 推 multipart 不需要任何
> tunnel，paraformer 只接受 public URL 拉取，所以本地开发必须挂 cloudflared
> quick tunnel 把 Mac 后端临时暴露给 DashScope。

## 一、首次 setup（每台机器只做一次）

### 1. 装 cloudflared
```bash
brew install cloudflared
```

### 2. backend/.env 加 DASHSCOPE_API_KEY
```bash
echo 'DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx' >> backend/.env
```

key 找 zyd 拿。`BACKEND_PUBLIC_BASE_URL` 不要手填，`start-dev-paraformer.sh` 会
动态写入。

### 3. 把要测的 admin 切到 paraformer
```bash
cd backend
node src/setup/set-admin-provider.js admin@admin.com paraformer
```

切回时：
```bash
node src/setup/set-admin-provider.js admin@admin.com openai
node src/setup/set-admin-provider.js admin@admin.com null   # 跟随 env 默认
```

## 二、每次 E2E 测试

### Terminal 1 — 一键起 backend + tunnel
```bash
bash start-dev-paraformer.sh
```

输出：
```
[1/3] Starting cloudflared quick tunnel → http://localhost:8888 ...
     Waiting for tunnel URL... ok (5s)
     → https://xxx-yyy-zzz.trycloudflare.com
[2/3] Wrote BACKEND_PUBLIC_BASE_URL → backend/.env
[3/3] Handing off to start-dev.sh ...
=== Status ===
  Backend         : running (port 8888)
  ...
```

### Terminal 2 — 实时看 worker log
```bash
tail -f /tmp/ola-backend.log | grep -E 'transcribe|paraformer'
```

### Terminal 3 — 真正 E2E
```bash
# (a) 登录拿 cookie
curl -sX POST http://localhost:8888/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.com","password":"admin123"}' \
  -c /tmp/cookies.txt > /dev/null

# (b) 上传音频（示例用 /Users/duke/Desktop/未命名.m4a）
RESP=$(curl -sX POST http://localhost:8888/api/file/upload \
  -b /tmp/cookies.txt \
  -F "file=@/Users/duke/Desktop/未命名.m4a")
FILE_ID=$(echo $RESP | jq -r .result._id)
JOB_ID=$(echo $RESP | jq -r .result.transcriptionJobId)
echo "file=$FILE_ID job=$JOB_ID"

# (c) Smoke: 验证 corePublicAudioRouter 可达（关键卫兵）
SOURCE=$(curl -sb /tmp/cookies.txt http://localhost:8888/api/file/read/$FILE_ID | jq -r .result.sourcePath)
URL=$(grep BACKEND_PUBLIC_BASE_URL backend/.env | cut -d= -f2)
curl -sIo /dev/null -w "public/audio: HTTP %{http_code}\n" "$URL/public/audio/$SOURCE"
# 期望 HTTP 200 — 这一步炸了 → tunnel 或 router 问题，跟 paraformer 无关

# (d) 轮询 Job
while :; do
  STATUS=$(curl -sb /tmp/cookies.txt http://localhost:8888/api/job/read/$JOB_ID | jq -r .result.status)
  echo "$(date +%H:%M:%S) status=$STATUS"
  [ "$STATUS" = "done" ] && break
  [ "$STATUS" = "failed" ] && { echo "FAIL"; curl -sb /tmp/cookies.txt http://localhost:8888/api/job/read/$JOB_ID | jq .result.error; exit 1; }
  sleep 3
done

# (e) 读 sidecar
curl -sb /tmp/cookies.txt http://localhost:8888/api/file/transcript/$FILE_ID \
  | jq -r .result.transcript | head -20
```

## 三、PASS 标准（5 条断言）

terminal 2 应该看到：
```
[transcribe.worker] job=... file=... provider=paraformer  pending→running
[paraformer] submit ok task_id=xxxx-xxxx
[paraformer] poll [   0s] RUNNING
[paraformer] poll [   5s] RUNNING (heartbeat job.updated=now)
[paraformer] poll [  15s] SUCCEEDED
[paraformer] fetched <N> sentences <M> speakers
[paraformer] OpenCC s2hk + 繫→係 applied
[transcribe.worker] job=... status=done duration_ms=<N>
```

terminal 3 (e) sidecar 应该满足：
1. ✓ 首行格式 `A 00:00  跟住大家有個關係...` — 注意 `A` 不是 `SPEAKER_0`，`關係/時候` 是繁体
2. ✓ 含 `A` 和 `B` 两个 speaker（如果有第二人）
3. ✓ mm:ss 时间戳单调递增

terminal 3 (c) 必须 `HTTP 200` — 本地 dev 链路完整性的卫兵。

整体 Job 流转 `pending → running → done`，无 `failed`。

## 四、停止 + 清理

```bash
bash stop-dev.sh
```

会自动：
- kill backend / MCP / nanobot / frontend
- kill cloudflared
- 从 backend/.env 删 BACKEND_PUBLIC_BASE_URL 那行
- 清 /tmp/ola-cloudflared.pid + .url

跑完一定要 `bash stop-dev.sh`，不然 cloudflared 进程会留到下次 start-dev-paraformer.sh 启动时被 stale-pid 检测清掉。

## 五、Debug 矩阵

| 失败 step | 第一时间看 |
|---|---|
| (c) 不是 HTTP 200 | `cat /tmp/ola-cloudflared.log` 看 tunnel 健康；`tail /tmp/ola-backend.log` 看 corePublicAudioRouter 报错；regex 是不是挡掉合法 path |
| (d) 长时间 running | terminal 2 有 `submit ok` 吗？没有 → `DASHSCOPE_API_KEY` 没读到，确认 backend 启动时已 source .env；有 submit + poll RUNNING 永不变 → DashScope 拉不到 cloudflared URL，看 cloudflared log |
| (d) failed | `curl -sb cookies http://.../api/job/read/<id>` 拿 `result.error`，按 error 内容定位 |
| sidecar 是简体 | OpenCC `s2hk` 没生效，看 paraformerProvider.js 里 `applyOpenCC` throw 没；package.json 有 `opencc-js` 依赖吗 |
| sidecar 是 `SPEAKER_0` 不是 `A` | speaker_id→letter map 没接上，看 `formatParaformerSidecar` |
| terminal 1 报 `cloudflared not found` | `brew install cloudflared` |
| terminal 1 报 `WARN: no DASHSCOPE_API_KEY` | 按上面"首次 setup"第 2 步加 |
| Ctrl-C 后 backend 仍跑 | 用 `bash stop-dev.sh` 不要 Ctrl-C |

## 六、Workflow 选择

- **改 paraformer 本身 / OpenCC / dispatcher**：用 `bash start-dev-paraformer.sh`
- **改任意 provider 无关代码**（FE / 其他 controller / MCP）：用 `bash start-dev.sh` 跳过 tunnel，admin 切回 openai，不用 cloudflared 也能跑

## 七、生产 Box1

prod 不需要 cloudflared。Box1 `.env.production` 里：

```bash
DASHSCOPE_API_KEY=sk-...
BACKEND_PUBLIC_BASE_URL=http://47.77.239.237   # Box1 公网 IP，绕过 CF
```

`http://` 不是 `https://` —— DashScope 直 IP 拉，没有域名走 CF 拦截。这是 spike
#257 已经验证 work 的链路。
