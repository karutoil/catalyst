import { createAuthClient } from 'better-auth/client';
import {
  genericOAuthClient,
  inferAdditionalFields,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

const envBaseURL = import.meta.env.VITE_BETTER_AUTH_URL || import.meta.env.VITE_API_URL || '';
const baseURL = envBaseURL || (typeof window !== 'undefined' ? window.location.origin : '');

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  credentials: 'include',
  plugins: [
    twoFactorClient(),
    passkeyClient(),
    genericOAuthClient(),
    usernameClient(),
    inferAdditionalFields({
      user: {
        fields: {
          username: { type: 'string', required: true },
        },
      },
    }),
  ],
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () =>
        sessionStorage.getItem('catalyst-session-token') ||
        localStorage.getItem('catalyst-auth-token') ||
        undefined,
    },
    onResponse: ({ response }) => {
      const token = response.headers.get('set-auth-token');
      if (token) {
        const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
        if (rememberMe) {
          localStorage.setItem('catalyst-auth-token', token);
          sessionStorage.removeItem('catalyst-session-token');
        } else {
          sessionStorage.setItem('catalyst-session-token', token);
        }
      }
    },
  },
});
