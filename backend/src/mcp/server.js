// Ola CRM — MCP Server
//
// 独立 Node 进程，监听 127.0.0.1:8889/mcp，通过 Model Context Protocol
// 把 CRM 业务能力暴露给 NanoBot。
//
// 启动: `npm run mcp:dev` (from backend/)
//
// Stateless streamableHttp 模式：每个 POST /mcp 请求**自带完整生命周期**，
// 因此服务端必须 per-request 创建 server + transport，处理完销毁。
// A1 最初做成 singleton 是个 latent bug —— 只有 initialize 这种"协议入口"
// 调用刚好 work，第二个调用（如 tools/list）就 500。A2 一并修复。
// 参考: https://github.com/modelcontextprotocol/typescript-sdk#without-session-management-stateless

require('module-alias/register');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

// require('./auth') 会在加载时校验 MCP_SERVICE_TOKEN env，缺失即抛错 → 整进程退出
const requireAuth = require('./auth');
const { auditLog, hashInput } = require('./logger');
const { bootstrap } = require('./bootstrap');
const { runWithContext } = require('./context');
const { decideActingAdmin } = require('./headerResolver');
// NOTE: do NOT require('./tools/registry') at top-level — it transitively
// requires controllers which call mongoose.model('Client'/...), which
// throws unless bootstrap() has run first. Lazy-load inside main().
let registry = null;
let TOOL_COUNT = 0;

// MCP_HOST controls the bind address.
// - Default '127.0.0.1' — local-only, nanobot on the same machine (loopback).
// - '0.0.0.0' — all interfaces. Use when nanobot runs on a DIFFERENT machine
//   (e.g. 3-box Tailscale topology). Security still depends on:
//     1. MCP_SERVICE_TOKEN bearer auth (mandatory, enforced by auth.js)
//     2. Network-layer isolation (Tailscale ACL / host firewall / security group)
//   Never set to 0.0.0.0 on a host without BOTH defenses active.
// - Specific IP (e.g. Tailscale IP '100.109.220.126') — bind only that interface,
//   strictest cross-box option.
function resolveBindHost() {
  const raw = process.env.MCP_HOST;
  if (raw === undefined || raw === null) return '127.0.0.1';
  const host = String(raw).trim();
  if (host.length === 0) {
    throw new Error(
      '[mcp] MCP_HOST is set but empty/whitespace. Unset it to use default 127.0.0.1, ' +
        'or provide a valid bind address (e.g. 127.0.0.1, 0.0.0.0, or a specific IP).'
    );
  }
  return host;
}

const HOST = resolveBindHost();
const PORT = Number(process.env.MCP_PORT) || 8889;
const IS_LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';

// 任何未捕获的异常都必须显式 log + 退出，绝不 silent error
process.on('unhandledRejection', (reason) => {
  console.error('[mcp] unhandledRejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[mcp] uncaughtException:', err);
  process.exit(1);
});

// HTTP status → MCP error code (与 controllerAdapter.statusToCode 保持一致)
function mapStatusToCode(status) {
  if (status === 400) return 'VALIDATION';
  if (status === 401 || status === 403) return 'PERMISSION';
  if (status === 404) return 'NOT_FOUND';
  if (status === 405) return 'METHOD_NOT_ALLOWED';
  if (status === 409) return 'CONFLICT';
  return 'INTERNAL';
}

/**
 * Factory: 每次请求创建一个全新的 McpServer，注册当前的工具集，返回未连接的实例。
 * A4 之后这里会调用 tools/registry.js 自动 import crud/* 和 compute/*。
 * A1-A3 阶段返回空工具集。
 */
function createMcpServer() {
  const server = new McpServer({
    name: 'ola-crm-mcp',
    version: '0.1.0',
  });
  registry.registerAll(server);
  return server;
}

