import { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Tooltip, notification } from 'antd';
import { TranslationOutlined } from '@ant-design/icons';

import { setLang } from '@/redux/lang/actions';
import { selectLang } from '@/redux/lang/selectors';
import { selectCurrentAdmin, isLoggedIn as selectIsLoggedIn } from '@/redux/auth/selectors';
import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

const VARIANT_CLASS = {
  panel: 'ola-panel-header-btn',
  header: 'header-action-btn',
};

const HEADER_INLINE_STYLE = {
  padding: '0 8px',
  minWidth: 'auto',
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
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

  const targetLang = lang === 'zh' ? 'en' : 'zh';
  const tooltipText =
    lang === 'zh' ? translate('switch_to_english') : translate('switch_to_chinese');

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

  const handleClick = async () => {
    const myClickId = ++clickIdRef.current;
    dispatch(setLang(targetLang));

    if (!isLoggedIn) return;

    const response = await request.patch({
      entity: 'admin/profile/update',
      jsonData: {
        name: currentUser?.name,
        surname: currentUser?.surname,
        email: currentUser?.email,
        language: targetLang,
      },
      silent: true,
    });

    if (myClickId !== clickIdRef.current) return;

    if (response && response.success === true) {
      syncAuthLocalStorage(targetLang);
    } else {
      warnLocalOnly();
    }
  };

  const className = VARIANT_CLASS[variant] || VARIANT_CLASS.header;
  const style = variant === 'header' ? HEADER_INLINE_STYLE : undefined;

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label={tooltipText}
      style={style}
    >
      <Tooltip title={tooltipText} placement="bottom">
        <TranslationOutlined style={variant === 'header' ? { fontSize: 18, color: '#8c8c8c' } : undefined} />
      </Tooltip>
    </button>
  );
}
