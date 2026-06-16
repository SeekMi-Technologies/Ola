import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { selectAuth } from '@/redux/auth/selectors';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import NotFound from '@/pages/NotFound';

import ForgetPassword from '@/pages/ForgetPassword';
import ResetPassword from '@/pages/ResetPassword';

export default function AuthRouter() {
  const { isLoggedIn } = useSelector(selectAuth);

  if (isLoggedIn) {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Login />} path="/" />
      <Route element={<Login />} path="/login" />
      <Route element={<Register />} path="/signup" />
      <Route element={<Navigate to="/signup" replace />} path="/register" />
      <Route element={<Navigate to="/login" replace />} path="/logout" />
      <Route element={<ForgetPassword />} path="/forgetpassword" />
      <Route element={<ResetPassword />} path="/resetpassword/:userId/:resetToken" />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
