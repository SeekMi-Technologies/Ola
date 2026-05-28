/**
 * 国家选项列表 — 供 Onboarding / Settings 等模块复用
 * 调用 getCountryOptions(translate) 获取当前语言的选项列表
 */
const COUNTRY_DATA = [
  { value: 'CN', flag: '🇨🇳', key: 'china' },
  { value: 'US', flag: '🇺🇸', key: 'united_states' },
  { value: 'DE', flag: '🇩🇪', key: 'germany' },
  { value: 'GB', flag: '🇬🇧', key: 'united_kingdom' },
  { value: 'JP', flag: '🇯🇵', key: 'japan' },
  { value: 'KR', flag: '🇰🇷', key: 'korea' },
  { value: 'RU', flag: '🇷🇺', key: 'russia' },
  { value: 'IN', flag: '🇮🇳', key: 'india' },
  { value: 'BR', flag: '🇧🇷', key: 'brazil' },
  { value: 'AU', flag: '🇦🇺', key: 'australia' },
  { value: 'CA', flag: '🇨🇦', key: 'canada' },
  { value: 'FR', flag: '🇫🇷', key: 'france' },
  { value: 'IT', flag: '🇮🇹', key: 'italy' },
  { value: 'ES', flag: '🇪🇸', key: 'spain' },
  { value: 'NL', flag: '🇳🇱', key: 'netherlands' },
  { value: 'TR', flag: '🇹🇷', key: 'turkey' },
  { value: 'MX', flag: '🇲🇽', key: 'mexico' },
  { value: 'TH', flag: '🇹🇭', key: 'thailand' },
  { value: 'VN', flag: '🇻🇳', key: 'vietnam' },
  { value: 'ID', flag: '🇮🇩', key: 'indonesia' },
  { value: 'MY', flag: '🇲🇾', key: 'malaysia' },
  { value: 'PH', flag: '🇵🇭', key: 'philippines' },
  { value: 'SA', flag: '🇸🇦', key: 'saudi_arabia' },
  { value: 'AE', flag: '🇦🇪', key: 'united_arab_emirates' },
  { value: 'EG', flag: '🇪🇬', key: 'egypt' },
  { value: 'ZA', flag: '🇿🇦', key: 'south_africa' },
  { value: 'NG', flag: '🇳🇬', key: 'nigeria' },
  { value: 'PK', flag: '🇵🇰', key: 'pakistan' },
  { value: 'BD', flag: '🇧🇩', key: 'bangladesh' },
  { value: 'AR', flag: '🇦🇷', key: 'argentina' },
  { value: 'CL', flag: '🇨🇱', key: 'chile' },
  { value: 'CO', flag: '🇨🇴', key: 'colombia' },
  { value: 'PE', flag: '🇵🇪', key: 'peru' },
  { value: 'PL', flag: '🇵🇱', key: 'poland' },
  { value: 'SE', flag: '🇸🇪', key: 'sweden' },
  { value: 'NO', flag: '🇳🇴', key: 'norway' },
  { value: 'DK', flag: '🇩🇰', key: 'denmark' },
  { value: 'FI', flag: '🇫🇮', key: 'finland' },
  { value: 'NZ', flag: '🇳🇿', key: 'new_zealand' },
  { value: 'SG', flag: '🇸🇬', key: 'singapore' },
  { value: 'HK', flag: '🇭🇰', key: 'hong_kong' },
];

export const getCountryOptions = (translate) =>
  COUNTRY_DATA
    .map(({ value, flag, key }) => ({ value, label: `${flag} ${translate(key)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
