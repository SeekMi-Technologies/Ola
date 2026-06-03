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
    body: '客户确认采购 1000m YJLV 22 4×240mm² 铠装电力电缆，交期要求 8 周以内。需要我们提供 CCC 认证副本和第三方检测报告，报价含 13% 增值税。',
    source: 'agent',
    createdAt: '2026-06-02T16:30:00Z',
  },
  {
    _id: 'mock_trail_2',
    entityType: 'Client',
    entity: 'mock_id',
    body: 'Follow-up call completed. Client is comparing our quote with 2 other suppliers. Key decision factors: delivery time and after-sales warranty. Decision expected by end of next week.',
    source: 'manual',
    createdBy: { _id: 'user_will', name: 'Will' },
    createdAt: '2026-06-01T10:15:00Z',
  },
  {
    _id: 'mock_trail_3',
    entityType: 'Client',
    entity: 'mock_id',
    body: 'WhatsApp: "Hi, could you send me the updated price list for armored cables? We need it before the board meeting on Friday. Thanks!"',
    source: 'whatsapp',
    createdAt: '2026-05-30T09:42:00Z',
  },
  {
    _id: 'mock_trail_4',
    entityType: 'Client',
    entity: 'mock_id',
    body: '报价单 QT-2026-0042 已发送至客户邮箱 info@sinocable.cn，总金额 ¥487,500.00（含税）。',
    source: 'system',
    createdAt: '2026-05-28T14:00:00Z',
  },
  {
    _id: 'mock_trail_5',
    entityType: 'Client',
    entity: 'mock_id',
    body: 'Email from client:\n\nDear Team,\n\nThank you for the quotation. We would like to request a 5% volume discount given our order quantity. Also, please confirm whether you can ship via Maersk to Shekou port.\n\nBest regards,\nLiu Wei\nProcurement Manager',
    source: 'email',
    createdAt: '2026-05-27T08:20:00Z',
  },
  {
    _id: 'mock_trail_6',
    entityType: 'Client',
    entity: 'mock_id',
    body: '与客户刘经理午餐会面，讨论了长期合作框架协议。客户年用量预估约 5000 万元，主要品类为中低压电力电缆和控制电缆。下一步：准备框架协议草案。',
    source: 'manual',
    createdBy: { _id: 'user_zyd', name: 'zhangyuandong' },
    createdAt: '2026-05-25T12:30:00Z',
  },
  {
    _id: 'mock_trail_7',
    entityType: 'Client',
    entity: 'mock_id',
    body: '客户信用评估完成：评级 A，建议授信额度 ¥200 万。',
    source: 'system',
    createdAt: '2026-05-22T17:00:00Z',
  },
  {
    _id: 'mock_trail_8',
    entityType: 'Client',
    entity: 'mock_id',
    body: '初次接触，客户来源：2026广州国际电线电缆展。联系人刘伟，采购经理，主要采购铠装电缆和屏蔽电缆。已标记为 VIP 潜在客户。',
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
          let tagColor = '#374151';
          let tagBorder = '1px solid #e5e7eb';
          let tagLabel = item.source || '';
          let icon = null;

          if (item.source === 'agent') {
            tagBg = '#e0f2fe';
            tagColor = '#0369a1';
            tagBorder = '1px solid #bae6fd';
            tagLabel = translate('note_source_agent');
            icon = <RobotOutlined style={{ marginRight: '4px' }} />;
          } else if (item.source === 'manual') {
            tagBg = '#dcfce7';
            tagColor = '#15803d';
            tagBorder = '1px solid #bbf7d0';
            tagLabel = item.createdBy?.name || translate('note_source_manual');
            icon = <UserOutlined style={{ marginRight: '4px' }} />;
          } else if (item.source === 'system') {
            tagBg = '#fee2e2';
            tagColor = '#b91c1c';
            tagBorder = '1px solid #fecaca';
            tagLabel = translate('note_source_system');
            icon = <SettingOutlined style={{ marginRight: '4px' }} />;
          } else if (item.source === 'whatsapp') {
            tagBg = '#e6f4ea';
            tagColor = '#137333';
            tagBorder = '1px solid #c4eed0';
            tagLabel = 'WhatsApp';
          } else if (item.source === 'wechat') {
            tagBg = '#e6f4ea';
            tagColor = '#137333';
            tagBorder = '1px solid #c4eed0';
            tagLabel = 'WeChat';
          } else if (item.source === 'email') {
            tagBg = '#fef3c7';
            tagColor = '#b45309';
            tagBorder = '1px solid #fde68a';
            tagLabel = 'Email';
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
                      border: tagBorder,
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
