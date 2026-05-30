import { useState } from 'react';
import { LoadingOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import useLanguage from '@/locale/useLanguage';

/**
 * ThinkingPanel — Ask Ola live progress + post-answer collapsed trace
 * (Issue #131).
 *
 * Two modes (driven by `mode` prop):
 *
 *   mode="live"
 *     Single-line in-place updating indicator. Shows `currentLabel` next to a
 *     spinner. Replaces the hardcoded `Ola is thinking...` while a stream is
 *     active. AskOla.jsx swaps `currentLabel` as new SSE thinking_step frames
 *     arrive.
 *
 *   mode="collapsed" (default)
 *     Used after the answer arrives, and for historical assistant messages
 *     loaded from ChatMessage.blocks (thinking_trace block). Renders as
 *     `▶ View thinking process`; click expands to a sequential numbered list
 *     of the steps Ola took.
 *
 * Step shape (consistent with backend thinking_trace block):
 *   { label: string, ts: number }
 *
 * v1 is English-only; localized labels deferred (see thinkingLabels.js).
 */
export default function ThinkingPanel({
  mode = 'collapsed',
  currentLabel = null,
  steps = [],
}) {
  const translate = useLanguage();
  const [expanded, setExpanded] = useState(false);

  if (mode === 'live') {
    return (
      <div
        className="askola-thinking-panel askola-thinking-panel--live"
        role="status"
        aria-live="polite"
      >
        <LoadingOutlined spin style={{ fontSize: 13, color: '#8c8c8c' }} />
        <span className="askola-thinking-panel-label">
          {currentLabel || translate('Ola is working on it...')}
        </span>
      </div>
    );
  }

  // collapsed mode: nothing to show if no steps were captured.
  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className="askola-thinking-panel askola-thinking-panel--collapsed">
      <button
        type="button"
        className="askola-thinking-panel-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <DownOutlined /> : <RightOutlined />}
        <span className="askola-thinking-panel-toggle-label">
          {' '}{translate('View thinking process')}
        </span>
      </button>
      {expanded && (
        <ol className="askola-thinking-panel-steps">
          {steps.map((step, i) => (
            <li key={i} className="askola-thinking-panel-step">
              {step.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
