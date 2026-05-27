import { Amplify } from 'aws-amplify';

let configured = false;

export function configureAmplify() {
  if (configured) return;
  configured = true;

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://autoaw.app';

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId:       process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID  ?? '',
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID     ?? '',
        loginWith: {
          oauth: {
            domain:          process.env.NEXT_PUBLIC_COGNITO_DOMAIN     ?? '',
            scopes:          ['email', 'profile', 'openid'],
            redirectSignIn:  [`${origin}/login`],
            redirectSignOut: [`${origin}/`],
            responseType:    'code',
          },
          email: true,
        },
      },
    },
  });
}
