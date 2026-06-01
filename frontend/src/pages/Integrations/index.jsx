import { useState, useMemo } from 'react';
import { Button, Input, Switch, Row, Col, Tag, Segmented, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout';
import useLanguage from '@/locale/useLanguage';

// Data lives outside the component so it is never recreated on render.
// Descriptions are looked up by key at render time so language switches work.
const INTEGRATIONS_DATA = [
  {
    id: 'google_ads',
    name: 'Google Ads',
    connected: true,
    popular: true,
    descriptionKey: 'integration_desc_google_ads',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
  },
  {
    id: 'linear',
    name: 'Linear',
    connected: true,
    popular: true,
    descriptionKey: 'integration_desc_linear',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="#000000">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 4.89c2.72.33 4.85 2.46 5.18 5.18h-5.18V6.89zm-2 0v5.18H5.82c.33-2.72 2.46-4.85 5.18-5.18zm0 7.18v5.18c-2.72-.33-4.85-2.46-5.18-5.18h5.18zm2 5.18v-5.18h5.18c-.33 2.72-2.46 4.85-5.18 5.18z"/>
      </svg>
    ),
  },
  {
    id: 'notion',
    name: 'Notion',
    connected: false,
    popular: true,
    descriptionKey: 'integration_desc_notion',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="#000000">
        <path d="M3 3h18v18H3V3zm3 3v12h3V9l6 9h3V6h-3v9L9 6H6z"/>
      </svg>
    ),
  },
  {
    id: 'apollo',
    name: 'Apollo',
    connected: false,
    popular: false,
    descriptionKey: 'integration_desc_apollo',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22">
        <rect width="24" height="24" rx="6" fill="#D2F135"/>
        <path d="M12 6v12M6 12h12M8.17 8.17l7.66 7.66M8.17 15.83l7.66-7.66" stroke="#000000" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'sentry',
    name: 'Sentry',
    connected: false,
    popular: false,
    descriptionKey: 'integration_desc_sentry',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" strokeWidth="2.5">
        <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9z"/>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>
      </svg>
    ),
  },
  {
    id: 'vercel',
    name: 'Vercel',
    connected: false,
    popular: true,
    descriptionKey: 'integration_desc_vercel',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="#000000">
        <polygon points="12,3 22,21 2,21"/>
      </svg>
    ),
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    connected: false,
    popular: true,
    descriptionKey: 'integration_desc_whatsapp',
    logo: (
      <svg viewBox="0 0 24 24" width="22" height="22">
        <path fill="#25D366" d="M12.012 2c-5.506 0-9.97 4.463-9.97 9.969 0 1.761.458 3.479 1.332 4.992L2 22l5.22-.1.08-.04a9.907 9.907 0 0 0 4.712 1.18h.003c5.503 0 9.967-4.462 9.967-9.97 0-2.668-1.04-5.176-2.927-7.065C17.168 4.116 14.66 3 12.012 3zm0 .97c2.404 0 4.665.937 6.368 2.639 1.703 1.702 2.64 3.963 2.64 6.367 0 4.968-4.043 9.01-9.01 9.01a8.966 8.966 0 0 1-4.576-1.25l-.328-.194-3.4.654.666-3.32-.213-.34a8.956 8.956 0 0 1-1.37-4.707 9.011 9.011 0 0 1 9.013-9.01zM8.337 7.28c-.148 0-.396.055-.604.28-.208.226-.792.775-.792 1.89s.812 2.193.926 2.348c.114.156 1.597 2.438 3.868 3.417.54.233.96.372 1.288.476.543.172 1.037.148 1.428.09.435-.064 1.34-.548 1.53-1.077.19-.529.19-.982.133-1.077-.057-.095-.208-.152-.435-.265-.227-.113-1.34-.662-1.548-.737-.208-.075-.36-.113-.51.113-.151.226-.585.737-.718.888-.132.15-.264.17-.49.057-.227-.114-.958-.353-1.826-1.127-.675-.602-1.13-1.346-1.263-1.572-.132-.226-.014-.349.1-.462.102-.102.227-.264.34-.396.113-.132.15-.227.227-.378.075-.15.038-.283-.019-.396-.057-.113-.51-1.228-.699-1.68-.184-.442-.363-.383-.497-.39l-.424-.008z" />
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

  // TODO: replace with Redux dispatch + real backend endpoint when integration backend is wired
  const handleToggleConnection = (id, name) => {
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

  const filteredIntegrations = useMemo(() => {
    return INTEGRATIONS_DATA.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTab = activeTab === 'all' ? true : item.popular;
      const matchesConnected = showConnectedOnly ? connectedIds.has(item.id) : true;
      return matchesSearch && matchesTab && matchesConnected;
    });
  }, [connectedIds, searchQuery, activeTab, showConnectedOnly]);

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

      {/* Tabs and Show Connected Switch Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Segmented
          options={[
            { label: translate('all_integrations'), value: 'all' },
            { label: translate('popular_integrations'), value: 'popular' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#8c8c8c', fontSize: '14px', fontFamily: 'Inter, sans-serif' }}>
            {translate('show_connected_only')}
          </span>
          <Switch
            checked={showConnectedOnly}
            onChange={(checked) => setShowConnectedOnly(checked)}
            style={{ background: showConnectedOnly ? '#52c41a' : '#bfbfbf' }}
          />
        </div>
      </div>

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
                        color: '#1f1f1f',
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

                  {/* Description: slides up from below on hover */}
                  <div className="integration-card__description">
                    {translate(item.descriptionKey)}
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
    </div>
  );
}
