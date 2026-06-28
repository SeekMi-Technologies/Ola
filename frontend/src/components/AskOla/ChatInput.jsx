import { useState, useRef, useEffect } from 'react';
import { Input } from 'antd';
import {
  PlusOutlined,
  AudioOutlined,
  ArrowUpOutlined,
  PaperClipOutlined,
  CloseOutlined,
  LoadingOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import useLanguage from '@/locale/useLanguage';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_DURATION_MS = 10 * 60 * 1000;

/**
 * Independent chat input component with audio upload + transcription chip
 * (Plan B v3 phase E).
 *
 * @param {function} onSend
 *   Callback: onSend({ text, mentions, attachments }).
 *   `attachments` is an array of File._id strings (only emitted when chip
 *   is in `state: 'ready'`).
 * @param {function} [onTranscriptionComplete]
 *   Optional callback fired when an attached file finishes transcription.
 *   Receives { fileId, originalName, durationMs, deduped } — host page (AskOla)
 *   uses this to drop a system notification into the chat panel.
 * @param {boolean} [disabled]
 *   Disable input and send button while waiting for response.
 *
 * pendingFile state machine:
 *   null
 *     → 'uploading'   POST /api/file/create in flight
 *         → 'ready'    (deduped:true — reused existing transcription)
 *         → 'transcribing'  (deduped:false — worker spawned, polling /api/job/read/:id)
 *             → 'ready'    Job.status === 'done'
 *             → 'failed'   Job.status === 'failed'
 *         → 'failed'   upload HTTP error or rejected mime/size
 */
export default function ChatInput({ onSend, onTranscriptionComplete, disabled = false }) {
  const translate = useLanguage();
  const [inputValue, setInputValue] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [transcriptPreview, setTranscriptPreview] = useState(null);
  // { fileId, text, expanded:bool, loading:bool, error:string }
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const fileInputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const completedFileIdsRef = useRef(new Set());

  // ---- Polling ---------------------------------------------------------

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const startPolling = (transcriptionJobId, fileMeta) => {
    stopPolling();
    const pollStartTs = Date.now();
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - pollStartTs > POLL_MAX_DURATION_MS) {
        stopPolling();
        setPendingFile((prev) =>
          prev && prev._id === fileMeta._id
            ? {
                ...prev,
                state: 'failed',
                jobStatus: 'failed',
                error: 'Transcription timed out (over 10 min). Try uploading a shorter recording.',
              }
            : prev
        );
        return;
      }
      try {
        const resp = await fetch(`/api/job/read/${transcriptionJobId}`, {
          credentials: 'include',
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          return; // transient; keep polling
        }
        const job = json.result;
        if (job.status === 'done') {
          stopPolling();
          setPendingFile((prev) =>
            prev && prev._id === fileMeta._id
              ? {
                  ...prev,
                  state: 'ready',
                  jobStatus: 'done',
                  durationMs: job.result?.durationMs ?? null,
                  sidecarBytes: job.result?.sizeBytes ?? null,
                }
              : prev
          );
          if (
            onTranscriptionComplete &&
            !completedFileIdsRef.current.has(fileMeta._id)
          ) {
            completedFileIdsRef.current.add(fileMeta._id);
            onTranscriptionComplete({
              fileId: fileMeta._id,
              originalName: fileMeta.originalName,
              durationMs: job.result?.durationMs ?? null,
              sidecarBytes: job.result?.sizeBytes ?? null,
              deduped: false,
            });
          }
        } else if (job.status === 'failed') {
          stopPolling();
          setPendingFile((prev) =>
            prev && prev._id === fileMeta._id
              ? {
                  ...prev,
                  state: 'failed',
                  jobStatus: 'failed',
                  error: job.error || 'Transcription failed',
                }
              : prev
          );
        }
        // pending / running → keep polling
      } catch (_err) {
        // network blip; next tick retries
      }
    }, POLL_INTERVAL_MS);
  };

  // Stop polling on unmount
  useEffect(() => () => stopPolling(), []);

  // ---- Upload handler --------------------------------------------------

  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Picking a new file always cancels any in-flight poll for a previous
    // file, even if the new upload subsequently fails before startPolling.
    stopPolling();
    setPlusMenuOpen(false);
    setPendingFile({
      state: 'uploading',
      _id: null,
      transcriptionJobId: null,
      originalName: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      deduped: false,
      error: null,
      jobStatus: null,
      durationMs: null,
      sidecarBytes: null,
      contentHash: null,
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/file/create', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setPendingFile({
          state: 'failed',
          _id: null,
          transcriptionJobId: null,
          originalName: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
          deduped: false,
          error: (json && json.message) || `HTTP ${resp.status}`,
          jobStatus: null,
          durationMs: null,
          sidecarBytes: null,
          contentHash: null,
        });
        return;
      }
      const result = json.result;
      const baseMeta = {
        _id: result._id,
        transcriptionJobId: result.transcriptionJobId,
        originalName: result.originalName,
        sizeBytes: result.sizeBytes,
        mimeType: result.mimeType,
        contentHash: result.contentHash,
        deduped: !!result.deduped,
        error: null,
        jobStatus: null,
        durationMs: null,
        sidecarBytes: null,
      };
      if (result.deduped) {
        // Dedup hit → File + Job already exist + transcription already done
        setPendingFile({ ...baseMeta, state: 'ready' });
        if (onTranscriptionComplete && !completedFileIdsRef.current.has(result._id)) {
          completedFileIdsRef.current.add(result._id);
          onTranscriptionComplete({
            fileId: result._id,
            originalName: result.originalName,
            durationMs: null,
            sidecarBytes: null,
            deduped: true,
          });
        }
        return;
      }
      // Fresh upload → start polling
      setPendingFile({ ...baseMeta, state: 'transcribing', jobStatus: 'pending' });
      startPolling(result.transcriptionJobId, baseMeta);
    } catch (err) {
      setPendingFile({
        state: 'failed',
        _id: null,
        transcriptionJobId: null,
        originalName: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        deduped: false,
        error: err.message || 'Upload failed',
        jobStatus: null,
        durationMs: null,
        sidecarBytes: null,
        contentHash: null,
      });
    }
  };

  // ---- Transcript preview ---------------------------------------------

  const togglePreview = async () => {
    if (!pendingFile || pendingFile.state !== 'ready' || !pendingFile._id) return;
    // Already loaded → toggle expanded
    if (transcriptPreview && transcriptPreview.fileId === pendingFile._id) {
      setTranscriptPreview({ ...transcriptPreview, expanded: !transcriptPreview.expanded });
      return;
    }
    // Fetch
    setTranscriptPreview({
      fileId: pendingFile._id,
      text: '',
      expanded: true,
      loading: true,
      error: null,
    });
    try {
      const resp = await fetch(`/api/file/transcript/${pendingFile._id}`, {
        credentials: 'include',
      });
      const json = await resp.json();
      if (resp.ok && json.success) {
        setTranscriptPreview({
          fileId: pendingFile._id,
          text: json.result.transcript || '',
          expanded: true,
          loading: false,
          error: null,
        });
      } else {
        setTranscriptPreview({
          fileId: pendingFile._id,
          text: '',
          expanded: true,
          loading: false,
          error: (json && json.message) || `HTTP ${resp.status}`,
        });
      }
    } catch (err) {
      setTranscriptPreview({
        fileId: pendingFile._id,
        text: '',
        expanded: true,
        loading: false,
        error: err.message || 'Preview failed',
      });
    }
  };

  // ---- Plus menu -------------------------------------------------------

  const plusMenuItems = [
    {
      icon: <PaperClipOutlined />,
      label: translate('Upload photos & files'),
      onClick: () => fileInputRef.current?.click(),
    },
  ];

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

  // ---- Send gate -------------------------------------------------------

  const sendDisabled =
    disabled ||
    pendingFile?.state === 'uploading' ||
    pendingFile?.state === 'failed';

  const handleSend = () => {
    if (sendDisabled) return;
    const text = inputValue.trim();
    if (!text) return;
    const attachments =
      pendingFile?._id &&
      (pendingFile.state === 'ready' || pendingFile.state === 'transcribing')
        ? [pendingFile._id]
        : [];
    onSend({ text, mentions: [], attachments });
    setInputValue('');
    // Keep chip attached so user can ask follow-up questions about same file
    // Cleared only when user clicks the X button or picks a new file
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removePendingFile = () => {
    stopPolling();
    setTranscriptPreview(null);
    setPendingFile(null);
  };

  // ---- Chip rendering --------------------------------------------------

  const renderChipStatus = () => {
    if (!pendingFile) return null;
    const sizeMb = (pendingFile.sizeBytes / 1024 / 1024).toFixed(1);
    switch (pendingFile.state) {
      case 'uploading':
        return (
          <>
            <LoadingOutlined spin />
            <span className="askola-pending-file-status">{translate('Uploading...')}</span>
          </>
        );
      case 'transcribing':
        return (
          <>
            <LoadingOutlined spin />
            <span className="askola-pending-file-status">
              {translate('Transcribing...')} ({sizeMb} MB)
            </span>
          </>
        );
      case 'ready':
        return (
          <>
            <CheckCircleFilled style={{ color: '#52c41a' }} />
            <span className="askola-pending-file-status">
              {pendingFile.deduped
                ? translate('Already transcribed (reused)')
                : `${sizeMb} MB · ${translate('Ready')}`}
            </span>
            <button
              type="button"
              className="askola-pending-file-preview-btn"
              onClick={togglePreview}
              aria-label={translate('View transcript')}
            >
              {transcriptPreview?.expanded && transcriptPreview.fileId === pendingFile._id ? (
                <UpOutlined />
              ) : (
                <DownOutlined />
              )}
              <span>{translate('Transcript')}</span>
            </button>
          </>
        );
      case 'failed':
        return (
          <>
            <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />
            <span className="askola-pending-file-status">
              {translate('Failed')}: {pendingFile.error || translate('unknown error')}
            </span>
          </>
        );
      default:
        return null;
    }
  };

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
        <>
          <div className={`askola-pending-file-chip askola-pending-file-chip--${pendingFile.state}`}>
            <PaperClipOutlined className="askola-pending-file-icon" />
            <span className="askola-pending-file-name">{pendingFile.originalName}</span>
            {renderChipStatus()}
            <button
              type="button"
              className="askola-pending-file-remove"
              onClick={removePendingFile}
              aria-label={translate('Remove file')}
            >
              <CloseOutlined />
            </button>
          </div>
          {transcriptPreview &&
            transcriptPreview.fileId === pendingFile._id &&
            transcriptPreview.expanded && (
              <div className="askola-pending-file-transcript-preview">
                {transcriptPreview.loading ? (
                  <span>{translate('Loading transcript...')}</span>
                ) : transcriptPreview.error ? (
                  <span style={{ color: '#ff4d4f' }}>
                    {translate('Cannot load transcript')}: {transcriptPreview.error}
                  </span>
                ) : (
                  <pre className="askola-transcript-pre">{transcriptPreview.text}</pre>
                )}
              </div>
            )}
        </>
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
