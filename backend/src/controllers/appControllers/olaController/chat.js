const http = require('http');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { toolEventsToBlocks } = require('./toolResultToBlocks');
const { labelFor, STAGE_LABELS } = require('./thinkingLabels');
const recordUsage = require('@/controllers/appControllers/llmUsageController/recordUsage');
const { collapseJobStatus } = require('@/utils/collapseJobStatus');

const ChatSession = mongoose.model('ChatSession');
const ChatMessage = mongoose.model('ChatMessage');
const FileModel = mongoose.model('File');
const JobModel = mongoose.model('Job');

// 900s default accommodates agent loops with multiple MCP tool calls.
const NANOBOT_TIMEOUT_MS =
  parseInt(process.env.NANOBOT_TIMEOUT_MS, 10) || 900000;
function nanobotEndpoint() {
  return {
    host: process.env.NANOBOT_HOST || '127.0.0.1',
    port: parseInt(process.env.NANOBOT_PORT, 10) || 8900,
  };
}

// ---------------------------------------------------------------------------
// SSE writer helpers — output frames to the client (browser-facing protocol).
// Schema documented in ola/plans/ thinking_panel plan §4.1.
// ---------------------------------------------------------------------------

function writeSSE(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// SSE parser — incremental decoder for NanoBot's upstream SSE stream.
// NanoBot sends two kinds of frames:
//   1. Default event (no `event:` line): OpenAI chat.completion.chunk JSON
//      → for us, only the choices[0].delta.content matters
//   2. Named `event: tool_event`: our L1 addition, JSON tool_event payload
// And the literal terminator `data: [DONE]`.
// ---------------------------------------------------------------------------

function makeSSEParser(onFrame) {
  let buffer = '';
  return {
    feed(chunkStr) {
      buffer += chunkStr;
      // SSE frames are separated by blank lines (\n\n).
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!rawFrame.trim()) continue;
        let eventName = 'message';
        const dataLines = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim());
          }
        }
        const dataStr = dataLines.join('\n');
        onFrame(eventName, dataStr);
      }
    },
    flush() {
      if (buffer.trim()) {
        // Drop trailing partial frame — NanoBot always ends with [DONE]\n\n.
        buffer = '';
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-title — non-streaming /v1/chat/completions call. Token spend is tracked
// under channel='ask-ola-autotitle' so the dashboard can split user-facing
// chat cost from incidental LLM costs (Ola CRM #98 C5).
// ---------------------------------------------------------------------------

function generateTitle(session, messages, userId) {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const prompt = `Based on this conversation, generate a short title (max 6 words, no quotes, no punctuation at the end). Reply with ONLY the title, nothing else.\n\n${conversation}`;
  // Scope the autoTitle request to its own session_id so the conversation
  // text embedded in `prompt` doesn't leak into the global api_default.jsonl
  // (multi-tenant isolation; pre-Plan-B-v3 bug — fixed phase C).
  const payload = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    session_id: `${session.nanobotSessionId}:autotitle`,
  });
  const { host, port } = nanobotEndpoint();
  const options = {
    hostname: host,
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      // Mirrors main chat path (#185). Without this nanobot routes the autotitle
      // subagent's jsonl to admins/_system/sessions/ — leaking conversation text
      // (which is embedded in the prompt) across the multi-tenant boundary.
      'X-Ola-Acting-As': userId.toString(),
    },
    timeout: 30000,
  };
  const titleStartTs = Date.now();
  const titleRequestId = uuidv4();
  const titleReq = http.request(options, (titleRes) => {
    let data = '';
    titleRes.on('data', (chunk) => { data += chunk; });
    titleRes.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        console.error(`[AutoTitle] Failed to parse title response for session ${session._id}:`, err.message);
        return;
      }
      const title = parsed?.choices?.[0]?.message?.content?.trim();
      if (title && title.length > 0 && title.length <= 100) {
        ChatSession.findByIdAndUpdate(session._id, { title, updated: Date.now() }).catch((err) => {
          console.error(`[AutoTitle] Failed to update session ${session._id}:`, err.message);
        });
      }
      // Record auto-title token spend under its own channel so the dashboard
      // can split it from user-visible chat cost. Fire-and-forget; recordUsage
      // is fail-silent. Only fires when nanobot supplied a real usage payload
      // with provider/model — if the response was malformed or pre-N4 nanobot
      // (no real usage), recordUsage's wire-contract check skips silently.
      if (userId && parsed && typeof parsed.usage === 'object') {
        recordUsage({
          userId,
          session,
          messageId: null,
          usage: parsed.usage,
          latencyMs: Date.now() - titleStartTs,
          requestId: titleRequestId,
          channel: 'ask-ola-autotitle',
        });
      }
    });
  });
  titleReq.on('error', (err) => {
    console.error(`[AutoTitle] Request failed for session ${session._id}:`, err.message);
  });
  titleReq.write(payload);
  titleReq.end();
}

