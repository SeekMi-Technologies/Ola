// Note: Yuandong, you will use this page to add navigation

import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Drawer, Layout, Menu, Avatar } from 'antd';
import { useSelector } from 'react-redux';

import { useAppContext } from '@/context/appContext';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { FILE_BASE_URL } from '@/config/serverApiConfig';

import useLanguage from '@/locale/useLanguage';
import logo from '@/style/images/aola.png';
import collapsedLogo from '@/style/images/collapsed-logo.svg';

import useResponsive from '@/hooks/useResponsive';

import {
  SettingOutlined,
  BuildOutlined,
  CustomerServiceOutlined,
  ContainerOutlined,
  FileSyncOutlined,
  DashboardOutlined,
  // === MVP-HIDDEN: 以下 icon 当前无菜单项使用 ===
  // TagOutlined,
  // TagsOutlined,
  // ShopOutlined,
  // FilterOutlined,
  // ReconciliationOutlined,
  WalletOutlined,
  // DollarOutlined,
  // BarChartOutlined,
  // SearchOutlined,
  // === END MVP-HIDDEN ===
  UserOutlined,
  CreditCardOutlined,
  MenuOutlined,
  FileOutlined,
  GiftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  StarOutlined,
  SmileOutlined,
  QuestionCircleOutlined,
  LogoutOutlined,
  RightOutlined,
} from '@ant-design/icons';

const { Sider } = Layout;

export default function Navigation() {
  const { isMobile } = useResponsive();

  return isMobile ? <MobileSidebar /> : <Sidebar collapsible={true} />;
}

