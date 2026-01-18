import React from 'react';
import { history } from '@umijs/max';

const Login: React.FC = () => {
  React.useEffect(() => {
    history.replace('/workspace');
  }, []);

  return null;
};

export default Login;