// ---------------------------------------------------------------------------
// fileIds validation + hint construction
// ---------------------------------------------------------------------------
// Validates each fileId belongs to the acting admin and is not removed, then
// collapses Job.status to the agent-facing vocabulary (ready/processing/done/
// failed) via collapseJobStatus. Returns either {ok:true, fileRefs} (array of
// `id=X name="Y" status="Z"` strings to splice into the user hint), or
// {ok:false, status, message} for the controller to short-circuit on.
// ---------------------------------------------------------------------------

async function validateAndCollapseFileRefs(fileIds, userId) {
  const fileRefs = [];
  for (const fid of fileIds) {
    if (typeof fid !== 'string' || !mongoose.isValidObjectId(fid)) {
      return { ok: false, status: 404, message: '文件不存在或无权访问' };
    }
    const file = await FileModel.findOne({
      _id: fid,
      createdBy: userId,
      removed: false,
    });
    if (!file) {
      return { ok: false, status: 404, message: '文件不存在或无权访问' };
    }
    let job = null;
    if (file.transcriptionJobId) {
      job = await JobModel.findById(file.transcriptionJobId).select('status').lean();
    }
    const status = collapseJobStatus(job);
    fileRefs.push(`id=${file._id} name="${file.originalName}" status="${status}"`);
  }
  return { ok: true, fileRefs };
}

function maybeAutoTitle(session, userMessage, assistantContent, userId) {
  if (session.title !== 'New Chat') return;
  ChatMessage.countDocuments({ sessionId: session._id, removed: false })
    .then((count) => {
      if (count >= 4) {
        return ChatMessage.find({ sessionId: session._id, removed: false })
          .sort({ created: 1 }).lean()
          .then((msgs) => generateTitle(session, msgs, userId));
      }
    })
    .catch((err) => console.error(`[AutoTitle] count/find failed for session ${session._id}:`, err.message));
}

// ---------------------------------------------------------------------------
// Main handler — POST /api/ola/chat
// Streams Server-Sent Events to the client; pipes from NanoBot upstream and
// translates NanoBot's frames to our user-facing protocol while buffering
// content + thinking trace for persistence to ChatMessage on stream end.
// ---------------------------------------------------------------------------

