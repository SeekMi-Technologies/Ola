// @vitest-environment jsdom
//
// ChatInput — Upload-on-Send architecture (Issue #387 patch 2)
//
// Guards the core invariant: attaching a file must NOT trigger any network
// request. Upload + transcription happen only after the user clicks Send
// (delegated to AskOla.handleSend).

import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/locale/useLanguage', () => ({
  default: () => (key) => key,
}));

// Replace antd Input.TextArea with a plain React textarea.
// This isolates ChatInput's own logic from antd's internal event handling
// (rc-textarea keeps its own value cache that defeats fireEvent in jsdom).
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  const React = await import('react');
  return {
    ...actual,
    Input: {
      ...actual.Input,
      TextArea: React.forwardRef(
        ({ value, onChange, onKeyDown, disabled, placeholder, className }, ref) =>
          React.createElement('textarea', {
            ref,
            value,
            onChange,
            onKeyDown,
            disabled,
            placeholder,
            className,
          }),
      ),
    },
  };
});

import ChatInput from '../ChatInput';

const makeFile = (name = 'call.mp3', type = 'audio/mpeg') =>
  new File(['audio-data'], name, { type });

const renderInput = (props = {}) =>
  render(<ChatInput onSend={vi.fn()} {...props} />);

const pickFile = (file) => {
  const fileInput = document.querySelector('input[type="file"]');
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fireEvent.change(fileInput);
};

// With antd mocked to a plain <textarea>, fireEvent.change correctly updates
// React controlled state via the standard onChange pathway.
const typeIntoTextarea = (value) =>
  fireEvent.change(document.querySelector('textarea'), { target: { value } });

const getSendBtn = () => document.querySelector('.askola-chat-send-btn');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Core invariant ─────────────────────────────────────────────────────────

describe('ChatInput — file attach makes zero network requests', () => {
  test('picking a file does NOT call fetch', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    renderInput();
    pickFile(makeFile());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('chip appears with filename after pick', () => {
    renderInput();
    pickFile(makeFile('sales-call.mp3'));
    expect(screen.getByText('sales-call.mp3')).toBeTruthy();
  });

  test('chip shows size in MB', () => {
    renderInput();
    const file = makeFile();
    pickFile(file);
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    expect(screen.getByText(`${sizeMb} MB`)).toBeTruthy();
  });
});

// ── onSend payload ─────────────────────────────────────────────────────────

describe('ChatInput — onSend payload shape', () => {
  test('file-only send: onSend({ text: "", file })', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    const file = makeFile();
    pickFile(file);
    fireEvent.click(getSendBtn());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith({ text: '', file });
  });

  test('text-only send: onSend({ text: "hello", file: null })', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    typeIntoTextarea('hello');
    fireEvent.click(getSendBtn());
    expect(onSend).toHaveBeenCalledWith({ text: 'hello', file: null });
  });

  test('text + file send: onSend receives both', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    const file = makeFile();
    pickFile(file);
    typeIntoTextarea('analyze it');
    fireEvent.click(getSendBtn());
    expect(onSend).toHaveBeenCalledWith({ text: 'analyze it', file });
  });

  test('whitespace-only text is trimmed; sends empty string', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    const file = makeFile();
    pickFile(file);
    typeIntoTextarea('   ');
    fireEvent.click(getSendBtn());
    expect(onSend).toHaveBeenCalledWith({ text: '', file });
  });
});

// ── sendDisabled guard ─────────────────────────────────────────────────────

describe('ChatInput — send gate', () => {
  test('no text + no file: send is blocked', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    fireEvent.click(getSendBtn());
    expect(onSend).not.toHaveBeenCalled();
  });

  test('no text + no file: send button is disabled', () => {
    renderInput();
    expect(getSendBtn().disabled).toBe(true);
  });

  test('file attached + no text: send button is enabled', () => {
    renderInput();
    pickFile(makeFile());
    expect(getSendBtn().disabled).toBe(false);
  });

  test('disabled=true blocks send even with text', () => {
    const onSend = vi.fn();
    renderInput({ onSend, disabled: true });
    typeIntoTextarea('hello');
    fireEvent.click(getSendBtn());
    expect(onSend).not.toHaveBeenCalled();
  });

  test('Shift+Enter does NOT send', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    typeIntoTextarea('hello');
    fireEvent.keyDown(document.querySelector('textarea'), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ── State reset after send ─────────────────────────────────────────────────

describe('ChatInput — state clears after send', () => {
  test('file chip disappears after send', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    pickFile(makeFile('call.mp3'));
    fireEvent.click(getSendBtn());
    expect(screen.queryByText('call.mp3')).toBeNull();
  });

  test('textarea value cleared after send', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    const ta = document.querySelector('textarea');
    typeIntoTextarea('hello');
    fireEvent.click(getSendBtn());
    expect(ta.value).toBe('');
  });
});

// ── Remove button ──────────────────────────────────────────────────────────

describe('ChatInput — remove file button', () => {
  test('clicking X hides the chip', () => {
    renderInput();
    pickFile(makeFile('call.mp3'));
    fireEvent.click(screen.getByLabelText('Remove file'));
    expect(screen.queryByText('call.mp3')).toBeNull();
  });

  test('after removing, send with no text is blocked again', () => {
    const onSend = vi.fn();
    renderInput({ onSend });
    pickFile(makeFile());
    fireEvent.click(screen.getByLabelText('Remove file'));
    fireEvent.click(getSendBtn());
    expect(onSend).not.toHaveBeenCalled();
  });

  test('picking a second file replaces the first', () => {
    renderInput();
    pickFile(makeFile('first.mp3'));
    expect(screen.getByText('first.mp3')).toBeTruthy();
    pickFile(makeFile('second.mp3'));
    expect(screen.queryByText('first.mp3')).toBeNull();
    expect(screen.getByText('second.mp3')).toBeTruthy();
  });
});
