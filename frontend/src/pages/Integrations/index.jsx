import { useState, useMemo } from 'react';
import { Button, Input, Switch, Row, Col, Tag, Segmented, message, Modal } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
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

  // TODO: replace with Redux dispatch + real backend endpoint when integration backend is wired
  const handleToggleConnection = (id, name) => {
    if (id === 'whatsapp' && !connectedIds.has('whatsapp')) {
      setIsModalOpen(true);
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

      {/* Tabs and Show Connected Switch Bar commented out as currently not needed */}
      {/* 
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
      */}

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
    </div>
  );
}
