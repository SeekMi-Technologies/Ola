import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';

import useLanguage from '@/locale/useLanguage';
import { Form, Button, Typography } from 'antd';

import { register } from '@/redux/auth/actions';
import { selectAuth } from '@/redux/auth/selectors';
import RegisterForm from '@/forms/RegisterForm';
import Loading from '@/components/Loading';
import AuthModule from '@/modules/AuthModule';
import LanguageToggle from '@/components/LanguageToggle';

const { Text } = Typography;

const RegisterPage = () => {
  const translate = useLanguage();
  const { isLoading, isSuccess } = useSelector(selectAuth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onFinish = (values) => {
    const { confirmPassword, ...registerData } = values;
    navigate('/', { replace: true });
    dispatch(register({ registerData }));
  };

  useEffect(() => {
    if (isSuccess) navigate('/', { replace: true });
  }, [isSuccess]);

  const FormContainer = () => {
    return (
      <Loading isLoading={isLoading}>
<Form
          layout="vertical"
          name="register_form"
          className="login-form"
          onFinish={onFinish}
        >
          <RegisterForm />
          
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              className="login-form-button"
              loading={isLoading}
              size="large"
            >
              {translate('sign_up')}
            </Button>
          </Form.Item>
          
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <LanguageToggle variant="auth" />
          </div>

          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <Text>{translate('already_have_an_account')} </Text>
            <Link to="/login">{translate('login')}</Link>
          </div>
        </Form>
      </Loading>
    );
  };

  return <AuthModule authContent={<FormContainer />} AUTH_TITLE="sign_up" />;
};

export default RegisterPage;
