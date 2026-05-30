import { useCallback } from 'react';
import { useSelector } from 'react-redux';
import languages from './translation/translation';
import { selectLang } from '@/redux/lang/selectors';
import { DEFAULT_LANG } from '@/redux/lang/reducer';

const FALLBACK_LANG = 'en';

const normalize = (key) =>
  String(key).toLowerCase().replace(/[^a-z0-9]/g, '_');

const titleCase = (key) =>
  String(key)
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.substring(1))
    .join(' ');

// undefined = key absent from dict. Empty string '' is a legitimate
// translation and must be returned as-is, so we check !== undefined
// rather than truthiness.
const lookup = (rawKey, dict) => {
  if (!dict) return undefined;
  if (dict[rawKey] !== undefined) return dict[rawKey];
  const normalized = normalize(rawKey);
  if (dict[normalized] !== undefined) return dict[normalized];
  return undefined;
};

// Returned function is memoized on `lang` so callers can safely put `translate`
// in a useCallback / useEffect dependency array without re-firing every render.
// (Pre-memo version caused AskOla to refetch /ola/session/messages on every
// streamed token, which visibly clobbered the local user-message bubble.)
const useLanguage = () => {
  const lang = useSelector(selectLang) || DEFAULT_LANG;

  return useCallback(
    (rawKey) => {
      const dict = languages[lang] || {};
      const fallback = languages[FALLBACK_LANG] || {};
      if (rawKey === null || rawKey === undefined || rawKey === '') return '';
      const hit = lookup(rawKey, dict);
      if (hit !== undefined) return hit;
      const fb = lookup(rawKey, fallback);
      if (fb !== undefined) return fb;
      return titleCase(rawKey);
    },
    [lang],
  );
};

export default useLanguage;
