import { Layout, Card } from 'antd';
import { GlobalOutlined, FileTextOutlined } from '@ant-design/icons';
import LanguageToggle from '@/components/LanguageToggle';
import useLanguage from '@/locale/useLanguage';
import logo from '@/style/images/OLA_LOGO.svg';

export default function AuthLayout({ children }) {
  const translate = useLanguage();

  return (
    <Layout
      style={{
        minHeight: '100vh',
        background: '#F9FAFB', // 现代淡灰背景
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '40px 24px 32px',
      }}
    >
      {/* 外置 Logo - 位于卡片顶部中央 */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <img
          src={logo}
          alt="Ola Logo"
          style={{
            height: '36px',
            width: 'auto',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* 原生 Ant Design Card 容器 */}
      <Card
        bordered={true}
        style={{
          width: '100%',
          maxWidth: '460px',
          borderRadius: '16px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
        styles={{
          body: { padding: '40px 32px' },
        }}
      >
        {children}
      </Card>

      {/* 外置 Footer - 位于卡片底部中央，右侧为语言 Select 与 Support */}
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#9CA3AF',
          fontSize: '13px',
          marginTop: '32px',
        }}
      >
        <span>© 2026 OLA Technologies, Inc.</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <GlobalOutlined style={{ color: '#9CA3AF', fontSize: '13px' }} />
            <LanguageToggle variant="select" />
          </div>
          <span style={{ color: '#E5E7EB' }}>|</span>
          <a href="mailto:ola@olatech.ai" className="auth-layout-footer-link">
            <FileTextOutlined style={{ fontSize: '13px' }} />
            {translate('support')}
          </a>
        </div>
      </div>
    </Layout>
  );
}
