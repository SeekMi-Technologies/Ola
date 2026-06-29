import React from 'react';
import { Breadcrumb } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectReadItem } from '@/redux/erp/selectors';
import useLanguage from '@/locale/useLanguage';
import { PATH_TRANSLATION_MAP, ROUTE_CATEGORY_MAP } from './breadcrumbConfig';

export default function AppBreadcrumb() {
  const location = useLocation();
  const translate = useLanguage();
  const readItem = useSelector(selectReadItem);
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
      title: translate(category),
    },
  ];

  if (pathnames.length === 0 || (pathnames.length === 1 && pathnames[0].toLowerCase() === 'dashboard')) {
    // For root path or dashboard, append Dashboard as the active last item
    breadcrumbItems.push({
      title: translate('Dashboard'),
    });
  } else {
    const SKIP_SEGMENTS = new Set(['dashboard', 'edit', 'update', 'read', 'create', 'list']);
    const objectId = pathnames.find((s) => /^[a-f0-9]{24}$/i.test(s));
    const visibleSegments = pathnames
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => !SKIP_SEGMENTS.has(value.toLowerCase()) && !/^[a-f0-9]{24}$/i.test(value));

    visibleSegments.forEach(({ value, index }, visibleIndex) => {
      const isLast = visibleIndex === visibleSegments.length - 1;
      const translationKey = PATH_TRANSLATION_MAP[value.toLowerCase()] || value;
      const label = translate(translationKey) || value.charAt(0).toUpperCase() + value.slice(1);
      const url = `/${pathnames.slice(0, index + 1).join('/')}`;

      breadcrumbItems.push({
        title: isLast && !objectId ? label : <Link to={url}>{label}</Link>,
      });
    });

    if (objectId) {
      const storeId = readItem?.result?._id?.toString();
      const docNumber = storeId === objectId ? readItem.result.number : objectId;
      breadcrumbItems.push({ title: docNumber });
    }
  }

  return (
    <Breadcrumb
      separator=">"
      items={breadcrumbItems}
    />
  );
}