function Sidebar({ collapsible, isMobile = false }) {
  let location = useLocation();

  const { state: stateApp, appContextAction } = useAppContext();
  const { isNavMenuClose } = stateApp;
  const { navMenu } = appContextAction;
  const [showLogoApp, setLogoApp] = useState(isNavMenuClose);
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const [isExpandTriggerHovered, setIsExpandTriggerHovered] = useState(false);
  const [currentPath, setCurrentPath] = useState(location.pathname.slice(1));
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileWrapperRef = useRef(null);

  const translate = useLanguage();
  const navigate = useNavigate();

  // Read current admin from Redux store — no hardcode
  const currentAdmin = useSelector(selectCurrentAdmin);
  const avatarSrc = currentAdmin?.photo
    ? FILE_BASE_URL + currentAdmin.photo
    : undefined;
  const avatarInitial = currentAdmin?.name?.charAt(0)?.toUpperCase() || 'U';

  const items = [
    {
      type: 'group',
      label: '',
      children: [
        {
          key: 'dashboard',
          icon: <DashboardOutlined />,
          label: <Link to={'/'}>{translate('dashboard')}</Link>,
        },
        {
          key: 'askola',
          icon: <SmileOutlined />,
          label: <Link to={'/askola'}>{translate('Ask Ola')}</Link>,
        },
        {
          key: 'file',
          icon: <FileOutlined />,
          label: <Link to={'/file'}>{translate('file')}</Link>,
        },
      ],
    },
    {
      type: 'group',
      label: translate('Business'),
      children: [
        {
          key: 'Merchandise',
          label: <Link to={'/merchandise'}>{translate('Merchandise')}</Link>,
          icon: <GiftOutlined />,
        },
        {
          key: 'customer',
          icon: <CustomerServiceOutlined />,
          label: <Link to={'/customer'}>{translate('customers')}</Link>,
        },
        {
          key: 'factory',
          icon: <BuildOutlined />,
          label: <Link to={'/factory'}>{translate('factory')}</Link>,
        },
      ],
    },
    {
      type: 'group',
      label: translate('Finance'),
      children: [
        {
          key: 'quote',
          icon: <FileSyncOutlined />,
          label: <Link to={'/quote'}>{translate('quote')}</Link>,
        },
        {
          key: 'purchaseorder',
          icon: <FileOutlined />,
          label: <Link to={'/purchaseorder'}>{translate('purchase_order')}</Link>,
        },
        {
          key: 'invoice',
          icon: <ContainerOutlined />,
          label: <Link to={'/invoice'}>{translate('invoices')}</Link>,
        },
        {
          key: 'payment',
          icon: <CreditCardOutlined />,
          label: <Link to={'/payment'}>{translate('payments')}</Link>,
        },
        // === MVP-HIDDEN: 配置页，不需要独立菜单项。可通过 Settings 页面访问 ===
        // {
        //   key: 'currencies',
        //   label: <Link to={'/currencies'}>{translate('currencies')}</Link>,
        //   icon: <DollarOutlined />,
        // },
        // === END MVP-HIDDEN ===
        {
          key: 'paymentMode',
          label: <Link to={'/payment/mode'}>{translate('payments_mode')}</Link>,
          icon: <WalletOutlined />,
        },
      ],
    },
    // === MVP-HIDDEN: Price Search 和 Full Comparison 为高度定制功能，有 bug，非 MVP 范围 ===
    // {
    //   type: 'group',
    //   label: translate('Tools'),
    //   children: [
    //     {
    //       key: 'pricesearch',
    //       icon: <SearchOutlined />,
    //       label: <Link to={'/pricesearch'}>{translate('price_search')}</Link>,
    //     },
    //     {
    //       key: 'fullcomparison',
    //       icon: <BarChartOutlined />,
    //       label: <Link to={'/comparison/full'}>{translate('full_comparison')}</Link>,
    //     },
    //   ],
    // },
    // === END MVP-HIDDEN ===
  ];

  useEffect(() => {
    if (location)
      if (currentPath !== location.pathname) {
        if (location.pathname === '/') {
          setCurrentPath('dashboard');
        } else setCurrentPath(location.pathname.slice(1));
      }
  }, [location, currentPath]);

  useEffect(() => {
    if (isNavMenuClose) {
      setLogoApp(isNavMenuClose);
      setIsLogoHovered(false);
    }
    const timer = setTimeout(() => {
      if (!isNavMenuClose) {
        setLogoApp(isNavMenuClose);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [isNavMenuClose]);
  const onCollapse = () => {
    navMenu.collapse();
  };

  // Close profile popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        isProfileMenuOpen &&
        profileWrapperRef.current &&
        !profileWrapperRef.current.contains(e.target)
      ) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  return (
    <Sider
      trigger={null}
      collapsible={collapsible}
      collapsed={collapsible ? isNavMenuClose : false}
      collapsedWidth={60}
      onCollapse={onCollapse}
      className="navigation"
      width={220}
      style={{
        overflow: 'hidden',
        height: '100vh',
      }}
      theme={'light'}
    >
      <div
        className="logo"
        onMouseEnter={() => setIsLogoHovered(true)}
        onMouseLeave={() => setIsLogoHovered(false)}
        onClick={() => {
          if (showLogoApp) {
            onCollapse();
          }
        }}
        style={{
          display: 'flex',
          justifyContent: showLogoApp ? 'center' : 'space-between',
          alignItems: 'center',
          paddingRight: showLogoApp ? '0px' : '16px',
        }}
      >
        <div
          onClick={(e) => {
            if (!showLogoApp) {
              navigate('/');
            }
          }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          {showLogoApp && isLogoHovered ? (
            <MenuUnfoldOutlined style={{ fontSize: '18px', color: '#1a1a1a' }} />
          ) : (
            <img
              src={showLogoApp ? collapsedLogo : logo}
              alt="Logo"
              style={{
                height: '18px',
                objectFit: 'contain',
                ...(showLogoApp && { width: '18px', marginLeft: 0 }),
              }}
            />
          )}
        </div>
        {!showLogoApp && (
          <Button
            type="text"
            className="collapse-toggle-btn"
            icon={<MenuFoldOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            style={{ fontSize: '16px', color: '#999', cursor: 'pointer' }}
          />
        )}
      </div>
      <div className="sidebar-menu-scroll">
        <Menu
          items={items}
          mode="inline"
          theme={'light'}
          selectedKeys={[currentPath]}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
          }}
        />
      </div>
      <div className="navigation-settings-container">
        <button className="navigation-settings-btn" onClick={() => navigate('/settings')}>
          <SettingOutlined />
          {!showLogoApp && <span>{translate('settings')}</span>}
        </button>
      </div>
      {showLogoApp && (
        <div
          className="expand-trigger-zone"
          onClick={onCollapse}
        />
      )}
    </Sider>
  );
}

function MobileSidebar() {
  const [visible, setVisible] = useState(false);
  const showDrawer = () => {
    setVisible(true);
  };
  const onClose = () => {
    setVisible(false);
  };

  return (
    <>
      <Button
        type="text"
        size="large"
        onClick={showDrawer}
        className="mobile-sidebar-btn"
        style={{ ['marginLeft']: 25 }}
      >
        <MenuOutlined style={{ fontSize: 18 }} />
      </Button>
      <Drawer
        width={250}
        // style={{ backgroundColor: 'rgba(255, 255, 255, 1)' }}
        placement={'left'}
        closable={false}
        onClose={onClose}
        open={visible}
      >
        <Sidebar collapsible={false} isMobile={true} />
      </Drawer>
    </>
  );
}
