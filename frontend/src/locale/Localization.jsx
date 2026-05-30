import { ConfigProvider } from 'antd';
import { useSelector } from 'react-redux';
import antdLocale from './antdLocale';
import { selectLang } from '@/redux/lang/selectors';

const FALLBACK_LOCALE = antdLocale.en;

export default function Localization({ children }) {
  const lang = useSelector(selectLang);
  const locale = antdLocale[lang] || FALLBACK_LOCALE;

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        // algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#1640D6',
          colorLink: '#1640D6',
          borderRadius: 8,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
