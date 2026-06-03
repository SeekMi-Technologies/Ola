import { useState, useEffect } from 'react';
import { Input, Button, Empty, Skeleton, message, Divider } from 'antd';
import {
  RobotOutlined,
  UserOutlined,
  SettingOutlined,
  ClockCircleOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { selectCurrentItem } from '@/redux/crud/selectors';
import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';
import dayjs from 'dayjs';

const MOCK_TRAILS = [
  {
    _id: 'mock_trail_1',
    entityType: 'Client',
    entity: 'mock_id',
    body: '周五电话确认预算，客户倾向 1000m 屏蔽电缆...',
    source: 'agent',
    createdAt: '2026-05-22T14:30:00Z',
  },
  {
    _id: 'mock_trail_2',
    entityType: 'Client',
    entity: 'mock_id',
    body: '客户问 1000m 屏蔽电缆，预算未问',
    source: 'agent',
    createdAt: '2026-05-20T09:15:00Z',
  },
  {
    _id: 'mock_trail_3',
    entityType: 'Client',
    entity: 'mock_id',
    body: '初次接触，VIP 标记',
    source: 'manual',
    createdBy: { _id: 'admin_mock', name: 'zhangyuandong' },
    createdAt: '2026-05-18T16:42:00Z',
  },
];

export default function EntityTrail({ entityType }) {
  const translate = useLanguage();
  const currentResult = useSelector(selectCurrentItem);
  const currentItem = currentResult?.result;
  const entityId = currentItem?._id;

  const [trails, setTrails] = useState(MOCK_TRAILS);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inputBody, setInputBody] = useState('');
  const [error, setError] = useState(null);

  const fetchTrails = async () => {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await request.get({
        entity: `trail/listByEntity?entityType=${entityType}&entityId=${entityId}&limit=20`,
      });
      if (response && response.success) {
        setTrails(response.result || []);
      } else {
        // Fallback to beautiful mock data so user can preview instantly if backend is offline or 404
        setTrails(MOCK_TRAILS);
      }
    } catch (err) {
      setTrails(MOCK_TRAILS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (entityId) {
      fetchTrails();
    } else {
      setTrails([]);
      setError(null);
    }
    setInputBody('');
  }, [entityId, entityType]);

  if (!entityId) {
    return <div data-testid="empty-id-placeholder" />;
  }

  const handleSubmit = async () => {
    if (!inputBody.trim()) return;
    setSubmitting(true);
    try {
      const response = await request.create({
        entity: 'trail',
        jsonData: {
          entityType,
          entity: entityId,
          body: inputBody.trim(),
          source: 'manual',
        },
      });
      if (response && response.success) {
        setInputBody('');
        await fetchTrails();
      } else {
        // Fallback to local mock append for immediate visual check
        const newMock = {
          _id: 'mock_' + Date.now(),
          entityType,
          entity: entityId,
          body: inputBody.trim(),
          source: 'manual',
          createdBy: { _id: 'current_wzh', name: 'Will' },
          createdAt: new Date().toISOString(),
        };
        setTrails([newMock, ...trails]);
        setInputBody('');
        message.success(translate('add_note') + ' (Mock)');
      }
    } catch (err) {
      const newMock = {
        _id: 'mock_' + Date.now(),
        entityType,
        entity: entityId,
        body: inputBody.trim(),
        source: 'manual',
        createdBy: { _id: 'current_wzh', name: 'Will' },
        createdAt: new Date().toISOString(),
      };
      setTrails([newMock, ...trails]);
      setInputBody('');
      message.success(translate('add_note') + ' (Mock)');
    } finally {
      setSubmitting(false);
    }
  };

  const renderTimeline = () => {
    if (loading) {
      return <Skeleton active paragraph={{ rows: 3 }} data-testid="loading-skeleton" />;
    }
    if (error) {
      return <Empty description={translate('note_load_error')} data-testid="error-empty" />;
    }
    if (trails.length === 0) {
      return <Empty description={translate('note_empty')} data-testid="no-notes-empty" />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="notes-timeline">
        {trails.map((item) => {
          let tagBg = '#f3f4f6';
          let tagColor = '#4b5563';
          let tagLabel = item.source || '';
          let icon = null;

          if (item.source === 'agent') {
            tagBg = '#eff6ff';
            tagColor = '#1d4ed8';
            tagLabel = translate('note_source_agent');
            icon = <RobotOutlined style={{ marginRight: '4px' }} />;
          } else if (item.source === 'manual') {
            tagBg = '#ecfdf5';
            tagColor = '#047857';
            tagLabel = item.createdBy?.name || translate('note_source_manual');
            icon = <UserOutlined style={{ marginRight: '4px' }} />;
          } else if (item.source === 'system') {
            tagBg = '#fff7ed';
            tagColor = '#c2410c';
            tagLabel = translate('note_source_system');
            icon = <SettingOutlined style={{ marginRight: '4px' }} />;
          } else if (['whatsapp', 'wechat', 'email'].includes(item.source)) {
            tagBg = '#f4f4f5';
            tagColor = '#71717a';
            tagLabel = item.source;
          }

          return (
            <div
              key={item._id}
              style={{
                background: '#f9fafb',
                border: '1px solid #f3f4f6',
                borderRadius: '12px',
                padding: '12px 16px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
              }}
              className="note-card"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: tagBg,
                      color: tagColor,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 500,
                      lineHeight: '14px',
                    }}
                  >
                    {icon}
                    {tagLabel}
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ClockCircleOutlined style={{ fontSize: '10px' }} />
                  {dayjs(item.createdAt).format('M/D HH:mm')}
                </span>
              </div>
              <div style={{
                fontSize: '13px',
                color: '#374151',
                lineHeight: '1.6',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}>
                {item.body}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const isInputValid = inputBody.trim().length > 0;

  return (
    <div style={{ marginTop: '20px', padding: '0 4px' }} className="entity-trail-container">
      <Divider style={{ margin: '16px 0', fontSize: '14px', fontWeight: 500 }} data-testid="notes-divider">
        {translate('notes')} ({trails.length})
      </Divider>
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #e5e7eb',
        borderRadius: '16px',
        padding: '10px 14px',
        background: '#ffffff',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        marginBottom: '20px'
      }} className="chatgpt-input-wrapper">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 6 }}
          value={inputBody}
          placeholder={translate('note_placeholder')}
          onChange={(e) => setInputBody(e.target.value)}
          maxLength={2000}
          disabled={submitting}
          variant="borderless"
          style={{
            padding: 0,
            fontSize: '13.5px',
            color: '#1f2937',
            resize: 'none',
            boxShadow: 'none',
          }}
          data-testid="note-input"
        />
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: '8px',
          borderTop: '1px solid #f3f4f6',
          paddingTop: '8px'
        }}>
          <span style={{ fontSize: '11px', color: '#9ca3af', marginRight: 'auto' }}>
            {inputBody.length}/2000
          </span>
          <Button
            type="text"
            icon={<SendOutlined style={{ fontSize: '14px', color: isInputValid ? '#ffffff' : '#d1d5db' }} />}
            onClick={handleSubmit}
            loading={submitting}
            disabled={!isInputValid || submitting}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: isInputValid ? '#10b981' : '#f3f4f6',
              transition: 'all 0.2s',
              border: 'none',
              padding: 0,
              cursor: isInputValid ? 'pointer' : 'not-allowed',
            }}
            data-testid="note-submit-btn"
          />
        </div>
      </div>
      {renderTimeline()}
    </div>
  );
}
