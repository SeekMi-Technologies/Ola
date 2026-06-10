import { Space, Layout, Divider, Typography } from 'antd';
import logo from '@/style/images/OLA_LOGO.svg';
import useLanguage from '@/locale/useLanguage';
import { useSelector } from 'react-redux';

const { Content } = Layout;
const { Title, Text } = Typography;

export default function SideContent() {
  const translate = useLanguage();

  return (
    <Content
      style={{
        padding: '150px 30px 30px',
        width: '100%',
        maxWidth: '400px',
        margin: '0 auto',
      }}
      className="sideContent"
    >
      <div style={{ width: '100%' }}>
        <img
          src={logo}
          alt="Logo"
          style={{
            margin: '0 0 40px',
            display: 'block',
            height: 63,
            width: 'auto',
            objectFit: 'contain',
          }}
        />

        <Title level={1}>Lead to Quote, in Minutes</Title>

        <div className="space20"></div>
      </div>
    </Content>
  );
}
