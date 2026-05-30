import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Form, Input, Button, Select, message } from 'antd';
import { InfoCircleOutlined, UserOutlined, MailOutlined } from '@ant-design/icons';

import { selectAuth } from '@/redux/auth/selectors';
import * as actionTypes from '@/redux/auth/types';
import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

export default function SettingsProfile() {
  const translate = useLanguage();
  const { current: currentUser } = useSelector(selectAuth);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (currentUser) {
      form.setFieldsValue({
        name: currentUser.name,
        surname: currentUser.surname,
        email: currentUser.email,
        language: currentUser.language || 'zh',
      });
    }
  }, [currentUser, form]);

  const onFinish = async (values) => {
    try {
      setLoading(true);
      // 保持和旧接口一致的 payload (email, name, surname) + language
      const payload = {
        name: values.name,
        surname: values.surname,
        email: currentUser.email, // 确保 email 不能被表单欺骗修改
        language: values.language,
      };

      const { success, result, message: msg } = await request.patch({
        entity: 'admin/profile/update',
        jsonData: payload,
      });

      if (success) {
        message.success(translate('Profile updated successfully!'));

        // Refresh auth cache from the server response (canonical post-write
        // shape — picks up language fallback default + any backend normalization).
        // localStorage may be missing (private browsing, cache cleared,
        // mid-token-refresh) — guard before reading .current to avoid TypeError.
        const storedAuth = JSON.parse(window.localStorage.getItem('auth'));
        if (storedAuth) {
          storedAuth.current = { ...storedAuth.current, ...result };
          window.localStorage.setItem('auth', JSON.stringify(storedAuth));
          dispatch({ type: actionTypes.REQUEST_SUCCESS, payload: storedAuth.current });
        } else {
          // No localStorage cache — sync Redux directly from server response.
          dispatch({ type: actionTypes.REQUEST_SUCCESS, payload: result });
        }
      } else {
        message.error(msg || translate('Failed to update profile'));
      }
    } catch (error) {
      console.error('Update profile error:', error);
      message.error(translate('An error occurred during update'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile-section">
      {/* Title */}
      <h1 className="profile-title">{translate('Profile')}</h1>
      <p className="profile-subtitle">{translate('Manage your personal details')}</p>

      {/* Info banner */}
      <div className="profile-info-banner">
        <InfoCircleOutlined />
        <span>{translate('Changes to your profile will apply to all of your workspaces.')}</span>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        className="profile-form-container"
      >
        <div className="profile-form-row">
          <Form.Item
            name="name"
            label={<span className="profile-form-label">{translate('First Name')}</span>}
            className="profile-form-group"
            rules={[{ required: true, message: 'First name is required' }]}
          >
            <Input className="profile-form-input" prefix={<UserOutlined style={{color: '#bfbfbf', marginRight: 5}}/>} />
          </Form.Item>

          <Form.Item
            name="surname"
            label={<span className="profile-form-label">{translate('Last Name')}</span>}
            className="profile-form-group"
          >
            <Input className="profile-form-input" prefix={<UserOutlined style={{color: '#bfbfbf', marginRight: 5}}/>} />
          </Form.Item>
        </div>

        <div className="profile-email-row" style={{ marginTop: '24px' }}>
          <Form.Item
            name="email"
            label={<span className="profile-form-label">{translate('Primary email address')}</span>}
            className="profile-form-group"
            style={{ width: '100%' }}
          >
            <Input className="profile-form-input" disabled prefix={<MailOutlined style={{color: '#bfbfbf', marginRight: 5}}/>} />
          </Form.Item>
        </div>

        <Form.Item
          name="language"
          label={<span className="profile-form-label">{translate('Ask Ola language')}</span>}
          className="profile-form-group"
          style={{ width: '100%', marginTop: '24px' }}
          tooltip={translate('Drives the language Ola uses to talk to you. Quote document language is asked separately at quote-creation time.')}
        >
          <Select
            className="profile-time-select"
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Form.Item>

        <Form.Item style={{ marginTop: '32px' }}>
          <Button type="primary" htmlType="submit" size="large" loading={loading}>
            {translate('Save Changes')}
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
