import React from 'react';
import { Breadcrumb } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { HomeOutlined } from '@ant-design/icons';
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
  create: 'create',
  edit: 'edit',
  list: 'list',
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

  const breadcrumbItems = [
    {
      title: (
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#1677ff' }}>
          <HomeOutlined style={{ fontSize: '13px' }} />
          <span>{translate('Dashboard') || 'Dashboard'}</span>
        </Link>
      ),
    },
  ];

  pathnames.forEach((value, index) => {
    // Skip rendering 'dashboard' since Home/Dashboard is already the root item
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
