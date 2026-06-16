import React from 'react';
import { Breadcrumb } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import useLanguage from '@/locale/useLanguage';

// Mapping path segments to localized translation keys
const PATH_TRANSLATION_MAP = {
  dashboard: 'Dashboard',
  askola: 'Ask Ola',
  file: 'file',
  integrations: 'integrations',
  customer: 'Customers',
  merchandise: 'Merchandise',
  factory: 'Factory',
  invoice: 'Invoice',
  quote: 'Quote',
  purchaseorder: 'Purchase Orders',
  payment: 'Payment',
  settings: 'Settings',
  profile: 'Profile',
  control: 'Tasks',
  mode: 'Payment Mode',
  general_settings: 'Company',
  currency_settings: 'Currency Settings',
  create: 'create',
  edit: 'edit',
  list: 'list',
};

// Route Category Map based on the first path segment
const ROUTE_CATEGORY_MAP = {
  // Main
  '': 'Main',
  'dashboard': 'Main',
  'askola': 'Main',
  'file': 'Main',
  'integrations': 'Main',
  'control': 'Main',
  'settings': 'Workspace',
  'profile': 'Personal',

  // Business
  'customer': 'Business',
  'merchandise': 'Business',
  'factory': 'Business',

  // Finance
  'quote': 'Finance',
  'purchaseorder': 'Finance',
  'invoice': 'Finance',
  'payment': 'Finance',
};

export default function AppBreadcrumb() {
  const location = useLocation();
  const translate = useLanguage();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Return null on login, register, onboarding pages to keep layout clean
  const hideBreadcrumbPaths = ['/login', '/register', '/forget-password', '/reset-password', '/onboarding'];
  if (hideBreadcrumbPaths.includes(location.pathname)) {
    return null;
  }

  // Determine Category based on first segment
  const primarySegment = pathnames[0] ? pathnames[0].toLowerCase() : '';
  let category = ROUTE_CATEGORY_MAP[primarySegment] || 'Main';

  if (primarySegment === 'settings') {
    const isWorkspaceTab = pathnames.includes('general_settings') || pathnames.includes('currency_settings');
    category = isWorkspaceTab ? 'Workspace' : 'Personal';
  }

  const breadcrumbItems = [
    {
      title: (
        <span style={{ color: '#8c8c8c', fontWeight: 400 }}>
          {translate(category)}
        </span>
      ),
    },
  ];

  if (pathnames.length === 0 || (pathnames.length === 1 && pathnames[0].toLowerCase() === 'dashboard')) {
    // For root path or dashboard, append Dashboard as the active last item
    breadcrumbItems.push({
      title: (
        <span style={{ color: '#595959', fontWeight: 500 }}>
          {translate('Dashboard')}
        </span>
      ),
    });
  } else {
    pathnames.forEach((value, index) => {
      // Skip rendering 'dashboard' segment if it happens to be present in subpaths to keep it clean
      if (value.toLowerCase() === 'dashboard') return;

      const translationKey = PATH_TRANSLATION_MAP[value.toLowerCase()] || value;
      const label = translate(translationKey) || value.charAt(0).toUpperCase() + value.slice(1);
      const url = `/${pathnames.slice(0, index + 1).join('/')}`;
      const isLast = index === pathnames.length - 1;

      breadcrumbItems.push({
        title: isLast ? (
          <span style={{ color: '#595959', fontWeight: 500 }}>{label}</span>
        ) : (
          <Link to={url} style={{ color: '#1677ff' }}>{label}</Link>
        ),
      });
    });
  }

  return (
    <Breadcrumb
      separator={<span style={{ color: '#bfbfbf', margin: '0 4px' }}>&gt;</span>}
      items={breadcrumbItems}
      style={{
        fontSize: '13px',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
      }}
    />
  );
}
