/**
 * DEV ONLY: Axios request interceptor that returns mock data
 * instead of making real API calls.
 *
 * Activated by VITE_DEV_BYPASS_AUTH=true in .env
 */

const BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';

// Default mock settings that ErpApp / selectors expect
const MOCK_SETTINGS = [
  { settingCategory: 'app_settings', settingKey: 'idurar_app_language', settingValue: 'en_us' },
  { settingCategory: 'app_settings', settingKey: 'idurar_app_name', settingValue: 'Ola ERP' },
  { settingCategory: 'money_format_settings', settingKey: 'currency', settingValue: 'USD' },
  { settingCategory: 'money_format_settings', settingKey: 'currency_symbol', settingValue: '$' },
  { settingCategory: 'money_format_settings', settingKey: 'currency_position', settingValue: 'before' },
  { settingCategory: 'money_format_settings', settingKey: 'decimal_sep', settingValue: '.' },
  { settingCategory: 'money_format_settings', settingKey: 'thousand_sep', settingValue: ',' },
  { settingCategory: 'money_format_settings', settingKey: 'cent_precision', settingValue: 2 },
  { settingCategory: 'money_format_settings', settingKey: 'zero_format', settingValue: false },
  { settingCategory: 'finance_settings', settingKey: 'last_invoice_number', settingValue: 0 },
  { settingCategory: 'finance_settings', settingKey: 'last_quote_number', settingValue: 0 },
  { settingCategory: 'finance_settings', settingKey: 'last_payment_number', settingValue: 0 },
  { settingCategory: 'finance_settings', settingKey: 'last_purchaseorder_number', settingValue: 0 },
  { settingCategory: 'company_settings', settingKey: 'company_name', settingValue: 'Demo Company' },
  { settingCategory: 'company_settings', settingKey: 'company_address', settingValue: '' },
  { settingCategory: 'company_settings', settingKey: 'company_phone', settingValue: '' },
  { settingCategory: 'company_settings', settingKey: 'company_email', settingValue: '' },
  { settingCategory: 'crm_settings', settingKey: 'client_type', settingValue: 'company' },
];

/**
 * Build a mock response based on the request URL.
 */
