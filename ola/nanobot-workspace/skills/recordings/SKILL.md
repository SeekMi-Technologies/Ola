---
description: Handle an audio recording or voice message the salesperson sent — get the transcript, then act on it (a quick command, a quote, or coaching). Also handles comprehensive multi-file analysis when the salesperson asks to evaluate all recordings together. Applies when the message has an audio file attachment, a voice note, or asks about a recording.
always: true
---
# Recordings and voice

The salesperson sends audio two ways. Get the transcript first, then act on intent — don't auto-summarize.

## Getting the transcript

**Uploaded audio file (askola PaperClip).** The message carries a hint like `[available files for tool calls: id=X name="Y" status="..."]`. That hint is the only thing you trust about what's attached — never guess a fileId or name. Act on `status`:

- `processing` → the transcript isn't ready. Don't fetch it (it would just fail). Say plainly that you're transcribing it and it takes about 5 minutes, and ask them to come back when it's done. Don't loop or retry.
- `done` → call `file.get_transcript({ fileId: X })`. The returned `transcript` is authoritative.
- `failed` → tell them the audio couldn't be processed and to re-upload or type it.
- `ready` (non-audio) → no transcript; just respond to whatever they said about the file.

If they mention a recording but there's no hint, try `file.search({ query: "<name fragment>" })`; if `found`, fetch it; if not, say it isn't on file and ask them to upload it.

**Voice note in WhatsApp.** The text is already the transcription (it arrives prefixed `[语音消息转写]` for push-to-talk or `[音频文件转写]` for an audio file). Treat it exactly as if they typed it — no `file.*` calls, no mention of "voice" or "transcription". Ignore any `[CRM文件已上传 fileId=...]` plumbing tag. If it says transcription failed, tell them briefly and ask them to type or retry.

## Then act on what they want — don't auto-summarize

- **A short command or question** ("查一下 A-1473 的价格", "帮我建个客户") → just do it. No summary, no preamble.
- **They want the call analyzed / coached** ("分析这通电话", "销售教练帮我看看", "what went wrong here") → this is a coaching request; follow the sales-analysis approach.
- **The recording is about products / a quote** → drive the Lead-to-Quote flow with what you extracted.
- **A bare upload with no stated intent** → don't dump a summary. Once the transcript is ready, give a one-line note of what it is and ask what they want — analyze it, or pull a quote.

Never state anything from a recording you haven't actually fetched this turn, and never show the internal fileId.

## Comprehensive multi-file analysis

When the salesperson asks to evaluate **multiple recordings together** — keywords like 综合/整体/全部/所有/汇总/横向对比/一起看/一并 paired with 录音/通话/语音 — use this path instead of the single-file flow above. The two paths are mutually exclusive: do not mix them in one turn.

### Path A — Uploaded files (web UI or WhatsApp attachment)

Use this path when the message has a `[available files for tool calls: ...]` hint, or when there is no hint but the salesperson refers to recordings by name or asks about "all recordings" with no voice history in context.

**With hint (≥ 2 files):**
1. Check each file's `status`. Skip any that are `processing` or `failed` (note them at the end).
2. For all `status=done` files: emit every `file.get_transcript` call **in a single LLM iteration** — do not wait for one result before issuing the next. The runner executes them concurrently.
3. Once all transcripts are in hand, produce one holistic report (format below). Do not output anything between the fetch step and the final report.

**Without hint (discover via search):**
1. Call `file.search({ status: "done" })` to discover available transcripts.
2. If `found: false` or count = 0, tell the salesperson there are no completed recordings on file and ask them to upload via the PaperClip menu.
3. If count = 1, fall back to the single-file flow above — this is not a multi-file request.
4. If count ≥ 2, emit all `file.get_transcript` calls in a single iteration (same as the "with hint" path above), then produce the report.

### Path B — WhatsApp voice history (already in context)

Use this path when the salesperson asks to synthesize recordings that have already been transcribed inline in the conversation history (i.e., messages prefixed `[语音消息转写]` or `[音频文件转写]`), and there is no file hint in the current message.

1. Collect all transcribed voice content from conversation history.
2. If only one transcription is found, tell the salesperson there is only one recording in context and ask whether they want the single-file analysis or to upload more.
3. If ≥ 2 transcriptions are found, synthesize directly — **zero `file.*` tool calls**. The content is already in context.

### Report format (both paths)

The report must have exactly these three sections, in this order:

**共同主题** — Themes, patterns, or topics that appear consistently across the recordings (products discussed, customer concerns, negotiation tone, etc.).

**关键差异** — Significant differences between recordings (different clients, different price sensitivities, different outcomes, etc.).

**综合结论** — An overall synthesis: what do these recordings collectively tell the salesperson? End with "需要我做什么？" / "What would you like me to do?"

If some files were skipped (processing / failed), append a brief note after the three sections naming the skipped files and their status.

### Hard rules

- **No per-file progress commentary.** Do not output "正在分析录音 1…" or anything between the transcript-fetch phase and the final report.
- **No duplicate tool calls.** Never call `file.get_transcript` twice for the same `fileId` in one turn.
- **No invented content.** Every claim in the report must be traceable to a transcript actually fetched this turn or present in history. If a point is uncertain, omit it.
- **No mixing paths.** If Path B applies (voice history in context, no hint), do not call `file.*` tools. If Path A applies (hint present or discovery needed), do not synthesize from history alone.
