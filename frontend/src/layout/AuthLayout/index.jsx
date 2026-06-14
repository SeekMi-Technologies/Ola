import { Layout, Card } from 'antd';
import { GlobalOutlined, FileTextOutlined } from '@ant-design/icons';
import LanguageToggle from '@/components/LanguageToggle';
import useLanguage from '@/locale/useLanguage';
import logo from '@/style/images/OLA_LOGO.svg';
import './AuthLayout.css';

export default function AuthLayout({ children }) {
  const translate = useLanguage();

  return (
    <Layout className="auth-layout">
      {/* 外置 Logo - 位于卡片顶部中央 */}
      <div className="auth-layout-logo">
        <img
          src={logo}
          alt="Ola Logo"
          className="auth-layout-logo-img"
        />
      </div>

      {/* 原生 Ant Design Card 容器 */}
      <Card
        bordered
        className="auth-layout-card"
      >
        {children}
      </Card>

      {/* 外置 Footer - 位于卡片底部中央，右侧为语言 Select 与 Support */}
      <div className="auth-layout-footer">
        <span>© 2026 Ola科技有限公司</span>
        <div className="auth-layout-footer-actions">
          <div className="auth-layout-footer-locale">
            <GlobalOutlined className="auth-layout-footer-icon" />
            <LanguageToggle variant="select" />
          </div>
          <span className="auth-layout-footer-separator">|</span>
          <a href="mailto:ola@olatech.ai" className="auth-layout-footer-link">
            <FileTextOutlined className="auth-layout-footer-support-icon" />
            {translate('support')}
          </a>
        </div>
      </div>
    </Layout>
  );
}
