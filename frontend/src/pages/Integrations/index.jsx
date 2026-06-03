import { useState, useMemo, useEffect, useRef } from 'react';
import { Button, Input, Switch, Row, Col, message, Modal, QRCode, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout';
import useLanguage from '@/locale/useLanguage';
import whatsappLogo from '@/style/images/whatsapp.png';
import { waLogin, waStatus, waLogout } from '@/request/whatsapp';

// Data lives outside the component so it is never recreated on render.
// Descriptions are looked up by key at render time so language switches work.
const INTEGRATIONS_DATA = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
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

// Observed bridge status → i18n label key + accent color.
const STATUS_LABEL_KEY = {
  disconnected: 'whatsapp_status_disconnected',
  qr_pending: 'whatsapp_status_connecting',
  connected: 'whatsapp_status_connected',
};
const STATUS_COLOR = {
  disconnected: '#8c8c8c',
  qr_pending: '#1677ff',
  connected: '#52c41a',
};
// logged_out / unknown collapse to "not connected" in the UI — no separate display.
const labelKeyFor = (s) => STATUS_LABEL_KEY[s] || STATUS_LABEL_KEY.disconnected;
const colorFor = (s) => STATUS_COLOR[s] || STATUS_COLOR.disconnected;
const POLL_MS = 2500;

export default function IntegrationsPage() {
  const translate = useLanguage();

  const [searchQuery, setSearchQuery] = useState('');
  // Tabs / "connected only" bar is commented out below; these stay constant until it returns.
  const activeTab = 'all';
  const showConnectedOnly = false;
  const [isModalOpen, setIsModalOpen] = useState(false);

  // WhatsApp live state, pulled from the bridge via the CRM proxy.
  const [waStatusValue, setWaStatusValue] = useState('disconnected');
  const [waQr, setWaQr] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const isItemConnected = (item) => item.id === 'whatsapp' && waStatusValue === 'connected';

  // Map an error to the right localized toast (503 = gateway down).
  const toastError = (err) =>
    message.error(
      translate(err?.response?.status === 503 ? 'whatsapp_gateway_unavailable' : 'whatsapp_connect_failed')
    );

  const applyStatus = (result) => {
    const next = result?.status || 'disconnected';
    setWaStatusValue(next);
    setWaQr(result?.qr || null);
    if (next === 'connected') {
      stopPolling();
      setIsModalOpen(false);
      message.success(`WhatsApp ${translate('integration_connected')}`);
    }
  };

  const pollOnce = async () => {
    try {
      const res = await waStatus();
      applyStatus(res.result);
    } catch (err) {
      stopPolling();
      setIsModalOpen(false);
      setWaStatusValue('disconnected');
      toastError(err);
    }
  };

  const startPolling = () => {
    stopPolling();
    pollOnce(); // fire immediately so the QR shows without waiting a full interval
    pollRef.current = setInterval(pollOnce, POLL_MS);
  };

  const handleConnect = async () => {
    setWaQr(null);
    setIsModalOpen(true);
    try {
      const res = await waLogin();
      setWaStatusValue(res.result?.status || 'qr_pending');
      startPolling();
    } catch (err) {
      setIsModalOpen(false);
      setWaStatusValue('disconnected');
      toastError(err);
    }
  };

  const confirmDisconnect = () => {
    Modal.confirm({
      title: translate('whatsapp_disconnect_confirm'),
      okText: translate('whatsapp_disconnect'),
      cancelText: translate('cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await waLogout();
          stopPolling();
          setWaStatusValue('disconnected');
          setWaQr(null);
          message.info(`WhatsApp ${translate('integration_disconnected')}`);
        } catch (err) {
          toastError(err);
        }
      },
    });
  };

  const handleSwitch = (checked) => {
    if (checked) handleConnect();
    else confirmDisconnect();
  };

  // Closing the QR dialog before scanning cancels the attempt: stop polling,
  // tear down the pending bridge client, and return to a clean "not connected"
  // instead of a stuck "connecting".
  const handleModalCancel = () => {
    setIsModalOpen(false);
    if (waStatusValue === 'qr_pending') {
      stopPolling();
      setWaQr(null);
      setWaStatusValue('disconnected');
      waLogout().catch((err) => console.warn('WhatsApp connect cancel teardown failed:', err?.message));
    }
  };

  // Pull current status once on open (self-heals a stale UI); stop polling on unmount.
  useEffect(() => {
    (async () => {
      try {
        const res = await waStatus();
        setWaStatusValue(res.result?.status || 'disconnected');
        setWaQr(res.result?.qr || null);
      } catch {
        // Silent on initial load — don't error-toast just for opening the page.
      }
    })();
    return () => stopPolling();
  }, []);

  const filteredIntegrations = useMemo(() => {
    return INTEGRATIONS_DATA.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTab = activeTab === 'all' ? true : item.popular;
      const matchesConnected = showConnectedOnly ? isItemConnected(item) : true;
      return matchesSearch && matchesTab && matchesConnected;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, activeTab, showConnectedOnly, waStatusValue]);

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
          const isConnected = isItemConnected(item);
          const statusValue = item.id === 'whatsapp' ? waStatusValue : 'disconnected';
          return (
            <Col xs={24} sm={12} md={8} key={item.id}>
              <div
                className={`whiteBox shadow integration-card${isConnected ? ' integration-card--connected' : ''}`}
                style={{ cursor: 'default' }}
              >
                {/* Logo — always visible, no animation */}
                <div className="integration-card__logo">
                  {item.logo}
                </div>

                {/* Text area — clips the two sliding layers */}
                <div className="integration-card__text-area">
                  {/* Name + status/switch */}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: colorFor(statusValue) }}>
                        {translate(labelKeyFor(statusValue))}
                      </span>
                      <Switch
                        checked={isConnected}
                        onChange={handleSwitch}
                      />
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

      {/* WhatsApp Connection Modal — live QR from the bridge */}
      <Modal
        title={
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#1f1f1f', fontFamily: 'Inter, system-ui, sans-serif', paddingBottom: '16px', borderBottom: '1px solid #f0f0f0' }}>
            {translate('whatsapp_modal_title')}
          </div>
        }
        open={isModalOpen}
        onCancel={handleModalCancel}
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
              <li>{translate('whatsapp_step_1')}</li>
              <li>{translate('whatsapp_step_2')}</li>
              <li>{translate('whatsapp_step_3')}</li>
              <li>{translate('whatsapp_step_4')}</li>
            </ol>
          </div>

          {/* Right Column: live QR (or a spinner while the bridge generates it) */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ border: '1px solid #e8e8e8', borderRadius: '12px', padding: '12px', background: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
              {waQr ? (
                <QRCode value={waQr} size={160} bordered={false} />
              ) : (
                <div style={{ width: 184, height: 184, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#8c8c8c', fontSize: 13 }}>
                  <Spin />
                  <span>{translate('whatsapp_generating_qr')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
