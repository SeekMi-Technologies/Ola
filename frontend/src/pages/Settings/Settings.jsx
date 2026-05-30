import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  SettingOutlined,
  DollarOutlined,
  // === MVP-HIDDEN: 以下 icon 对应已隐藏的 Settings 子页面 ===
  // TeamOutlined,
  // RocketOutlined,
  // CrownOutlined,
  // BgColorsOutlined,
  // CloudServerOutlined,
  // BellOutlined,
  // === END MVP-HIDDEN ===
  UserOutlined,
  // === MVP-HIDDEN: 仅供已隐藏的 Accounts / Ask Ola 子页面使用 ===
  // MailOutlined,
  // SmileOutlined,
  // === END MVP-HIDDEN ===
  LeftOutlined,
  LogoutOutlined,
} from '@ant-design/icons';

import useLanguage from '@/locale/useLanguage';
import { VERSION } from '@/version';

import SettingsProfile from './SettingsProfile';
// === MVP-HIDDEN: 以下 Settings 子页面本轮不需要 ===
// import SettingsAppearance from './SettingsAppearance';
// import SettingsEmailAccounts from './SettingsEmailAccounts';
// import SettingsStorageAccounts from './SettingsStorageAccounts';
// import SettingsNotifications from './SettingsNotifications';
// import SettingsAskOla from './SettingsAskOla';
// === END MVP-HIDDEN ===
import SettingsGeneralNew from './SettingsGeneralNew';
// === MVP-HIDDEN: 以下 Settings 子页面本轮不需要 ===
// import SettingsMembers from './SettingsMembers';
// import SettingsAskOlaUsage from './SettingsAskOlaUsage';
// import SettingsPlans from './SettingsPlans';
// import SettingsBilling from './SettingsBilling';
// === END MVP-HIDDEN ===
import MoneyFormatSettings from './MoneyFormatSettings';