function getMockResponse(config) {
  const url = (config.url || '').toLowerCase();

  // --- settings/listAll → return default settings ---
  if (url.includes('setting/listall') || url.includes('setting/list')) {
    return {
      success: true,
      result: MOCK_SETTINGS,
      message: '[DEV MOCK] settings loaded',
    };
  }

  // --- list / listAll → empty paginated list ---
  if (url.includes('/list')) {
    if (url.includes('client')) {
      const mockClients = [
        {
          _id: '65a1abc11111111111111111',
          name: 'Nextable Limited',
          country: 'Hong Kong',
          address: '香港湾仔轩尼诗道 180 号',
          phone: '+852 2345 6789',
          email: 'contact@nextable.com',
          removed: false,
          enabled: true,
        },
        {
          _id: '65a2def22222222222222222',
          name: 'Sino Cable Group',
          country: 'China',
          address: '上海市浦东新区张江高科技园区',
          phone: '+86 21 6888 8888',
          email: 'info@sinocable.cn',
          removed: false,
          enabled: true,
        },
        {
          _id: '65a3ghi33333333333333333',
          name: 'International Union of Electronic, Electrical, Salaried, Machine and Furniture Workers (IUE-CWA)',
          country: 'United States',
          address: '501 3rd Street NW, Washington, DC 20001',
          phone: '+1 202 434 1100',
          email: 'info@iue-cwa.org',
          removed: false,
          enabled: true,
        },
      ];
      return {
        success: true,
        result: mockClients,
        pagination: { page: 1, pages: 1, count: 3 },
        message: '[DEV MOCK] customer list',
      };
    }
    return {
      success: true,
      result: [],
      pagination: { page: 1, pages: 1, count: 0 },
      message: '[DEV MOCK] empty list',
    };
  }

  // --- search / filter → empty results ---
  if (url.includes('/search') || url.includes('/filter')) {
    return {
      success: true,
      result: [],
      pagination: { page: 1, pages: 1, count: 0 },
      message: '[DEV MOCK] empty search',
    };
  }

  // --- summary → zeroed summary ---
  if (url.includes('/summary')) {
    return {
      success: true,
      result: { total: 0, count: 0 },
      message: '[DEV MOCK] empty summary',
    };
  }

  // --- read → empty object ---
  if (url.includes('/read/')) {
    if (url.includes('65a1abc11111111111111111')) {
      return {
        success: true,
        result: {
          _id: '65a1abc11111111111111111',
          name: 'Nextable Limited',
          country: 'Hong Kong',
          address: '香港湾仔轩尼诗道 180 号',
          phone: '+852 2345 6789',
          email: 'contact@nextable.com',
          removed: false,
          enabled: true,
        },
        message: '[DEV MOCK] mock read client 1',
      };
    }
    if (url.includes('65a2def22222222222222222')) {
      return {
        success: true,
        result: {
          _id: '65a2def22222222222222222',
          name: 'Sino Cable Group',
          country: 'China',
          address: '上海市浦东新区张江高科技园区',
          phone: '+86 21 6888 8888',
          email: 'info@sinocable.cn',
          removed: false,
          enabled: true,
        },
        message: '[DEV MOCK] mock read client 2',
      };
    }
    if (url.includes('65a3ghi33333333333333333')) {
      return {
        success: true,
        result: {
          _id: '65a3ghi33333333333333333',
          name: 'International Union of Electronic, Electrical, Salaried, Machine and Furniture Workers (IUE-CWA)',
          country: 'United States',
          address: '501 3rd Street NW, Washington, DC 20001',
          phone: '+1 202 434 1100',
          email: 'info@iue-cwa.org',
          removed: false,
          enabled: true,
        },
        message: '[DEV MOCK] mock read client 3',
      };
    }
    return {
      success: true,
      result: { _id: 'mock-id', removed: false, enabled: true },
      message: '[DEV MOCK] mock read',
    };
  }

  // --- create / update / delete / patch / upload / mail / convert / copy ---
  if (
    url.includes('/create') ||
    url.includes('/update') ||
    url.includes('/delete') ||
    url.includes('/upload') ||
    url.includes('/mail') ||
    url.includes('/convert') ||
    url.includes('/copy')
  ) {
    return {
      success: true,
      result: { _id: 'mock-id' },
      message: '[DEV MOCK] operation mocked',
    };
  }

  // --- fallback: generic success ---
  return {
    success: true,
    result: null,
    message: '[DEV MOCK] generic response',
  };
}

/**
 * Register the mock interceptor on the given axios instance.
 * Only activates when VITE_DEV_BYPASS_AUTH=true.
 */
export function setupDevMockInterceptor(axiosInstance) {
  if (!BYPASS) return;

  console.log(
    '%c🔧 DEV MOCK MODE — All API requests are intercepted and return mock data.',
    'color: #faad14; font-weight: bold; font-size: 14px;'
  );

  // Request interceptor: reject immediately with a special flag so the
  // response interceptor can catch it and return mock data.
  axiosInstance.interceptors.request.use((config) => {
    const mockData = getMockResponse(config);
    // Abort the real request by returning a rejected promise,
    // with enough info for the response interceptor to build a response.
    const error = new Error('DEV_MOCK');
    error.__devMock = true;
    error.__mockData = mockData;
    error.__config = config;
    return Promise.reject(error);
  });

  // Response interceptor: catch the mock rejection and resolve it as
  // a successful axios response so the calling code works normally.
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.__devMock) {
        // Build a fake axios response
        return Promise.resolve({
          data: error.__mockData,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: error.__config,
        });
      }
      // Real errors pass through
      return Promise.reject(error);
    }
  );
}
