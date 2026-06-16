import useLanguage from '@/locale/useLanguage';
import { Typography } from 'antd';
import AuthLayout from '@/layout/AuthLayout';
import './AuthModule.css';

const { Title } = Typography;

const AuthModule = ({ authContent, AUTH_TITLE }) => {
  const translate = useLanguage();
  return (
    <AuthLayout>
      <div className="auth-module-header">
        <Title level={1} className="auth-module-title">
          {translate(AUTH_TITLE)}
        </Title>
      </div>

      <div className="site-layout-content">{authContent}</div>
    </AuthLayout>
  );
};

export default AuthModule;
