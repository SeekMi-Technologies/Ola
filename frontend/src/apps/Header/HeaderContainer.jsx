import { Layout } from 'antd';
// === MVP-HIDDEN: Tooltip / useNavigate 仅供已隐藏的三点 Setting 按钮使用 ===
// import { Tooltip } from 'antd';
// === END MVP-HIDDEN ===
import { useLocation } from 'react-router-dom';
// === MVP-HIDDEN: useNavigate 仅供已隐藏的三点 Setting 按钮使用 ===
// import { useNavigate } from 'react-router-dom';
// === END MVP-HIDDEN ===
import { useEffect } from 'react';
import { useAppContext } from '@/context/appContext';
import useLanguage from '@/locale/useLanguage';
import LanguageToggle from '@/components/LanguageToggle';

import {
  // === MVP-HIDDEN: Help / 3-dot Setting 按钮已注释掉 ===
  // QuestionCircleOutlined,
  // EllipsisOutlined,
  // === END MVP-HIDDEN ===
  SmileOutlined,
  DashboardOutlined,
  // === MVP-HIDDEN: 以下 icon 对应已隐藏的页面 ===
  // BellOutlined,
  // RobotOutlined,
  // ThunderboltOutlined,
  // ApartmentOutlined,
  // MessageOutlined,
  WalletOutlined,
  // DollarOutlined,
  // SearchOutlined,
  // BarChartOutlined,
  // === END MVP-HIDDEN ===
  FileOutlined,
  CustomerServiceOutlined,
  GiftOutlined,
  BuildOutlined,
  ContainerOutlined,
  FileSyncOutlined,
  CreditCardOutlined,
  SettingOutlined,
  UserOutlined,
  CheckSquareOutlined,
  HistoryOutlined,
  PlusOutlined,
} from '@ant-design/icons';

const PAGE_MAP = {
  '/': { icon: <DashboardOutlined />, label: 'Dashboard' },
  '/askola': { icon: <SmileOutlined />, label: 'Ask Ola' },
  // === MVP-HIDDEN: 以下页面已从导航中隐藏 ===
  // '/notifications': { icon: <BellOutlined />, label: 'Notifications' },
  // '/messages': { icon: <MessageOutlined />, label: 'Messages' },
  // '/file': { icon: <FileOutlined />, label: 'File' },
  // '/agents': { icon: <RobotOutlined />, label: 'Agents' },
  // '/sequences': { icon: <ThunderboltOutlined />, label: 'Sequences' },
  // '/workflows': { icon: <ApartmentOutlined />, label: 'Workflows' },
  // === END MVP-HIDDEN ===
  '/customer': { icon: <CustomerServiceOutlined />, label: 'Customers' },
  '/merchandise': { icon: <GiftOutlined />, label: 'Merchandise' },
  '/factory': { icon: <BuildOutlined />, label: 'Factory' },
  '/invoice': { icon: <ContainerOutlined />, label: 'Invoice' },
  '/quote': { icon: <FileSyncOutlined />, label: 'Quote' },
  '/purchaseorder': { icon: <FileOutlined />, label: 'Purchase Orders' },
  '/payment': { icon: <CreditCardOutlined />, label: 'Payment' },
  // === MVP-HIDDEN: 配置页/定制功能，已从导航中隐藏 ===
  '/payment/mode': { icon: <WalletOutlined />, label: 'Payment Mode' },
  // '/currencies': { icon: <DollarOutlined />, label: 'Currencies' },
  // '/pricesearch': { icon: <SearchOutlined />, label: 'Price Search' },
  // '/comparison': { icon: <BarChartOutlined />, label: 'Comparison' },
  // === END MVP-HIDDEN ===
  '/settings': { icon: <SettingOutlined />, label: 'Settings' },
  '/profile': { icon: <UserOutlined />, label: 'Profile' },
};

function getPageInfo(pathname) {
  // Try exact match first
  if (PAGE_MAP[pathname]) return PAGE_MAP[pathname];
  // Try matching prefix (for sub-routes like /invoice/create)
  const base = '/' + pathname.split('/').filter(Boolean)[0];
  if (PAGE_MAP[base]) return PAGE_MAP[base];
  return { icon: <CheckSquareOutlined />, label: 'Tasks' };
}

export default function HeaderContent() {
  const { Header } = Layout;
  const location = useLocation();
  // === MVP-HIDDEN: navigate 仅供已隐藏的三点 Setting 按钮使用 ===
  // const navigate = useNavigate();
  // === END MVP-HIDDEN ===
  const translate = useLanguage();
  const pageInfo = getPageInfo(location.pathname);
  const { state: stateApp, appContextAction } = useAppContext();
  const { isOlaPanelOpen } = stateApp;
  const { olaPanel } = appContextAction;

  // Auto-close the side panel when navigating to the Ask Ola page
  useEffect(() => {
    if (location.pathname === '/askola' && isOlaPanelOpen) {
      olaPanel.close();
    }
  }, [location.pathname, isOlaPanelOpen, olaPanel]);

  return (
    <Header
      style={{
        padding: '0 24px',
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '56px',
        lineHeight: '56px',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <div className="header-page-title">
        <span className="header-page-icon">{pageInfo.icon}</span>
        <span className="header-page-label">{translate(pageInfo.label)}</span>
      </div>

      <div className="header-right-actions">
        {location.pathname === '/askola' ? (
          <>
            <button className="header-action-btn" onClick={() => { appContextAction.chatSession.setActive(null); }}>
              <PlusOutlined />
              <span>{translate('New Chat')}</span>
            </button>
            <button className="header-action-btn header-action-btn--ola" onClick={() => appContextAction.historyModal.open()}>
              <HistoryOutlined />
              <span>{translate('History')}</span>
            </button>
            {/* === MVP-HIDDEN: AskOla 页不需要语言切换 === */}
            {/* <LanguageToggle variant="header" /> */}
            {/* === END MVP-HIDDEN === */}
            {/* === MVP-HIDDEN: 三点 Setting 按钮已隐藏（指向的 SettingsAskOla 页本轮不需要） === */}
            {/* <button
              className="header-action-btn"
              onClick={() => navigate('/settings/edit/ask_ola')}
              style={{ padding: '0 8px', minWidth: 'auto', border: 'none', background: 'transparent', boxShadow: 'none' }}
            >
              <Tooltip title={translate('Setting')} placement="bottom">
                <EllipsisOutlined rotate={90} style={{ fontSize: '18px', color: '#8c8c8c' }} />
              </Tooltip>
            </button> */}
            {/* === END MVP-HIDDEN === */}
          </>
        ) : (
          <>
            <LanguageToggle variant="header" />
            {/* === MVP-HIDDEN: Help 按钮无实际功能 === */}
            {/* <button className="header-action-btn">
              <QuestionCircleOutlined />
              <span>{translate('Help')}</span>
            </button> */}
            {/* === END MVP-HIDDEN === */}
            {/* === MVP-HIDDEN: 侧弹 Ask Ola 面板已隐藏（用左侧导航的 Ask Ola 链接进入主页面） === */}
            {/* {!isOlaPanelOpen && (
              <button className="header-action-btn header-action-btn--ola" onClick={() => olaPanel.open()}>
                <SmileOutlined />
                <span>{translate('Ask Ola')}</span>
              </button>
            )} */}
            {/* === END MVP-HIDDEN === */}
          </>
        )}
      </div>
    </Header>
  );
}