export default function Settings() {
  const translate = useLanguage();
  const navigate = useNavigate();
  const { settingsKey } = useParams();
  const [activeKey, setActiveKey] = useState('profile');

  useEffect(() => {
    if (settingsKey) {
      setActiveKey(settingsKey);
    }
  }, [settingsKey]);

  // Sidebar menu structure
  const sidebarSections = [
    {
      label: translate('Personal'),
      items: [
        { key: 'profile', icon: <UserOutlined />, label: translate('Profile') },
        // === MVP-HIDDEN: Appearance / Accounts / Storage / Notifications / Ask Ola 本轮不需要 ===
        // { key: 'appearance', icon: <BgColorsOutlined />, label: 'Appearance' },
        // { key: 'email_accounts', icon: <MailOutlined />, label: translate('Accounts') },
        // { key: 'storage_accounts', icon: <CloudServerOutlined />, label: 'Storage Accounts' },
        // { key: 'notifications_settings', icon: <BellOutlined />, label: 'Notifications' },
        // { key: 'ask_ola', icon: <SmileOutlined />, label: translate('Ask Ola') },
        // === END MVP-HIDDEN ===
      ],
    },
    {
      label: translate('Workspace'),
      items: [
        { key: 'general_settings', icon: <SettingOutlined />, label: translate('Company') },
        // === MVP-HIDDEN: Members/AskOla Usage/Plans/Billing 本轮不需要 ===
        // { key: 'members_teams', icon: <TeamOutlined />, label: 'Members and teams' },
        // { key: 'ask_ola_usage', icon: <RocketOutlined />, label: 'Ask Ola usage' },
        // { key: 'plans', icon: <CrownOutlined />, label: 'Plans' },
        // { key: 'billing', icon: <DollarOutlined />, label: 'Billing' },
        // === END MVP-HIDDEN ===
        { key: 'currency_settings', icon: <DollarOutlined />, label: translate('Currency Settings') },
      ],
    },
  ];

  // Content panel header info
  const panelHeaders = {
    profile: { icon: <UserOutlined />, label: translate('Profile') },
    // === MVP-HIDDEN: 对应已隐藏的 Settings 子页面 ===
    // appearance: { icon: <BgColorsOutlined />, label: 'Appearance' },
    // email_accounts: { icon: <MailOutlined />, label: translate('Accounts') },
    // storage_accounts: { icon: <CloudServerOutlined />, label: 'Storage Accounts' },
    // notifications_settings: { icon: <BellOutlined />, label: 'Notifications' },
    // ask_ola: { icon: <SmileOutlined />, label: translate('Ask Ola') },
    // === END MVP-HIDDEN ===
    general_settings: { icon: <SettingOutlined />, label: translate('Company') },
    // === MVP-HIDDEN: 对应已隐藏的 Settings 子页面 ===
    // members_teams: { icon: <TeamOutlined />, label: 'Members and teams' },
    // ask_ola_usage: { icon: <RocketOutlined />, label: 'Ask Ola usage' },
    // plans: { icon: <CrownOutlined />, label: 'Plans' },
    // billing: { icon: <DollarOutlined />, label: 'Billing' },
    // === END MVP-HIDDEN ===
    currency_settings: { icon: <DollarOutlined />, label: translate('Currency Settings') },
  };

  // Render content based on activeKey
  const renderContent = () => {
    switch (activeKey) {
      case 'profile':
        return <SettingsProfile />;
      // === MVP-HIDDEN: 对应已隐藏的 Settings 子页面 ===
      // case 'appearance':
      //   return <SettingsAppearance />;
      // case 'email_accounts':
      //   return <SettingsEmailAccounts />;
      // case 'storage_accounts':
      //   return <SettingsStorageAccounts />;
      // case 'notifications_settings':
      //   return <SettingsNotifications />;
      // case 'ask_ola':
      //   return <SettingsAskOla />;
      // === END MVP-HIDDEN ===
      case 'general_settings':
        return <SettingsGeneralNew />;
      // === MVP-HIDDEN: 对应已隐藏的 Settings 子页面 ===
      // case 'members_teams':
      //   return <SettingsMembers />;
      // case 'ask_ola_usage':
      //   return <SettingsAskOlaUsage />;
      // case 'plans':
      //   return <SettingsPlans />;
      // case 'billing':
      //   return <SettingsBilling />;
      // === END MVP-HIDDEN ===
      case 'currency_settings':
        return (
          <div className="settings-existing-panel">
            <MoneyFormatSettings />
          </div>
        );
      default:
        return <SettingsProfile />;
    }
  };

  const currentPanel = panelHeaders[activeKey] || panelHeaders.profile;

  return (
    <div className="settings-page-wrapper">
      {/* Top bar with back button */}
      <div className="settings-top-bar">
        <button className="settings-back-btn" onClick={() => navigate('/')}>
          <LeftOutlined />
          <span>{translate('Settings')}</span>
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div className="settings-body">
        {/* Sidebar */}
        <div className="settings-sidebar">
          {sidebarSections.map((section) => (
            <div key={section.label} className="settings-sidebar-group">
              <div className="settings-sidebar-group-label">{section.label}</div>
              {section.items.map((item) => (
                <div
                  key={item.key}
                  className={`settings-sidebar-item ${activeKey === item.key ? 'active' : ''}`}
                  onClick={() => setActiveKey(item.key)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}

          <div className="settings-sidebar-logout-container">
            <button className="settings-sidebar-logout-btn" onClick={() => navigate('/logout')}>
              <LogoutOutlined />
              <span>{translate('Log Out')}</span>
            </button>
            <div className="settings-sidebar-version">Ola v{VERSION}</div>
          </div>
        </div>

        {/* Content area */}
        <div className="settings-content">
          <div className="settings-content-header">
            {currentPanel.icon}
            <span>{currentPanel.label}</span>
          </div>
          <div className="settings-content-body">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
