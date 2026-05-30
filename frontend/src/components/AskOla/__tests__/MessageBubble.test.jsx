// @vitest-environment jsdom
//
// Tests for MessageBubble — specifically the thinking_trace block branch
// added for Issue #131 / backlog L6. The other block types are exercised
// indirectly through usage; this file focuses on the new wiring.

import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

// ThinkingPanel (transitively rendered by MessageBubble) now uses
// useLanguage. Mock it so these tests don't require a Redux Provider.
vi.mock('@/locale/useLanguage', () => ({
  default: () => (key) => key,
}));

import MessageBubble from '../MessageBubble';

afterEach(cleanup);

const sampleThinkingTrace = {
  type: 'thinking_trace',
  steps: [
    { label: 'Ola is thinking...', ts: 1 },
    { label: 'Searching products...', ts: 2 },
  ],
};

describe('MessageBubble — thinking_trace block', () => {
  test('renders a collapsed ThinkingPanel when assistant message has thinking_trace', () => {
    const message = {
      role: 'assistant',
      blocks: [sampleThinkingTrace, { type: 'text', content: 'Done' }],
    };
    const { getByRole, getByText } = render(<MessageBubble message={message} />);
    // Toggle button is rendered (the ▶ View thinking process control).
    const toggle = getByRole('button');
    expect(toggle.textContent).toMatch(/View thinking process/);
    // Default is folded — no step labels visible yet.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The text block also rendered alongside.
    expect(getByText('Done')).toBeTruthy();
  });

  test('clicking the toggle expands the trace and shows steps', () => {
    const message = {
      role: 'assistant',
      blocks: [sampleThinkingTrace],
    };
    const { getByRole, getByText } = render(<MessageBubble message={message} />);
    fireEvent.click(getByRole('button'));
    expect(getByText('Ola is thinking...')).toBeTruthy();
    expect(getByText('Searching products...')).toBeTruthy();
  });

  test('thinking_trace with empty steps[] renders nothing for that block', () => {
    const message = {
      role: 'assistant',
      blocks: [
        { type: 'thinking_trace', steps: [] },
        { type: 'text', content: 'Hi' },
      ],
    };
    const { queryByRole, getByText } = render(<MessageBubble message={message} />);
    // ThinkingPanel renders null when steps empty → no toggle button.
    expect(queryByRole('button')).toBeNull();
    // Text block still renders.
    expect(getByText('Hi')).toBeTruthy();
  });

  test('unknown block type still renders the placeholder fallback', () => {
    const message = {
      role: 'assistant',
      blocks: [{ type: 'made_up_block', payload: {} }],
    };
    const { getByText } = render(<MessageBubble message={message} />);
    expect(getByText(/不支持的内容类型/)).toBeTruthy();
  });
});