async function main() {
  const bootInfo = await bootstrap();
  console.log(`[mcp] bootstrap ok — system admin: ${bootInfo.admin.email} (${bootInfo.admin.role})`);
  // Lazy-load registry now that mongoose models are registered.
  // eslint-disable-next-line global-require
  registry = require('./tools/registry');
  TOOL_COUNT = registry.discover().length;

  const app = express();

  // GET /health — public liveness probe. No auth: reveals only
  // process-level metadata (no secrets, no business data).
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      ts: Date.now(),
      uptimeSec: Math.round(process.uptime()),
      toolsCount: TOOL_COUNT,
      bindHost: HOST,
      bindPort: PORT,
    });
  });

  // POST /mcp —— 唯一的 MCP 入口。
  // 中间件顺序：先鉴权（无 token 直接 401，省 body parse），再 json parse，再 handler。
  app.post('/mcp', requireAuth, express.json({ limit: '1mb' }), async (req, res) => {
    const startedAt = Date.now();
    const inputHash = hashInput(req.body);
    // A4: tools/call 时把 tool 字段升级为具体工具名；其它 JSON-RPC method 仍用 method 名。
    // 任何形状异常退回 'mcp.request'，绝不让 logger 抛错阻塞响应。
    const toolLabel = (() => {
      try {
        const m = req.body && req.body.method;
        if (m === 'tools/call') {
          const n = req.body.params && req.body.params.name;
          if (typeof n === 'string' && n.length > 0) return n;
        }
        if (typeof m === 'string' && m.length > 0) return m;
      } catch (_) { /* fall through */ }
      return 'mcp.request';
    })();
    let logged = false;
    const logOnce = (ok, code, message) => {
      if (logged) return;
      logged = true;
      auditLog({
        tool: toolLabel,
        input_hash: inputHash,
        latency_ms: Date.now() - startedAt,
        ok,
        code: code ?? null,
        ...(message ? { message } : {}),
      });
    };

    const decision = await decideActingAdmin(req.headers['x-acting-as'], toolLabel);
    if (!decision.ok) {
      logOnce(false, decision.code, decision.message);
      if (!res.headersSent) {
        res.status(decision.status).json({
          ok: false,
          code: decision.code,
          message: decision.message,
        });
      }
      return;
    }
    const { actingAdmin, isSystemFallback } = decision;

    // Stateless: per-request server + transport，确保每个 HTTP POST 是一个独立完整的 MCP 生命周期
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // 客户端断开 → 立即清理，防内存泄漏。同时兜底补一条日志（如果 handler 没机会写）
    res.on('close', () => {
      transport.close().catch((e) => console.error('[mcp] transport close error:', e));
      server.close().catch((e) => console.error('[mcp] server close error:', e));
      // 正常路径下 handler 已经记过日志；这里只在异常断开时兜底
      logOnce(res.statusCode < 400, res.statusCode >= 400 ? mapStatusToCode(res.statusCode) : null);
    });

    try {
      // Wrap transport handling in AsyncLocalStorage so tool handlers (loaded
      // by the SDK during transport.handleRequest) can read the resolved
      // acting-as admin via getCurrentActingAdmin().
      await runWithContext({ actingAdmin, isSystemFallback }, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
      // transport 把 status 写进 res；handler 走到这里说明协议层没抛，按 res.statusCode 判断结果
      const ok = res.statusCode < 400;
      logOnce(ok, ok ? null : mapStatusToCode(res.statusCode));
    } catch (err) {
      console.error('[mcp] POST /mcp handler error:', err);
      const code = 'INTERNAL';
      logOnce(false, code, err.message);
      if (!res.headersSent) {
        // 统一错误信封：{ok, code, message}，HTTP 500
        res.status(500).json({
          ok: false,
          code,
          message: err.message || 'Internal server error',
        });
      }
    }
  });

  // GET/DELETE 在 stateless 模式下无意义 —— 明确返回 405，统一 {ok, code, message} 信封
  const methodNotAllowed = (_req, res) => {
    res.status(405).json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Only POST is supported on /mcp (stateless mode)',
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  // ── POST /internal/upload-audio ──────────────────────────────────────
  // Internal endpoint for nanobot WhatsApp channel to upload inbound audio
  // into CRM File storage + trigger auto-transcription. Auth: Bearer token
  // (same MCP_SERVICE_TOKEN) + X-Acting-As for admin identity.
  // Reuses fileController/upload.js logic (dedup, disk write, auto-Job).
  const multer = require('multer');
  const crypto = require('crypto');
  const fs = require('fs').promises;
  const path = require('path');
  const { v4: uuidv4 } = require('uuid');
  const { UPLOADS_DIR, resolveUploadPath } = require('@/utils/uploadsPath');
  const mongoose = require('mongoose');
  const runTranscription = require('@/jobs/transcriptionWorker');

  const internalMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB for audio
  }).single('file');

  app.post(
    '/internal/upload-audio',
    requireAuth,
    (req, res, next) => {
      // Resolve acting admin from X-Acting-As header
      const actingAs = req.headers['x-acting-as'];
      if (!actingAs) {
        return res.status(400).json({ ok: false, code: 'VALIDATION', message: 'X-Acting-As header required' });
      }
      const Admin = mongoose.model('Admin');
      Admin.findById(actingAs)
        .then((admin) => {
          if (!admin) {
            return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `Admin ${actingAs} not found` });
          }
          req.admin = admin;
          next();
        })
        .catch(next);
    },
    (req, res, next) => {
      internalMulter(req, res, (err) => {
        if (err) return res.status(400).json({ ok: false, code: 'VALIDATION', message: err.message });
        next();
      });
    },
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ ok: false, code: 'VALIDATION', message: 'Missing file field' });
        }

        const FileModel = mongoose.model('File');
        const JobModel = mongoose.model('Job');

        // Dedup by content hash per admin
        const contentHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const existing = await FileModel.findOne({ createdBy: req.admin._id, contentHash, removed: false });
        if (existing) {
          return res.status(200).json({
            ok: true,
            fileId: existing._id,
            originalName: existing.originalName,
            transcriptionJobId: existing.transcriptionJobId,
            deduped: true,
          });
        }

        // Write to disk
        const adminId = req.admin._id.toString();
        const now = new Date();
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const ext = path.extname(req.file.originalname || '.ogg').toLowerCase().slice(0, 9) || '.ogg';
        const uniqueName = `${uuidv4()}${ext}`;
        const relativeSourcePath = path.join(adminId, yyyy, mm, uniqueName);
        const absoluteSourcePath = resolveUploadPath(relativeSourcePath);
        await fs.mkdir(path.dirname(absoluteSourcePath), { recursive: true });
        await fs.writeFile(absoluteSourcePath, req.file.buffer);

        // Create File doc
        const fileDoc = await FileModel.create({
          createdBy: req.admin._id,
          originalName: req.file.originalname || `whatsapp_audio_${Date.now()}${ext}`,
          mimeType: req.file.mimetype || 'audio/ogg',
          sizeBytes: req.file.size,
          sourcePath: relativeSourcePath,
          contentHash,
        });

        // Auto-trigger transcription for audio files
        let transcriptionJobId = null;
        const mime = req.file.mimetype || 'audio/ogg';
        if (mime.startsWith('audio/') || mime.startsWith('video/')) {
          const job = await JobModel.create({
            createdBy: req.admin._id,
            type: 'transcription',
            refModel: 'File',
            refId: fileDoc._id,
          });
          await FileModel.findByIdAndUpdate(fileDoc._id, { transcriptionJobId: job._id });
          transcriptionJobId = job._id;
          runTranscription(fileDoc, job).catch((err) => {
            console.error(`[internal/upload-audio] transcription worker failed for File ${fileDoc._id}:`, err.message);
          });
        }

        console.log(`[internal/upload-audio] ${fileDoc._id} uploaded for admin ${adminId} (${req.file.size} bytes)`);
        return res.status(200).json({
          ok: true,
          fileId: fileDoc._id,
          originalName: fileDoc.originalName,
          sizeBytes: fileDoc.sizeBytes,
          mimeType: fileDoc.mimeType,
          transcriptionJobId,
          deduped: false,
        });
      } catch (err) {
        console.error('[internal/upload-audio] error:', err);
        return res.status(500).json({ ok: false, code: 'INTERNAL', message: err.message });
      }
    }
  );

  // 全局 Express error handler —— 兜底任何未捕获的同步/异步异常
  // 必须放在所有路由之后，签名 4 个参数 Express 才识别为 error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[mcp] unhandled express error:', err);
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      code: 'INTERNAL',
      message: err && err.message ? err.message : 'Internal server error',
    });
  });

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`[mcp] listening on http://${HOST}:${PORT}/mcp`);
    console.log(`[mcp] mode: stateless per-request, auth: bearer, audit: on, tools: ${TOOL_COUNT}`);
    if (!IS_LOOPBACK) {
      console.log(
        `[mcp] ⚠ bind address "${HOST}" is non-loopback — network exposure depends on host firewall / ACL. ` +
          'Service token auth is mandatory and enforced; ensure MCP_SERVICE_TOKEN is strong and network is restricted (Tailscale ACL / security group).'
      );
    }
  });

  // 优雅关闭，方便 nodemon / Ctrl+C 不留僵尸进程
  const shutdown = (signal) => {
    console.log(`[mcp] received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[mcp] fatal during boot:', err);
  process.exit(1);
});
