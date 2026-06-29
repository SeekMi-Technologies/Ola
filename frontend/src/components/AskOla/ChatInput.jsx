import { useState, useRef, useEffect } from 'react';
import { Input } from 'antd';
import {
  PlusOutlined,
  AudioOutlined,
  ArrowUpOutlined,
  PaperClipOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import useLanguage from '@/locale/useLanguage';

/**
 * Chat input bar. File upload and transcription happen in AskOla.handleSend
 * after the user clicks Send — not at attach time.
 *
 * onSend({ text: string, file: File | null })
 *   Called when the user submits. `file` is the raw File object (not yet
 *   uploaded); AskOla is responsible for upload + transcription + chat.
 */
export default function ChatInput({ onSend, disabled = false }) {
  const translate = useLanguage();
  const [inputValue, setInputValue] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // File | null
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (
        plusMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setPlusMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [plusMenuOpen]);

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingFile(file);
    setPlusMenuOpen(false);
  };

  const sendDisabled = disabled || (!inputValue.trim() && !pendingFile);

  const handleSend = () => {
    if (sendDisabled) return;
    onSend({ text: inputValue.trim(), file: pendingFile });
    setInputValue('');
    setPendingFile(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const plusMenuItems = [
    {
      icon: <PaperClipOutlined />,
      label: translate('Upload photos & files'),
      onClick: () => fileInputRef.current?.click(),
    },
  ];

  return (
    <div className="askola-chat-input-bar">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      />
      {pendingFile && (
        <div className="askola-pending-file-chip">
          <PaperClipOutlined className="askola-pending-file-icon" />
          <span className="askola-pending-file-name">{pendingFile.name}</span>
          <span className="askola-pending-file-status">
            {(pendingFile.size / 1024 / 1024).toFixed(1)} MB
          </span>
          <button
            type="button"
            className="askola-pending-file-remove"
            onClick={() => setPendingFile(null)}
            aria-label={translate('Remove file')}
          >
            <CloseOutlined />
          </button>
        </div>
      )}
      <Input.TextArea
        className="askola-chat-input"
        placeholder={translate('Ask anything')}
        autoSize={{ minRows: 1, maxRows: 5 }}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <div className="askola-chat-input-footer">
        <div className="askola-plus-container">
          <button
            ref={btnRef}
            className="askola-chat-plus-btn"
            onClick={() => setPlusMenuOpen(!plusMenuOpen)}
          >
            <PlusOutlined />
          </button>
          {plusMenuOpen && (
            <div ref={menuRef} className="askola-plus-menu">
              {plusMenuItems.map((item, i) => (
                <button
                  key={i}
                  className="askola-plus-menu-item"
                  onClick={item.onClick}
                  type="button"
                >
                  <span className="askola-plus-menu-icon">{item.icon}</span>
                  <span className="askola-plus-menu-label">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="askola-chat-footer-right">
          <button
            type="button"
            className="askola-chat-mic-btn"
            disabled
            title={translate('Coming soon')}
            aria-label={translate('Voice input (coming soon)')}
          >
            <AudioOutlined />
          </button>
          <button
            className="askola-chat-send-btn"
            onClick={handleSend}
            disabled={sendDisabled}
          >
            <ArrowUpOutlined />
          </button>
        </div>
      </div>
    </div>
  );
}
