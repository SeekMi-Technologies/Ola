---
description: Handle an audio recording or voice message the salesperson sent — get the transcript, then act on it (a quick command, a quote, or coaching). Applies when the message has an audio file attachment, a voice note, or asks about a recording.
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
