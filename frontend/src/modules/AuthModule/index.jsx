import useLanguage from '@/locale/useLanguage';
import { Typography } from 'antd';
import AuthLayout from '@/layout/AuthLayout';

const { Title } = Typography;

const AuthModule = ({ authContent, AUTH_TITLE }) => {
  const translate = useLanguage();
  return (
    <AuthLayout>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <Title
          level={1}
          style={{
            margin: 0,
            fontSize: '28px',
            fontWeight: 600,
            color: '#111827',
            letterSpacing: '-0.5px',
          }}
        >
          {translate(AUTH_TITLE)}
        </Title>
      </div>

      <div className="site-layout-content">{authContent}</div>
    </AuthLayout>
  );
};

export default AuthModule;
