import { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select, notification } from 'antd';
import { setLang } from '@/redux/lang/actions';
import { selectLang } from '@/redux/lang/selectors';
import { selectCurrentAdmin, isLoggedIn as selectIsLoggedIn } from '@/redux/auth/selectors';
import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

export default function LanguageSelect() {
  const dispatch = useDispatch();
  const lang = useSelector(selectLang);
  const currentUser = useSelector(selectCurrentAdmin);
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const translate = useLanguage();
  const translateRef = useRef(translate);

  useEffect(() => {
    translateRef.current = translate;
  });

  const syncAuthLocalStorage = (newLang) => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('auth') || 'null');
      if (stored && stored.current) {
        stored.current = { ...stored.current, language: newLang };
        window.localStorage.setItem('auth', JSON.stringify(stored));
      }
    } catch (e) {
      // localStorage unavailable / disabled
    }
  };

  const warnLocalOnly = () => {
    notification.warning({
      message: translateRef.current('language_synced_locally_only_title'),
      description: translateRef.current('language_synced_locally_only_desc'),
    });
  };

  const handleChange = async (value) => {
    dispatch(setLang(value));
    if (!isLoggedIn) return;

    const response = await request.patch({
      entity: 'admin/profile/update',
      jsonData: {
        name: currentUser?.name,
        surname: currentUser?.surname,
        email: currentUser?.email,
        language: value,
      },
      silent: true,
    });

    if (response && response.success === true) {
      syncAuthLocalStorage(value);
    } else {
      warnLocalOnly();
    }
  };

  return (
    <Select
      variant="borderless"
      size="small"
      value={lang}
      onChange={handleChange}
      style={{
        color: '#9CA3AF',
        fontSize: '13px',
        width: '100px',
      }}
      popupMatchSelectWidth={false}
      options={[
        { value: 'en', label: 'English' },
        { value: 'zh', label: '简体中文' },
      ]}
    />
  );
}
