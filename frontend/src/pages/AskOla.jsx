import { useState, useRef, useEffect, useCallback } from 'react';
import { notification } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import request from '@/request/request';
import { useAppContext } from '@/context/appContext';
import useLanguage from '@/locale/useLanguage';
import MessageBubble from '@/components/AskOla/MessageBubble';
import ChatInput from '@/components/AskOla/ChatInput';
import ThinkingPanel from '@/components/AskOla/ThinkingPanel';
import TextBlock from '@/components/AskOla/blocks/TextBlock';
import { consumeSSEStream } from '@/components/AskOla/consumeSSEStream';

export default function AskOla() {
  const translate = useLanguage();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  // Live streaming UI state — replaces hardcoded "Ola is thinking..." placeholder.
  // liveLabel: current friendly thinking-step label, or null when text is streaming
  //            or the panel should not render. Cleared on stream end.
  // streamingText: assistant reply accumulated token-by-token while the SSE stream
  //                is in flight; replaced by the final blocks-based MessageBubble
  //                when the `done` frame arrives.
  const [liveLabel, setLiveLabel] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const bottomRef = useRef(null);
  // Tracks the in-flight /api/ola/chat fetch so a New Chat click or a fresh
  // send can cancel a stale stream — otherwise the still-streaming `done`
  // frame would silently re-open the previous session (PR #171 review bug).
  const abortRef = useRef(null);
  // When handleSend completes a fresh new-chat turn it calls setActive(newId),
  // which would otherwise re-fire the load-messages effect and clobber the
  // locally-rendered [user, assistant] pair with a server fetch that returns
  // the same content under different ids — React then remounts every bubble
  // (key change) and the user sees their own message "swallowed" for a frame.
  const skipNextLoadRef = useRef(false);
  const { state: stateApp, appContextAction } = useAppContext();
  const { activeSessionId } = stateApp;
  const { chatSession } = appContextAction;

  // Auto-scroll to bottom on new messages or while streaming chunks arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveLabel, streamingText]);

  // Load messages when activeSessionId changes
  const loadMessages = useCallback(async (sessionId) => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    try {
      const response = await request.get({ entity: `ola/session/messages/${sessionId}` });
      if (response.success) {
        const loaded = response.result.map((msg) => ({
          id: msg._id,
          role: msg.role,
          timestamp: msg.created,
          blocks: msg.blocks || [{ type: 'text', content: msg.content }],
        }));
        setMessages(loaded);
      } else {
        notification.error({
          message: translate('Cannot load history messages'),
          description: response.message || translate('Failed to load session messages, please refresh'),
        });
      }
    } catch (err) {
      notification.error({
        message: translate('Cannot load history messages'),
        description: err.message || translate('Network error'),
      });
    }
  }, [translate]);

  useEffect(() => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  // Refresh session list — no deps on chatSession to avoid infinite re-render
  const refreshSessionList = async () => {
    try {
      const response = await request.get({ entity: 'ola/session/list' });
      if (response.success) {
        chatSession.setList(response.result);
      } else {
        notification.error({
          message: translate('Cannot refresh session list'),
          description: response.message || translate('Please refresh the page'),
        });
      }
    } catch (err) {
      notification.error({
        message: translate('Cannot refresh session list'),
        description: err.message || translate('Network error'),
      });
    }
  };

  const handleNewChat = () => {
    // Cancel any in-flight stream so its `done` frame can't quietly re-open
    // the old session right after the user clicked into a fresh chat.
    abortRef.current?.abort();
    chatSession.setActive(null);
    setMessages([]);
  };

  // Fired by ChatInput when an attached file finishes transcription
  // (or hits dedup — already-transcribed). Drops a system message into the
  // chat panel so the user sees confirmation before sending their question.
  const handleTranscriptionComplete = ({ fileId, originalName, durationMs, sidecarBytes, deduped }) => {
    const seconds = durationMs ? Math.round(durationMs / 1000) : null;
    const sizeKb = sidecarBytes ? (sidecarBytes / 1024).toFixed(1) : null;
    const detail = [
      seconds !== null ? `${seconds}s` : null,
      sizeKb !== null ? `${sizeKb}KB transcript` : null,
    ].filter(Boolean).join(' · ');
    const text = deduped
      ? translate('Recording "{name}" already transcribed (reused from earlier upload). You can ask me about it now.')
          .replace('{name}', originalName)
      : translate('Recording "{name}" transcription complete{detail}. You can ask me about it now.')
          .replace('{name}', originalName)
          .replace('{detail}', detail ? ` (${detail})` : '');
    setMessages((prev) => [
      ...prev,
      {
        id: `msg_system_${fileId}_${Date.now()}`,
        role: 'system',
        timestamp: new Date().toISOString(),
        blocks: [{ type: 'text', content: text }],
      },
    ]);
  };

  const handleSend = async (messageContent) => {
    const text = messageContent.text;
    const fileIds = Array.isArray(messageContent.attachments) ? messageContent.attachments : [];

    // Cancel any previous in-flight stream defensively (e.g. user spam-clicks
    // send before the previous turn finishes).
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const userMessage = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      timestamp: new Date().toISOString(),
      blocks: [{ type: 'text', content: text }],
    };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setLiveLabel(translate('Ola is thinking...'));  // STAGE_LABELS.__init__ (kept in sync with backend)
    setStreamingText('');

    try {
      const body = { message: text };
      if (activeSessionId) body.sessionId = activeSessionId;
      if (fileIds.length > 0) body.fileIds = fileIds;

      // EventSource doesn't support POST bodies, so we use fetch + manual SSE
      // parsing. Same approach the OpenAI / Anthropic / Google JS SDKs use.
      const resp = await fetch('/api/ola/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!resp.ok) {
        // Non-SSE failure (validation 400, auth 401, session-not-found 404).
        // Backend returned a JSON error envelope.
        let errMsg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          if (j && j.message) errMsg = j.message;
        } catch { /* keep default */ }
        notification.error({ message: translate('Ola response failed'), description: errMsg });
        return;
      }

      let finalSessionId = null;
      let finalBlocks = null;
      let errored = false;

      await consumeSSEStream(resp, {
        thinking_step: (data) => {
          if (data && data.label) setLiveLabel(data.label);
        },
        text_token: (data) => {
          if (!data || typeof data.delta !== 'string') return;
          // Once text starts streaming, hide the live thinking panel — the
          // streaming text bubble takes over visually.
          setLiveLabel(null);
          setStreamingText((prev) => prev + data.delta);
        },
        done: (data) => {
          if (!data) return;
          finalSessionId = data.sessionId || null;
          finalBlocks = Array.isArray(data.blocks) ? data.blocks : null;
        },
        error: (data) => {
          errored = true;
          notification.error({
            message: translate('Ola response failed'),
            description: (data && data.message) || translate('Unknown error'),
          });
        },
      }, ac.signal);

      // If the user cancelled (New Chat / fresh send) while we were streaming,
      // don't commit a stale assistant message back into state — that would
      // visibly snap the user away from their fresh chat.
      if (ac.signal.aborted) return;

      // Commit final assistant message from `done` payload (which has
      // thinking_trace + text + widget blocks already assembled by the backend).
      if (!errored && finalBlocks) {
        const assistantMessage = {
          id: `msg_assistant_${Date.now()}`,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          blocks: finalBlocks,
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (!activeSessionId && finalSessionId) {
          // Mark the upcoming activeSessionId-change effect as a no-op — the
          // local messages array is already authoritative for this turn.
          skipNextLoadRef.current = true;
          chatSession.setActive(finalSessionId);
        }
        refreshSessionList();
      }
    } catch (err) {
      // AbortError on cancel is expected; suppress the user-facing toast.
      if (err.name === 'AbortError' || ac.signal.aborted) return;
      notification.error({
        message: translate('Cannot connect to Ola'),
        description: err.message || translate('Please verify backend and NanoBot are running'),
      });
    } finally {
      // Only clear if this is still the active stream — a newer handleSend may
      // have already replaced abortRef.current and set fresh loading state.
      if (abortRef.current === ac) {
        abortRef.current = null;
        setLoading(false);
        setLiveLabel(null);
        setStreamingText('');
      }
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className={`askola-chat-page ${isEmpty ? 'askola-chat-page--empty' : 'askola-chat-page--active'}`}>
      {isEmpty ? (
        <div className="askola-chat-welcome">
          <div className="askola-chat-center">
            <h1 className="askola-chat-greeting">{translate('What can I do for you?')}</h1>
          </div>
          <div className="askola-chat-input-wrapper">
            <ChatInput
              onSend={handleSend}
              onTranscriptionComplete={handleTranscriptionComplete}
              disabled={loading}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="askola-chat-messages">
            <div className="askola-chat-messages-inner">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {loading && (liveLabel || streamingText) && (
                <div className="askola-message askola-message--assistant">
                  <div className="askola-message-blocks">
                    {liveLabel && (
                      <ThinkingPanel mode="live" currentLabel={liveLabel} />
                    )}
                    {streamingText && <TextBlock content={streamingText} />}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="askola-chat-input-wrapper">
            <ChatInput
              onSend={handleSend}
              onTranscriptionComplete={handleTranscriptionComplete}
              disabled={loading}
            />
          </div>
        </>
      )}

      {/* New Chat button — always visible */}
      <button className="askola-new-chat-btn" onClick={handleNewChat} title={translate('New Chat')}>
        <PlusOutlined />
      </button>
    </div>
  );
}
