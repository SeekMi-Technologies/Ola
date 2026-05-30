import { useState, useEffect } from 'react';
import { Form, Input, Button, Select, message } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { request } from '@/request';
import Loading from '@/components/Loading';
import { COUNTRY_OPTIONS } from '@/utils/countryOptions';
// === MVP-HIDDEN: Logo 上传功能本轮不实现 ===
// import CompanyLogoField from '@/modules/SettingModule/components/CompanyLogoField';
// === END MVP-HIDDEN ===
import useLanguage from '@/locale/useLanguage';

export default function SettingsGeneral() {
  const translate = useLanguage();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setFetching(true);
      const response = await request.listAll({ entity: 'setting' });
      if (response.success && response.result) {
        const settingsObj = {};
        response.result.forEach((item) => {
          settingsObj[item.settingKey] = item.settingValue;
        });
        form.setFieldsValue(settingsObj);
      }
    } catch (error) {
      console.error('Failed to fetch settings', error);
      message.error(translate('Failed to load company settings'));
    } finally {
      setFetching(false);
    }
  };

  const onFinish = async (values) => {
    try {
      setLoading(true);
      const settingsArray = Object.keys(values).map((key) => ({
        settingKey: key,
        settingValue: values[key] === undefined || values[key] === null ? '' : values[key],
      }));

      const response = await request.patch({
        entity: 'setting/updateManySetting',
        jsonData: { settings: settingsArray },
      });

      if (response.success) {
        message.success(translate('Company settings updated successfully!'));
      } else {
        message.error(response.message || translate('Failed to update settings'));
      }
    } catch (error) {
      console.error('Update settings error:', error);
      message.error(translate('An error occurred while updating settings'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="general-settings-section">
      <h1 className="general-settings-title">{translate('Company Settings')}</h1>
      <p className="general-settings-subtitle">
        {translate('Manage your company information')}
      </p>

      <hr className="general-settings-divider" />

      <Loading isLoading={fetching}>
        <div className="general-company-block">
          {/* === MVP-HIDDEN: Logo 上传功能本轮不实现 === */}
          {/* <CompanyLogoField /> */}
          {/* === END MVP-HIDDEN === */}
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            className="general-form-container"
          >
            <div className="general-fields-row">
              <Form.Item
                name="company_name"
                label={<span className="general-field-label">{translate('Company Name')}</span>}
                className="general-field-group"
                rules={[{ required: true, message: 'Company name is required' }]}
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter company name')} />
              </Form.Item>

              <Form.Item
                name="company_email"
                label={<span className="general-field-label">{translate('Company Email')}</span>}
                className="general-field-group"
                rules={[{ type: 'email', message: 'Enter a valid email' }]}
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter company email')} />
              </Form.Item>
            </div>

            <div className="general-fields-row">
              <Form.Item
                name="company_phone"
                label={<span className="general-field-label">{translate('Company Phone')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter phone number')} />
              </Form.Item>

              <Form.Item
                name="company_website"
                label={<span className="general-field-label">{translate('Company Website')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter website URL')} />
              </Form.Item>
            </div>

            <div className="general-fields-row">
              <Form.Item
                name="company_address"
                label={<span className="general-field-label">{translate('Company Address')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter address')} />
              </Form.Item>

              <Form.Item
                name="company_state"
                label={<span className="general-field-label">{translate('State')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter state')} />
              </Form.Item>
            </div>

            <div className="general-fields-row">
              <Form.Item
                name="company_country"
                label={<span className="general-field-label">{translate('Country')}</span>}
                className="general-field-group"
                rules={[{ required: true, message: 'Company country is required' }]}
              >
                <Select
                  showSearch
                  placeholder={translate('Select your country')}
                  optionFilterProp="label"
                  options={COUNTRY_OPTIONS}
                  size="large"
                  suffixIcon={<GlobalOutlined className="site-form-item-icon" />}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="company_tax_number"
                label={<span className="general-field-label">{translate('Tax Number')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter tax number')} />
              </Form.Item>
            </div>

            <div className="general-fields-row">
              <Form.Item
                name="company_vat_number"
                label={<span className="general-field-label">{translate('VAT Number')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter VAT number')} />
              </Form.Item>

              <Form.Item
                name="company_reg_number"
                label={<span className="general-field-label">{translate('Registration Number')}</span>}
                className="general-field-group"
              >
                <Input className="general-field-input" size="large" placeholder={translate('Enter registration number')} />
              </Form.Item>
            </div>

            <Form.Item style={{ marginTop: '32px' }}>
              <Button type="primary" htmlType="submit" size="large" loading={loading}>
                {translate('Save Changes')}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Loading>
    </div>
  );
}
