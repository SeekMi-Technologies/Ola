import { useEffect, useState } from 'react';
import axios from 'axios';
import { Drawer, Typography, Spin, Alert, Empty } from 'antd';

import useLanguage from '@/locale/useLanguage';

export default function TranscriptDrawer({ fileId, open, onClose }) {
  const translate = useLanguage();
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [filename, setFilename] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!open || !fileId) {
      setTranscript(null);
      setFilename('');
      setErrorMessage(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    axios
      .get(`file/transcript/${fileId}`)
      .then((resp) => {
        if (cancelled) return;
        if (resp.data && resp.data.success) {
          setTranscript(resp.data.result?.transcript || '');
          setFilename(resp.data.result?.originalName || '');
        } else {
          setErrorMessage(
            resp.data?.message || translate('transcript_load_failed')
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(
          err.response?.data?.message || translate('transcript_load_failed')
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fileId, translate]);

  return (
    <Drawer
      title={filename || translate('transcript')}
      width={520}
      placement="right"
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin />
        </div>
      ) : errorMessage ? (
        <Alert type="error" message={errorMessage} showIcon />
      ) : transcript ? (
        <Typography.Paragraph
          copyable={{ text: transcript }}
          style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}
        >
          {transcript}
        </Typography.Paragraph>
      ) : (
        <Empty description={translate('transcript_empty')} />
      )}
    </Drawer>
  );
}
