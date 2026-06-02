import { useState, useMemo, Fragment, useEffect, useRef, useCallback } from 'react';
import { Button, Input, Switch, Row, Col, Tag, Segmented, message, Modal, Dropdown } from 'antd';
import { PlusOutlined, UserOutlined, LockOutlined, CheckOutlined, DownOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout';
import useLanguage from '@/locale/useLanguage';
import whatsappLogo from '@/style/images/whatsapp.png';
import whatsappQr from '@/style/images/whatsapp_qr.png';

// Data lives outside the component so it is never recreated on render.
// Descriptions are looked up by key at render time so language switches work.
const INTEGRATIONS_DATA = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    connected: false,
    popular: true,
    descriptionKey: 'integration_desc_whatsapp',
    logo: (
      <img
        src={whatsappLogo}
        alt="WhatsApp"
        style={{ width: '22px', height: '22px', objectFit: 'contain' }}
      />
    ),
  },
  {
    id: 'notion',
    name: 'Notion',
    connected: false,
    popular: true,
    descriptionKey: 'integration_desc_notion',
    logo: (
      <svg
        fill="#000000"
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '22px', height: '22px', objectFit: 'contain' }}
      >
        <title>Notion</title>
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
      </svg>
    ),
  },
];

export default function IntegrationsPage() {
  const translate = useLanguage();

  // Track only the mutable connection state; static data stays in INTEGRATIONS_DATA.
  const [connectedIds, setConnectedIds] = useState(
    () => new Set(INTEGRATIONS_DATA.filter((i) => i.connected).map((i) => i.id))
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [showConnectedOnly, setShowConnectedOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  
  // Notion Modal States
  const [nickname, setNickname] = useState("Team's Account");
  const [accessType, setAccessType] = useState('team');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [notionAccounts, setNotionAccounts] = useState([
    {
      id: '1',
      label: "Team's Account",
      access: 'team',
      addedBy: 'will.ziheng',
      enabled: true,
      locked: false,
      tools: {
        getUsers: 'auto',
        updateDataSource: 'auto',
        getComments: 'auto',
      }
    },
    {
      id: '2',
      label: "Personal Account",
      access: 'private',
      addedBy: 'will.ziheng',
      enabled: true,
      locked: false,
      tools: {
        getUsers: 'ask',
        updateDataSource: 'off',
        getComments: 'auto',
      }
    }
  ]);
  const [currentView, setCurrentView] = useState('list');
  const [notionSearchQuery, setNotionSearchQuery] = useState('');
  
  // Settings & Tools Expansion States
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('settings');
  const [openDropdownId, setOpenDropdownId] = useState(null);

  // Global click-away listener to close any open custom dropdown
  useEffect(() => {
    if (!openDropdownId) return;
    const handleClickOutside = (e) => {
      // If the click is inside a dropdown zone, let the zone's own handler deal with it
      if (e.target.closest('[data-dropdown-zone]')) return;
      setOpenDropdownId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdownId]);

  const handleToggleRowSelection = (id) => {
    setSelectedAccountId((prev) => (prev === id ? null : id));
  };

  const handleRowClick = (e, accountId) => {
    // If the click originated from inside a dropdown zone, skip row toggle
    if (e.target.closest('[data-dropdown-zone]')) return;
    handleToggleRowSelection(accountId);
  };
 
  // TODO: replace with Redux dispatch + real backend endpoint when integration backend is wired
  const handleToggleConnection = (id, name) => {
    if (id === 'whatsapp' && !connectedIds.has('whatsapp')) {
      setIsModalOpen(true);
      return;
    }
    if (id === 'notion') {
      if (connectedIds.has('notion')) {
        setCurrentView('notion');
      } else {
        setIsNotionModalOpen(true);
      }
      return;
    }
    const wasConnected = connectedIds.has(id);
    setConnectedIds((prev) => {
      const next = new Set(prev);
      if (wasConnected) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (wasConnected) {
      message.info(`${name} ${translate('integration_disconnected')}`);
    } else {
      message.success(`${name} ${translate('integration_connected')}`);
    }
  };

  const handleUpdateAccountAccess = (id, newAccess) => {
    setNotionAccounts((prev) =>
      prev.map((account) =>
        account.id === id ? { ...account, access: newAccess } : account
      )
    );
    message.success(`Access level updated successfully`);
  };

  const handleUpdateAccountLabel = (id, newLabel) => {
    setNotionAccounts((prev) =>
      prev.map((account) =>
        account.id === id ? { ...account, label: newLabel } : account
      )
    );
  };

  const handleUpdateAccountEnabled = (id, enabled) => {
    setNotionAccounts((prev) =>
      prev.map((account) =>
        account.id === id ? { ...account, enabled } : account
      )
    );
    message.success(enabled ? `Integration enabled` : `Integration disabled`);
  };

  const handleUpdateAccountLocked = (id, locked) => {
    setNotionAccounts((prev) =>
      prev.map((account) =>
        account.id === id ? { ...account, locked } : account
      )
    );
    message.success(locked ? `Integration locked` : `Integration unlocked`);
  };

  const handleDisconnectAccount = (id) => {
    setNotionAccounts((prev) => prev.filter((account) => account.id !== id));
    setSelectedAccountId(null);
    // If no accounts left, reset Notion connected status
    setNotionAccounts((curr) => {
      if (curr.length === 0) {
        setConnectedIds((prevIds) => {
          const next = new Set(prevIds);
          next.delete('notion');
          return next;
        });
        setCurrentView('list');
      }
      return curr;
    });
    message.success(`Integration disconnected successfully`);
  };

  const handleUpdateToolSetting = (accountId, toolKey, value) => {
    setNotionAccounts((prev) =>
      prev.map((account) => {
        if (account.id === accountId) {
          return {
            ...account,
            tools: {
              ...(account.tools || {}),
              [toolKey]: value,
            }
          };
        }
        return account;
      })
    );
    message.success(`Tool setting updated successfully`);
  };

  const getToolLabel = (val) => {
    if (val === 'off') return 'Off';
    if (val === 'ask') return 'Ask for confirmation';
    return 'Run automatically';
  };

  const toolDropdownButtonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    height: '36px',
    width: '180px',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid #d9d9d9',
    background: '#ffffff',
    color: '#262626',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: 'Inter, sans-serif',
    boxShadow: 'none',
    cursor: 'pointer',
  };

  // Custom dropdown menu component (no Ant Design Dropdown, no Portal)
  const CustomDropdown = ({ id, triggerContent, menuContent, menuWidth = 200 }) => {
    const isOpen = openDropdownId === id;
    return (
      <div data-dropdown-zone="true" style={{ position: 'relative', display: 'inline-block' }}>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setOpenDropdownId(isOpen ? null : id);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            height: '32px',
            padding: '0 10px',
            borderRadius: '6px',
            border: 'none',
            background: '#f5f5f5',
            color: '#595959',
            fontSize: '13px',
            fontWeight: '500',
            fontFamily: 'Inter, sans-serif',
            boxShadow: 'none',
            cursor: 'pointer',
          }}
        >
          {triggerContent}
          <DownOutlined style={{ fontSize: '10px', color: '#8c8c8c' }} />
        </Button>
        {isOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            zIndex: 1050,
            background: '#ffffff',
            border: '1px solid #f0f0f0',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: '8px 0',
            width: menuWidth,
          }}>
            {menuContent}
          </div>
        )}
      </div>
    );
  };

  const renderToolDropdownMenu = (accountId, toolKey) => {
    const currentVal = notionAccounts.find(a => a.id === accountId)?.tools?.[toolKey] || 'auto';
    const dropdownId = `tool-${accountId}-${toolKey}`;
    return (
      <CustomDropdown
        id={dropdownId}
        menuWidth={200}
        triggerContent={<span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: '500', color: '#262626' }}>{getToolLabel(currentVal)}</span>}
        menuContent={
          <>
            {[
              { label: 'Off', value: 'off' },
              { label: 'Run automatically', value: 'auto' },
              { label: 'Ask for confirmation', value: 'ask' }
            ].map((opt) => (
              <div
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: currentVal === opt.value ? '#f5f5f5' : 'transparent',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '14px',
                  color: '#1f1f1f',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpdateToolSetting(accountId, toolKey, opt.value);
                  setOpenDropdownId(null);
                }}
              >
                {opt.label}
                {currentVal === opt.value && <CheckOutlined style={{ color: '#1f1f1f' }} />}
              </div>
            ))}
          </>
        }
      />
    );
  };
 
  const filteredIntegrations = useMemo(() => {
    return INTEGRATIONS_DATA.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTab = activeTab === 'all' ? true : item.popular;
      const matchesConnected = showConnectedOnly ? connectedIds.has(item.id) : true;
      return matchesSearch && matchesTab && matchesConnected;
    });
  }, [connectedIds, searchQuery, activeTab, showConnectedOnly]);

  const filteredNotionAccounts = useMemo(() => {
    return notionAccounts.filter((account) =>
      account.label.toLowerCase().includes(notionSearchQuery.toLowerCase())
    );
  }, [notionAccounts, notionSearchQuery]);

  return (
    <div
      style={{
        margin: '40px auto 30px',
        padding: '0 40px',
        maxWidth: 1200,
        width: '100%',
        minHeight: '80vh',
      }}
    >
      <style>{`
        /* Override Ant Design default pink/lavender halos for inputs & buttons */
        .ant-input:focus, 
        .ant-input-focused,
        .ant-input:hover,
        .ant-input-affix-wrapper:focus,
        .ant-input-affix-wrapper-focused,
        .ant-input-affix-wrapper:hover {
          border-color: #bfbfbf !important;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05) !important;
          outline: none !important;
        }

        /* Default outline/active buttons */
        .ant-btn:focus-visible,
        .ant-btn:active {
          outline: none !important;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.04) !important;
        }

        /* Primary action button click / focus */
        .ant-btn-primary:focus,
        .ant-btn-primary:active,
        .ant-btn-primary:focus-visible {
          background: #1f1f1f !important;
          border-color: #1f1f1f !important;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08) !important;
        }

        .ant-btn-primary:hover {
          background: #333333 !important;
          border-color: #333333 !important;
          color: #ffffff !important;
        }

        /* Switch active focus ring */
        .ant-switch:focus,
        .ant-switch:focus-visible {
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08) !important;
          outline: none !important;
        }

        /* Disable all dynamic transitions and animations for Switch, Access Button, and Dropdown overlays */
        .ant-switch, 
        .ant-switch *,
        .ant-switch-handle,
        .ant-switch-handle::before,
        .ant-btn,
        .ant-btn *,
        .ant-dropdown,
        .ant-dropdown *,
        .ant-dropdown-menu,
        .ant-dropdown-menu * {
          transition: none !important;
          animation: none !important;
        }
      `}</style>
      {currentView === 'list' ? (
        <>
          {/* Header Zone */}
          <PageHeader
            title={translate('integrations')}
            ghost={false}
            extra={[
              <Input.Search
                key="search"
                placeholder={translate('search')}
                allowClear
                style={{ width: 250 }}
                onChange={(e) => setSearchQuery(e.target.value)}
                value={searchQuery}
              />,
              <Button
                key="add-custom"
                type="default"
                icon={<PlusOutlined />}
                style={{
                  borderRadius: '6px',
                  borderColor: '#d9d9d9',
                  color: '#595959',
                  height: '36px',
                  fontSize: '14px',
                  fontWeight: 500,
                  boxShadow: '0 2px 0 rgba(0, 0, 0, 0.016)',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                onClick={() => message.info(translate('custom_mcp_coming_soon'))}
              >
                {translate('add_custom_mcp')}
              </Button>,
            ]}
            style={{ padding: '20px 0px' }}
          >
            <p style={{ color: '#595959', fontSize: '15px', margin: '0 0 16px 0', fontFamily: 'Inter, system-ui, sans-serif' }}>
              {translate('integrations_subtitle')}
            </p>
          </PageHeader>

          {/* Grid of integration cards */}
          <Row gutter={[24, 24]}>
            {filteredIntegrations.map((item) => {
              const isConnected = connectedIds.has(item.id);
              return (
                <Col xs={24} sm={12} md={8} key={item.id}>
                  <div
                    className={`whiteBox shadow integration-card${isConnected ? ' integration-card--connected' : ''}`}
                    onClick={() => handleToggleConnection(item.id, item.name)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Logo — always visible, no animation */}
                    <div className="integration-card__logo">
                      {item.logo}
                    </div>

                    {/* Text area — clips the two sliding layers */}
                    <div className="integration-card__text-area">
                      {/* Name + tag: slides up and out on hover */}
                      <div className="integration-card__name-row">
                        <span
                          style={{
                            fontWeight: '500',
                            fontSize: '16px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontFamily: 'Inter, system-ui, sans-serif',
                          }}
                        >
                          {item.name}
                        </span>
                        <div>
                          {isConnected ? (
                            <Tag
                              color="success"
                              style={{ borderRadius: '12px', border: 'none', padding: '2px 10px', fontSize: '12px', fontWeight: '500', margin: 0 }}
                            >
                              {translate('connected')}
                            </Tag>
                          ) : (
                            <Tag
                              color="default"
                              style={{ borderRadius: '12px', border: '1px solid #d9d9d9', background: '#ffffff', color: '#8c8c8c', padding: '2px 10px', fontSize: '12px', fontWeight: '500', margin: 0 }}
                            >
                              {translate('connect')}
                            </Tag>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>

          {/* Empty State */}
          {filteredIntegrations.length === 0 && (
            <div
              className="whiteBox shadow"
              style={{
                background: '#ffffff',
                padding: '60px 20px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #eeeeee',
                color: '#8c8c8c',
                fontSize: '15px',
              }}
            >
              {translate('no_integrations_found')}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Breadcrumbs */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '24px', fontSize: '14px', fontFamily: 'Inter, sans-serif' }}>
            <span
              onClick={() => setCurrentView('list')}
              style={{ color: '#8c8c8c', cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.target.style.color = '#595959'}
              onMouseLeave={(e) => e.target.style.color = '#8c8c8c'}
            >
              Integrations
            </span>
            <span style={{ color: '#bfbfbf' }}>&gt;</span>
            <span style={{ color: '#1f1f1f', fontWeight: '500' }}>Notion</span>
          </div>

          {/* Title Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg fill="#000000" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ width: '32px', height: '32px' }}>
                <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
              </svg>
              <h1 style={{ fontSize: '32px', fontWeight: '600', color: '#1f1f1f', margin: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
                Notion
              </h1>
            </div>

            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setNickname(`Account ${notionAccounts.length + 1}`);
                setIsNotionModalOpen(true);
              }}
              style={{
                height: '38px',
                borderRadius: '8px',
                border: '1px solid #d9d9d9',
                color: '#262626',
                fontWeight: '500',
                fontFamily: 'Inter, sans-serif',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Add another account
            </Button>
          </div>

          {/* Accounts Count */}
          <div style={{ color: '#8c8c8c', fontSize: '14px', marginBottom: '12px', fontFamily: 'Inter, sans-serif' }}>
            {filteredNotionAccounts.length} {filteredNotionAccounts.length === 1 ? 'account' : 'accounts'} connected
          </div>

          {/* Table of Accounts */}
          {filteredNotionAccounts.length > 0 ? (
            <>
              <div style={{
                background: '#ffffff',
                border: '1px solid #eeeeee',
                borderRadius: '12px',
                overflow: 'visible',
                boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'Inter, sans-serif' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                      <th style={{ padding: '16px 24px', color: '#595959', fontSize: '13px', fontWeight: '500', width: '35%' }}>Account label</th>
                      <th style={{ padding: '16px 24px', color: '#595959', fontSize: '13px', fontWeight: '500', width: '35%' }}>Added by</th>
                      <th style={{ padding: '16px 24px', color: '#595959', fontSize: '13px', fontWeight: '500', width: '30%' }}>Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNotionAccounts.map((account, idx) => {
                      const isExpanded = selectedAccountId === account.id;
                      return (
                        <Fragment key={account.id}>
                          <tr
                            onClick={(e) => handleRowClick(e, account.id)}
                            style={{
                              borderBottom: (isExpanded || idx < filteredNotionAccounts.length - 1) ? '1px solid #f0f0f0' : 'none',
                              cursor: 'pointer',
                              background: isExpanded ? '#fafafa' : 'transparent',
                              transition: 'background-color 0.2s',
                            }}
                          >
                            <td style={{ padding: '18px 24px', color: '#1f1f1f', fontSize: '14px', fontWeight: '500' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#52c41a', display: 'inline-block' }} />
                                  {account.label}
                                </span>
                                {!isExpanded && (
                                  <span style={{ fontSize: '12px', color: '#8c8c8c', fontWeight: 'normal', marginTop: '4px', paddingLeft: '14px' }}>
                                    Click to configure settings & tools
                                  </span>
                                )}
                              </div>
                            </td>
                             <td style={{ padding: '18px 24px', color: '#595959', fontSize: '14px' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: '#eeeeee',
                                  color: '#595959',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  textTransform: 'uppercase',
                                }}>
                                  {account.addedBy.charAt(0)}
                                </span>
                                {account.addedBy}
                              </span>
                            </td>
                            <td style={{ padding: '12px 24px', color: '#595959', fontSize: '14px' }}>
                              <CustomDropdown
                                id={'access-' + account.id}
                                menuWidth={240}
                                triggerContent={
                                  account.access === 'team' ? (
                                    <><UserOutlined /> Team-only</>
                                  ) : (
                                    <><LockOutlined /> Private (Invite only)</>
                                  )
                                }
                                menuContent={
                                  <>
                                    <div style={{ padding: '8px 16px 4px', fontSize: '12px', color: '#8c8c8c', fontWeight: '500', fontFamily: 'Inter, sans-serif' }}>
                                      Who should have access?
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '10px 16px',
                                        cursor: 'pointer',
                                        background: account.access === 'team' ? '#f5f5f5' : 'transparent',
                                        fontFamily: 'Inter, sans-serif',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateAccountAccess(account.id, 'team');
                                        setOpenDropdownId(null);
                                      }}
                                    >
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#1f1f1f' }}>
                                        <UserOutlined /> Team-only
                                      </span>
                                      {account.access === 'team' && <CheckOutlined style={{ color: '#1f1f1f' }} />}
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '10px 16px',
                                        cursor: 'pointer',
                                        background: account.access === 'private' ? '#f5f5f5' : 'transparent',
                                        fontFamily: 'Inter, sans-serif',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateAccountAccess(account.id, 'private');
                                        setOpenDropdownId(null);
                                      }}
                                    >
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#1f1f1f' }}>
                                        <LockOutlined /> Private (Invite only)
                                      </span>
                                      {account.access === 'private' && <CheckOutlined style={{ color: '#1f1f1f' }} />}
                                    </div>
                                  </>
                                }
                              />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr
                              style={{
                                background: '#fafafa',
                                borderBottom: idx < filteredNotionAccounts.length - 1 ? '1px solid #f0f0f0' : 'none',
                              }}
                            >
                              <td colSpan={3} style={{ padding: '0 24px 24px 24px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', marginTop: '16px' }}>
                                  {/* Tab Navigation Header */}
                                  <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0', paddingBottom: '0', gap: '32px' }}>
                                    <span
                                      onClick={() => setActiveSubTab('settings')}
                                      style={{
                                        fontSize: '15px',
                                        fontWeight: '600',
                                        color: activeSubTab === 'settings' ? '#1f1f1f' : '#8c8c8c',
                                        borderBottom: activeSubTab === 'settings' ? '2px solid #1f1f1f' : 'none',
                                        paddingBottom: '12px',
                                        cursor: 'pointer',
                                        fontFamily: 'Inter, sans-serif',
                                        transition: 'all 0.3s',
                                      }}
                                    >
                                      Settings
                                    </span>
                                    <span
                                      onClick={() => setActiveSubTab('tools')}
                                      style={{
                                        fontSize: '15px',
                                        fontWeight: '600',
                                        color: activeSubTab === 'tools' ? '#1f1f1f' : '#8c8c8c',
                                        borderBottom: activeSubTab === 'tools' ? '2px solid #1f1f1f' : 'none',
                                        paddingBottom: '12px',
                                        cursor: 'pointer',
                                        fontFamily: 'Inter, sans-serif',
                                        transition: 'all 0.3s',
                                      }}
                                    >
                                      Tools
                                    </span>
                                  </div>

                                  {/* Sub-panel Content */}
                                  <div style={{
                                    background: '#ffffff',
                                    border: '1px solid #eeeeee',
                                    borderRadius: '12px',
                                    padding: '32px',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.01)',
                                  }}>
                                    {activeSubTab === 'settings' ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                                        {/* Account Label */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                          <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                            Account label
                                          </span>
                                          <span style={{ color: '#8c8c8c', fontSize: '13px', fontFamily: 'Inter, sans-serif' }}>
                                            Viktor uses the label to tell your connections apart
                                          </span>
                                          <Input
                                            value={account.label}
                                            onChange={(e) => handleUpdateAccountLabel(account.id, e.target.value)}
                                            style={{
                                              height: '44px',
                                              borderRadius: '8px',
                                              fontSize: '14px',
                                              padding: '0 16px',
                                              border: '1px solid #d9d9d9',
                                              background: '#fcfcfc',
                                              color: '#1f1f1f',
                                              fontFamily: 'Inter, sans-serif',
                                              marginTop: '8px',
                                              maxWidth: '100%',
                                            }}
                                          />
                                        </div>

                                        {/* Enable Integration */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                              Enable integration
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: '13px', fontFamily: 'Inter, sans-serif' }}>
                                              Allow Viktor to use this Notion connection
                                            </span>
                                          </div>
                                          <Switch
                                            checked={account.enabled !== false}
                                            onChange={(checked) => handleUpdateAccountEnabled(account.id, checked)}
                                            style={{ background: (account.enabled !== false) ? '#1f1f1f' : '#e8e8e8' }}
                                          />
                                        </div>

                                        {/* Lock Integration */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                              Lock integration
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: '13px', fontFamily: 'Inter, sans-serif' }}>
                                              Only admins can make changes while locked.
                                            </span>
                                          </div>
                                          <Switch
                                            checked={account.locked === true}
                                            onChange={(checked) => handleUpdateAccountLocked(account.id, checked)}
                                            style={{ background: (account.locked === true) ? '#1f1f1f' : '#e8e8e8' }}
                                          />
                                        </div>

                                        {/* Disconnect Integration */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                          <span style={{ color: '#ff4d4f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                            Disconnect integration
                                          </span>
                                          <span style={{ color: '#8c8c8c', fontSize: '13px', fontFamily: 'Inter, sans-serif' }}>
                                            Remove this connection and revoke Viktor's access.
                                          </span>
                                          <Button
                                            danger
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '8px',
                                              height: '38px',
                                              width: 'fit-content',
                                              borderRadius: '8px',
                                              border: '1px solid #ffccc7',
                                              background: '#fff2f0',
                                              color: '#ff4d4f',
                                              fontWeight: '500',
                                              fontFamily: 'Inter, sans-serif',
                                              fontSize: '13px',
                                              cursor: 'pointer',
                                              marginTop: '8px',
                                            }}
                                            onClick={() => handleDisconnectAccount(account.id)}
                                          >
                                            <svg fill="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px' }}>
                                              <path d="M19.78 11.22l-1.44 1.44-4.56-4.56 1.44-1.44c1.17-1.17 3.07-1.17 4.24 0l.32.32c1.17 1.17 1.17 3.07 0 4.24zM11.5 13.5l-4.56-4.56 1.44-1.44 4.56 4.56-1.44 1.44zM3 21h4.5c.28 0 .5-.22.5-.5v-4.5c0-.28-.22-.5-.5-.5H6v-1.5c0-.83.67-1.5 1.5-1.5H9v-1.5H7.5C5.01 11 3 13.01 3 15.5V21zm10.5-10.5V9H12v1.5c0 .83-.67 1.5-1.5 1.5H9v1.5h1.5c2.49 0 4.5-2.01 4.5-4.5zM21 3h-4.5c-.28 0-.5.22-.5.5v4.5c0 .28.22.5.5.5H18v1.5c0 .83-.67 1.5-1.5 1.5H15v1.5h1.5c2.49 0 4.5-2.01 4.5-4.5V3z" />
                                            </svg>
                                            Disconnect integration
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                                        {/* Notion Get Users */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, paddingRight: '40px' }}>
                                            <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                              Notion Get Users
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: '13px', lineHeight: '1.5', fontFamily: 'Inter, sans-serif' }}>
                                              Retrieves a list of users in the current workspace. Shows workspace members and guests with their IDs, names, emails (if available), and types (person or bot). Supports cursor-based pagination to iterate through all users in the workspace....
                                            </span>
                                          </div>
                                          {renderToolDropdownMenu(account.id, 'getUsers')}
                                        </div>

                                        {/* Notion Update Data Source */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '24px', borderBottom: '1px solid #f0f0f0' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, paddingRight: '40px' }}>
                                            <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                              Notion Update Data Source
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: '13px', lineHeight: '1.5', fontFamily: 'Inter, sans-serif' }}>
                                              Update a Notion data source's schema, title, or attributes using SQL DDL statements. Returns Markdown showing updated structure and schema. Accepts a data source ID (collection ID from fetch response's &lt;data-source&gt; tag) or a single-source...
                                            </span>
                                          </div>
                                          {renderToolDropdownMenu(account.id, 'updateDataSource')}
                                        </div>

                                        {/* Notion Get Comments */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, paddingRight: '40px' }}>
                                            <span style={{ color: '#1f1f1f', fontSize: '15px', fontWeight: '600', fontFamily: 'Inter, sans-serif' }}>
                                              Notion Get Comments
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: '13px', lineHeight: '1.5', fontFamily: 'Inter, sans-serif' }}>
                                              Get comments and discussions from a Notion page. Returns discussions with full comment content in XML format. By default, returns page-level discussions only. Tip: Use the `fetch` tool with `include_discussions: true` first to see where...
                                            </span>
                                          </div>
                                          {renderToolDropdownMenu(account.id, 'getComments')}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div
              style={{
                background: '#ffffff',
                padding: '60px 20px',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #eeeeee',
                color: '#8c8c8c',
                fontSize: '15px',
              }}
            >
              No connected accounts found
            </div>
          )}
        </>
      )}

      {/* Premium WhatsApp Connection Modal (Image 1 Style + Image 2 Content Refined) */}
      <Modal
        title={
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#1f1f1f', fontFamily: 'Inter, system-ui, sans-serif', paddingBottom: '16px', borderBottom: '1px solid #f0f0f0' }}>
            Connect a WhatsApp account
          </div>
        }
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        width={640}
        centered
        styles={{
          content: {
            borderRadius: '16px',
            padding: '24px 32px',
          }
        }}
      >
        <div style={{ display: 'flex', gap: '32px', padding: '24px 0 8px', alignItems: 'center' }}>
          {/* Left Column: Instructions */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '14px', color: '#595959', fontSize: '14px', lineHeight: '1.6' }}>
              <li>Open WhatsApp on your phone</li>
              <li>Tap <strong style={{ color: '#262626' }}>"You"</strong>, then under <strong style={{ color: '#262626' }}>"Settings"</strong> select <strong style={{ color: '#262626' }}>"Linked Devices"</strong></li>
              <li>Tap on <strong style={{ color: '#262626' }}>Link a device</strong></li>
              <li>Point your phone to this screen to capture the QR code</li>
            </ol>
          </div>

          {/* Right Column: QR Code (More compact and elegant) */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ border: '1px solid #e8e8e8', borderRadius: '12px', padding: '12px', background: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
              <img
                src={whatsappQr}
                alt="Scan to Login"
                style={{ width: '160px', height: '160px', display: 'block', objectFit: 'contain' }}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Premium Notion Connection Modal */}
      <Modal
        open={isNotionModalOpen}
        onCancel={() => setIsNotionModalOpen(false)}
        footer={null}
        width={560}
        centered
        styles={{
          content: {
            borderRadius: '16px',
            padding: '32px 32px 28px 32px',
          }
        }}
      >
        {/* Title */}
        <h2 style={{ fontSize: '24px', fontWeight: '500', color: '#1f1f1f', margin: '0 0 24px 0', fontFamily: 'Inter, system-ui, sans-serif' }}>
          Connect a Notion account
        </h2>

        {/* Form Field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
          <span style={{ color: '#595959', fontSize: '13px', fontWeight: '500', fontFamily: 'Inter, sans-serif' }}>
            Nickname for this account
          </span>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            style={{
              height: '44px',
              borderRadius: '8px',
              fontSize: '14px',
              padding: '0 16px',
              border: isInputFocused ? '1px solid #bfbfbf' : '1px solid #d9d9d9',
              background: '#fcfcfc',
              color: '#1f1f1f',
              fontFamily: 'Inter, sans-serif',
              boxShadow: isInputFocused ? '0 0 0 2px rgba(0, 0, 0, 0.06)' : 'none',
              outline: 'none',
              transition: 'all 0.2s',
            }}
          />
          <span style={{ color: '#8c8c8c', fontSize: '12px', fontFamily: 'Inter, sans-serif' }}>
            Just a label to tell your accounts apart.
          </span>
        </div>

        {/* Bottom Actions Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '28px' }}>
          {/* Access Dropdown Button */}
          <Dropdown
            dropdownRender={() => (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#ffffff',
                  border: '1px solid #f0f0f0',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '8px 0',
                  width: '240px',
                }}
              >
                <div style={{ padding: '8px 16px 4px', fontSize: '12px', color: '#8c8c8c', fontWeight: '500', fontFamily: 'Inter, sans-serif' }}>
                  Who should have access?
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: accessType === 'team' ? '#f5f5f5' : 'transparent',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  onClick={() => {
                    setAccessType('team');
                    setIsDropdownOpen(false);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#1f1f1f' }}>
                    <UserOutlined /> Team-only
                  </span>
                  {accessType === 'team' && <CheckOutlined style={{ color: '#1f1f1f' }} />}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: accessType === 'private' ? '#f5f5f5' : 'transparent',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  onClick={() => {
                    setAccessType('private');
                    setIsDropdownOpen(false);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#1f1f1f' }}>
                    <LockOutlined /> Private (Invite only)
                  </span>
                  {accessType === 'private' && <CheckOutlined style={{ color: '#1f1f1f' }} />}
                </div>
              </div>
            )}
            trigger={['click']}
            open={isDropdownOpen}
            onOpenChange={setIsDropdownOpen}
          >
            <Button style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              height: '36px',
              padding: '0 12px',
              borderRadius: '8px',
              border: 'none',
              background: '#f5f5f5',
              color: '#595959',
              fontSize: '13px',
              fontWeight: '500',
              fontFamily: 'Inter, sans-serif',
              boxShadow: 'none',
              cursor: 'pointer',
            }}>
              {accessType === 'team' ? (
                <>
                  <UserOutlined /> Team-only
                </>
              ) : (
                <>
                  <LockOutlined /> Private (Invite only)
                </>
              )}
              <DownOutlined style={{ fontSize: '10px', color: '#8c8c8c' }} />
            </Button>
          </Dropdown>

          {/* Continue CTA Button */}
          <Button
            type="primary"
            style={{
              height: '38px',
              padding: '0 20px',
              borderRadius: '8px',
              background: '#1f1f1f',
              borderColor: '#1f1f1f',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: '500',
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
            }}
            onClick={() => {
              setConnectedIds((prev) => {
                const next = new Set(prev);
                next.add('notion');
                return next;
              });
              
              setNotionAccounts((prev) => {
                const existingIndex = prev.findIndex(a => a.label === nickname);
                if (existingIndex > -1) {
                  // Edit existing account
                  const nextAccounts = [...prev];
                  nextAccounts[existingIndex] = {
                    ...nextAccounts[existingIndex],
                    access: accessType,
                  };
                  return nextAccounts;
                } else {
                  // Add new account
                  return [
                    ...prev,
                    {
                      id: Date.now().toString(),
                      label: nickname,
                      access: accessType,
                      addedBy: 'will.ziheng',
                      enabled: true,
                      locked: false,
                      tools: {
                        getUsers: 'auto',
                        updateDataSource: 'auto',
                        getComments: 'auto',
                      }
                    }
                  ];
                }
              });
              
              setIsNotionModalOpen(false);
              setCurrentView('notion');
              message.success(`Notion connected successfully under "${nickname}"`);
            }}
          >
            Continue to Notion
          </Button>
        </div>
      </Modal>
    </div>
  );
}
