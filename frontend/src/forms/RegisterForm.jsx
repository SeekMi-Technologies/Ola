import React from 'react';
import { Form, Input } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';

import useLanguage from '@/locale/useLanguage';

export default function RegisterForm() {
  const translate = useLanguage();
  return (
    <div>
      <Form.Item style={{ marginBottom: 0 }}>
        <Form.Item
          label={translate('first_name')}
          name="name"
          rules={[
            {
              required: true,
              message: translate('please_input_your_first_name'),
            },
          ]}
          style={{ display: 'inline-block', width: 'calc(50% - 8px)' }}
        >
          <Input
            prefix={<UserOutlined className="site-form-item-icon" />}
            placeholder={translate('first_name')}
            size="large"
          />
        </Form.Item>

        <Form.Item
          label={translate('last_name')}
          name="surname"
          style={{ display: 'inline-block', width: 'calc(50% - 8px)', margin: '0 0 0 16px' }}
        >
          <Input
            prefix={<UserOutlined className="site-form-item-icon" />}
            placeholder={translate('last_name')}
            size="large"
          />
        </Form.Item>
      </Form.Item>
      
      <Form.Item
        label={translate('email')}
        name="email"
        rules={[
          {
            required: true,
            message: translate('please_input_your_email'),
          },
          {
            type: 'email',
            message: translate('invalid_email_address'),
          },
        ]}
      >
        <Input
          prefix={<MailOutlined className="site-form-item-icon" />}
          placeholder={translate('email')}
          type="email"
          size="large"
        />
      </Form.Item>

      <Form.Item
        label={translate('password')}
        name="password"
        rules={[
          {
            required: true,
            message: translate('please_input_your_password'),
          },
          {
            min: 8,
            message: translate('password_must_be_at_least_8_characters'),
          }
        ]}
      >
        <Input.Password
          prefix={<LockOutlined className="site-form-item-icon" />}
          placeholder={translate('password')}
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label={translate('confirm_password')}
        dependencies={['password']}
        rules={[
          {
            required: true,
            message: translate('please_confirm_your_password'),
          },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error(translate('passwords_do_not_match')));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined className="site-form-item-icon" />}
          placeholder={translate('confirm_password')}
          size="large"
        />
      </Form.Item>
    </div>
  );
}