const chat = async (req, res) => {
  const { message, sessionId, fileIds = [] } = req.body;

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'message 字段为必填项，且不能为空字符串',
    });
  }

  console.log(
    `[askola.chat] admin=${req.admin._id} session=${sessionId || 'new'} msg_len=${message.length} fileIds=${Array.isArray(fileIds) ? fileIds.length : 'INVALID'}`
  );

  if (!Array.isArray(fileIds)) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'fileIds 必须是 string 数组',
    });
  }

  const userId = req.admin._id;
  let session;

  if (sessionId) {
    session = await ChatSession.findOne({ _id: sessionId, userId, removed: false });
    if (!session) {
      return res.status(404).json({
        success: false,
        result: null,
        message: 'Session not found',
      });
    }
  } else {
    const nanobotSessionId = `user:${userId}:conv:${uuidv4()}`;
    session = await ChatSession.create({ userId, nanobotSessionId, createdBy: userId });
  }

  // Plan B v3: chat.js is hint-only — validate ownership, collapse status,
  // emit `[available files: ...]` preface. Transcript fetch + status probe
  // happen via MCP file.* tools (agent-driven, SOUL.md doctrine).
  const fileValidation = await validateAndCollapseFileRefs(fileIds, userId);
  if (!fileValidation.ok) {
    return res.status(fileValidation.status).json({
      success: false,
      result: null,
      message: fileValidation.message,
    });
  }
  const fileRefs = fileValidation.fileRefs;

  // Switch to SSE mode.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // hint to nginx not to buffer
  res.flushHeaders();

  const thinkingSteps = []; // [{label, ts}] — drives thinking_trace block
  const finalToolEvents = []; // phase==='end' payloads → toolEventsToBlocks → widgets
  let streamedText = '';
  let upstreamFinished = false;
  let upstreamErrored = false;
  // Captured usage frame from NanoBot's SSE stream (Ola issue #98). Stays null
  // when running against an older nanobot that doesn't emit `event: usage` —
  // recordUsage() short-circuits on null so the chat path stays functional.
  let capturedUsage = null;
  // Per-request trace ids — used for log correlation + LLMUsage.requestId.
  const requestId = uuidv4();
  const startTs = Date.now();

  // Per-salesperson language directive prepended to user content. SOUL.md
  // teaches the agent to honor [SESSION_LANG=xx] as an overriding system
  // signal and never echo it. NanoBot's API only accepts a single user-role
  // message (api/server.py:128-132), so we cannot use a separate role:'system'
  // message; prepending is the MVP workaround. ChatMessage persistence below
  // (line ~252) intentionally stores the RAW user text without the directive
  // so the chat history UI never displays the marker.
  const sessionLang = req.admin?.language === 'en' ? 'en' : 'zh';
  const availableFilesHint =
    fileRefs.length > 0
      ? [`[available files for tool calls: ${fileRefs.join(', ')}]`]
      : [];
  const directedContent = [
    `[SESSION_LANG=${sessionLang}]`,
    ...availableFilesHint,
    '',
    message.trim(),
  ].join('\n');

  const proxyPayload = JSON.stringify({
    messages: [{ role: 'user', content: directedContent }],
    session_id: session.nanobotSessionId,
    stream: true,
  });

  const { host: nanoHost, port: nanoPort } = nanobotEndpoint();
  const proxyOptions = {
    hostname: nanoHost,
    port: nanoPort,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(proxyPayload),
      'Accept': 'text/event-stream',
      // X-Acting-As scopes MCP business tools to logged-in admin (#185)
      'X-Ola-Acting-As': userId.toString(),
    },
    timeout: NANOBOT_TIMEOUT_MS,
  };

  const handleUpstreamFrame = (eventName, dataStr) => {
    if (eventName === 'tool_event') {
      let payload;
      try { payload = JSON.parse(dataStr); } catch { return; }
      if (payload.phase === 'start') {
        const label = labelFor(payload.name);
        if (label) {
          const step = { label, ts: Date.now() };
          thinkingSteps.push(step);
          writeSSE(res, 'thinking_step', step);
        }
      } else if (payload.phase === 'end' || payload.phase === 'error') {
        finalToolEvents.push(payload);
      }
      return;
    }
    if (eventName === 'usage') {
      // Per-turn token counts from NanoBot (#98). Captured here, written in finishStream so SSE isn't delayed.
      try {
        capturedUsage = JSON.parse(dataStr);
      } catch (e) {
        console.warn('[askola] malformed event:usage frame dropped:', dataStr);
      }
      return;
    }
    // Default event = OpenAI chat.completion.chunk
    if (dataStr === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(dataStr); } catch { return; }
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      streamedText += delta;
      writeSSE(res, 'text_token', { delta });
    }
  };

  const finishStream = () => {
    if (res.writableEnded) return;
    // Build final blocks: thinking_trace prepend → text → widgets from tool_events.
    const blocks = [];
    if (thinkingSteps.length > 0) {
      blocks.push({ type: 'thinking_trace', steps: thinkingSteps });
    }
    if (streamedText.length > 0) {
      blocks.push({ type: 'text', content: streamedText });
    }
    blocks.push(...toolEventsToBlocks(finalToolEvents));

    writeSSE(res, 'done', { sessionId: session._id, blocks });
    res.end();

    // Fire-and-forget persistence. ChatMessage and LLMUsage are independent
    // writes (no shared lock, no upsert on a hot doc) — running them in
    // parallel keeps the post-stream tail short and avoids any write
    // serializing on the other.
    if (streamedText.length > 0 || blocks.length > 0) {
      ChatMessage.insertMany([
        {
          sessionId: session._id,
          role: 'user',
          content: message.trim(),
          blocks: [{ type: 'text', content: message.trim() }],
          createdBy: userId,
        },
        {
          sessionId: session._id,
          role: 'assistant',
          content: streamedText,
          blocks,
          createdBy: userId,
        },
      ])
        .then((docs) => {
          // Plumb the assistant message _id into the LLMUsage row so the
          // dashboard can deep-link cost → original message. Best-effort:
          // if docs[1] is missing for any reason, recordUsage tolerates
          // null messageId.
          const assistantMsgId = docs && docs[1] && docs[1]._id;
          if (capturedUsage) {
            recordUsage({
              userId,
              session,
              messageId: assistantMsgId || null,
              usage: capturedUsage,
              latencyMs: Date.now() - startTs,
              requestId,
              errored: upstreamErrored,
            });
          }
          return maybeAutoTitle(session, message.trim(), streamedText, userId);
        })
        .catch((err) => {
          console.error(
            `[ChatMessage] Persist failed for session ${session._id}:`,
            err.message,
          );
          // ChatMessage persist failed — still record LLMUsage so cost
          // tracking isn't lost. messageId stays null.
          if (capturedUsage) {
            recordUsage({
              userId,
              session,
              messageId: null,
              usage: capturedUsage,
              latencyMs: Date.now() - startTs,
              requestId,
              errored: true,
            });
          }
        });
    } else if (capturedUsage) {
      // No content to persist (rare — empty stream) but we still saw a usage
      // frame, so a real LLM call happened. Track it.
      recordUsage({
        userId,
        session,
        messageId: null,
        usage: capturedUsage,
        latencyMs: Date.now() - startTs,
        requestId,
        errored: upstreamErrored,
      });
    }
  };

  const failStream = (errMessage) => {
    if (res.writableEnded) return;
    upstreamErrored = true;
    writeSSE(res, 'error', { message: errMessage });
    res.end();
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      // NanoBot returned a JSON error envelope (4xx/5xx). Drain and surface.
      let buf = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', (c) => { buf += c; });
      proxyRes.on('end', () => {
        let errMsg = 'NanoBot 返回错误';
        try {
          const parsed = JSON.parse(buf);
          if (parsed?.error?.message) errMsg = parsed.error.message;
        } catch { /* keep default */ }
        failStream(`NanoBot ${proxyRes.statusCode}: ${errMsg}`);
      });
      return;
    }

    proxyRes.setEncoding('utf8');
    const parser = makeSSEParser(handleUpstreamFrame);
    proxyRes.on('data', (chunk) => parser.feed(chunk));
    proxyRes.on('end', () => {
      parser.flush();
      upstreamFinished = true;
      finishStream();
    });
    proxyRes.on('error', (err) => {
      failStream(`NanoBot stream error: ${err.message}`);
    });
  });

  proxyReq.on('error', (err) => {
    failStream(`无法连接 NanoBot 服务 (${nanoHost}:${nanoPort}): ${err.message}`);
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    failStream(`NanoBot 请求超时 (${NANOBOT_TIMEOUT_MS / 1000}s)`);
  });

  // Client disconnect — abort upstream so we don't keep doing work for nobody.
  req.on('close', () => {
    if (!upstreamFinished && !upstreamErrored) {
      proxyReq.destroy();
    }
  });

  proxyReq.write(proxyPayload);
  proxyReq.end();
};

module.exports = chat;
// Internal helpers exported for unit testing (Ola CRM #98 C5 — auto-title
// usage tracking). Not part of the public chat controller surface.
module.exports.__test__ = { generateTitle, maybeAutoTitle };
