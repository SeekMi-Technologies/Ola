import { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Tooltip, Select, notification } from 'antd';
import { TranslationOutlined } from '@ant-design/icons';

import { setLang } from '@/redux/lang/actions';
import { selectLang } from '@/redux/lang/selectors';
import { selectCurrentAdmin, isLoggedIn as selectIsLoggedIn } from '@/redux/auth/selectors';
import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

const VARIANT_CLASS = {
  panel: 'ola-panel-header-btn',
  header: 'header-action-btn',
  auth: 'lang-toggle-auth',
};

const HEADER_INLINE_STYLE = {
  padding: '0 8px',
  minWidth: 'auto',
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
};

const AUTH_INLINE_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: '#8c8c8c',
};

export default function LanguageToggle({ variant = 'header' }) {
  const dispatch = useDispatch();
  const lang = useSelector(selectLang);
  const currentUser = useSelector(selectCurrentAdmin);
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const translate = useLanguage();
  // Keep translate latest-ref so the async failure-notification renders in
  // the post-click language (matches the now-flipped UI) rather than the
  // language captured when the click handler was created.
  const translateRef = useRef(translate);
  useEffect(() => {
    translateRef.current = translate;
  });
  const clickIdRef = useRef(0);

  const syncAuthLocalStorage = (newLang) => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('auth') || 'null');
      if (stored && stored.current) {
        stored.current = { ...stored.current, language: newLang };
        window.localStorage.setItem('auth', JSON.stringify(stored));
      }
    } catch (e) {
      // localStorage tampered / disabled — Redux + ola_lang already carry intent
    }
  };

  const warnLocalOnly = () => {
    notification.warning({
      message: translateRef.current('language_synced_locally_only_title'),
      description: translateRef.current('language_synced_locally_only_desc'),
    });
  };

  const saveLangToServer = async (newLang) => {
    if (!isLoggedIn) return null;
    return request.patch({
      entity: 'admin/profile/update',
      jsonData: {
        name: currentUser?.name,
        surname: currentUser?.surname,
        email: currentUser?.email,
        language: newLang,
      },
      silent: true,
    });
  };

  // ---- select variant ----
  if (variant === 'select') {
    const handleChange = async (value) => {
      const myClickId = ++clickIdRef.current;
      dispatch(setLang(value));
      const response = await saveLangToServer(value);
      if (myClickId !== clickIdRef.current) return;
      if (response && response.success === true) {
        syncAuthLocalStorage(value);
      } else if (response) {
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

  // ---- toggle variants (header / auth / panel) ----
  const targetLang = lang === 'zh' ? 'en' : 'zh';
  const tooltipText =
    lang === 'zh' ? translate('switch_to_english') : translate('switch_to_chinese');

  const handleClick = async () => {
    const myClickId = ++clickIdRef.current;
    dispatch(setLang(targetLang));
    const response = await saveLangToServer(targetLang);
    if (myClickId !== clickIdRef.current) return;
    if (response && response.success === true) {
      syncAuthLocalStorage(targetLang);
    } else if (response) {
      warnLocalOnly();
    }
  };

  const className = VARIANT_CLASS[variant] || VARIANT_CLASS.header;
  const style =
    variant === 'header' ? HEADER_INLINE_STYLE : variant === 'auth' ? AUTH_INLINE_STYLE : undefined;

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label={tooltipText}
      style={style}
    >
      <Tooltip title={tooltipText} placement="bottom">
        <TranslationOutlined style={{ fontSize: variant === 'header' ? 18 : 16, color: '#8c8c8c' }} />
      </Tooltip>
    </button>
  );
}
