import { CloseOutlined, HistoryOutlined, EllipsisOutlined, PlusOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useAppContext } from '@/context/appContext';
import { useNavigate } from 'react-router-dom';
import useLanguage from '@/locale/useLanguage';
import LanguageToggle from '@/components/LanguageToggle';

export default function OlaChatPanel() {
  const translate = useLanguage();
  const chatTitle = translate('Untitled chat');
  const { appContextAction } = useAppContext();
  const { olaPanel } = appContextAction;
  const navigate = useNavigate();

  return (
    <div className="ola-panel">
      {/* Panel Header */}
      <div className="ola-panel-header">
        <span className="ola-panel-title">{chatTitle}</span>
        <div className="ola-panel-header-actions">
          <button className="ola-panel-header-btn" title={translate('Add Chat')} onClick={() => appContextAction.chatSession.setActive(null)}>
            <PlusOutlined />
          </button>
          <button className="ola-panel-header-btn" title={translate('History')} onClick={() => appContextAction.historyModal.open()}>
            <HistoryOutlined />
          </button>
          <LanguageToggle variant="panel" />
          <button
            className="ola-panel-header-btn"
            onClick={() => navigate('/settings/edit/ask_ola')}
          >
            <Tooltip title={translate('Setting')} placement="bottom">
              <EllipsisOutlined rotate={90} />
            </Tooltip>
          </button>
          <button className="ola-panel-close" onClick={() => olaPanel.close()}>
            <CloseOutlined />
          </button>
        </div>
      </div>

      {/* Chat Body */}
      <div className="ola-panel-body">
        {/* Empty – placeholder for future messages */}
      </div>

      {/* Input placeholder — full chat at /askola */}
      <div className="ola-panel-input-wrapper" style={{ padding: '12px 16px', textAlign: 'center', color: '#8c8c8c', fontSize: '13px', cursor: 'pointer' }} onClick={() => navigate('/askola')}>
        {translate('Open Ask Ola to chat')}
      </div>
    </div>
  );
}
