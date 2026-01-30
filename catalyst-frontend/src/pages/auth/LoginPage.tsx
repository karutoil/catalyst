import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../services/api/auth';
import { loginSchema, LoginSchema } from '../../validators/auth';
import { authClient } from '../../services/authClient';
import { notifyError } from '../../utils/notify';

function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, setSession } = useAuthStore();
  const [passkeyRequired, setPasskeyRequired] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [allowPasskeyFallback, setAllowPasskeyFallback] = useState(false);
  const passkeyAutoFillAttempted = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginSchema>({ resolver: zodResolver(loginSchema) });

  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;

  const syncPasskeySession = async () => {
    const token =
      sessionStorage.getItem('catalyst-session-token') ||
      localStorage.getItem('catalyst-auth-token');
    if (!token) {
      return false;
    }
    try {
      const { user } = await authApi.refresh();
      setSession({ user, token });
      return true;
    } catch {
      return false;
    }
  };

  const applyPasskeySession = async (data?: any) => {
    if (data?.user && data?.session?.token) {
      setSession({ user: data.user, token: data.session.token });
      return true;
    }
    if (data?.user && data?.token) {
      setSession({ user: data.user, token: data.token });
      return true;
    }
    return syncPasskeySession();
  };

  const onSubmit = async (values: LoginSchema) => {
    try {
      localStorage.setItem('catalyst-remember-me', values.rememberMe ? 'true' : 'false');
      if (!values.rememberMe) {
        localStorage.removeItem('catalyst-auth-token');
        sessionStorage.removeItem('catalyst-session-token');
      }
      await login({ ...values, allowPasskeyFallback });
      // Redirect on successful login
      setTimeout(() => {
        navigate(from || '/servers');
      }, 100);
    } catch (err) {
      if ((err as any).code === 'PASSKEY_REQUIRED') {
        setPasskeyRequired(true);
        return;
      }
      if ((err as any).code === 'TWO_FACTOR_REQUIRED') {
        navigate('/two-factor', { state: { from: location.state?.from, rememberMe: values.rememberMe } });
      }
    }
  };

  const handlePasskeySignIn = async () => {
    try {
      setPasskeySubmitting(true);
      const response = await authClient.signIn.passkey({
        fetchOptions: {
          onError(context) {
            if (context.error?.code === 'AUTH_CANCELLED' || context.error?.name === 'AbortError') {
              setPasskeyRequired(true);
              return;
            }
            notifyError(context.error?.message || 'Passkey sign-in failed');
          },
          onSuccess(context) {
            void applyPasskeySession(context.data).then(() => {
              setPasskeyRequired(false);
              setTimeout(() => {
                navigate(from || '/servers');
              }, 100);
            });
          },
        },
      });
      const data = (response as any)?.data;
      if (await applyPasskeySession(data)) {
        setPasskeyRequired(false);
        setTimeout(() => {
          navigate(from || '/servers');
        }, 100);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPasskeyRequired(true);
        return;
      }
      notifyError('Passkey sign-in failed');
    } finally {
      setPasskeySubmitting(false);
    }
  };

  useEffect(() => {
    if (passkeyAutoFillAttempted.current) {
      return;
    }
    if (!PublicKeyCredential?.isConditionalMediationAvailable) {
      return;
    }
    void PublicKeyCredential.isConditionalMediationAvailable().then((isAvailable) => {
      if (!isAvailable) return;
      passkeyAutoFillAttempted.current = true;
      setPasskeySubmitting(true);
      return authClient.signIn.passkey({
        autoFill: true,
        fetchOptions: {
          onError(context) {
            if (context.error?.code === 'AUTH_CANCELLED' || context.error?.name === 'AbortError') {
              setPasskeyRequired(true);
              return;
            }
            notifyError(context.error?.message || 'Passkey sign-in failed');
          },
          onSuccess(context) {
            void applyPasskeySession(context.data).then(() => {
              setPasskeyRequired(false);
              setAllowPasskeyFallback(false);
              setTimeout(() => {
                navigate(from || '/servers');
              }, 100);
            });
          },
        },
      })
        .catch((err: any) => {
          if (err?.code === 'AUTH_CANCELLED' || err?.name === 'AbortError') {
            return;
          }
        })
        .finally(() => {
          setPasskeySubmitting(false);
        });
    });
  }, []);

  const handleProvider = async (providerId: 'whmcs' | 'paymenter') => {
    try {
      await authApi.signInWithProvider(providerId);
    } catch {
      // handled by redirect plugin
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center text-center">
          <img src="/logo.png" alt="Catalyst logo" className="h-12 w-12" />
          <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Catalyst Panel
          </span>
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-slate-900 dark:text-white">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Sign in to manage your servers.
        </p>

        {error && !passkeyRequired ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        ) : null}
        {passkeyRequired ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Passkey required</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This account requires a passkey. Use your saved passkey to continue.
              </p>
              <button
                type="button"
                className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
                onClick={handlePasskeySignIn}
                disabled={passkeySubmitting}
              >
                {passkeySubmitting ? 'Waiting for passkey…' : 'Use passkey'}
              </button>
              <button
                type="button"
                className="mt-3 w-full text-sm font-medium text-slate-600 transition-all duration-300 hover:text-primary-600 dark:text-slate-300 dark:hover:text-primary-400"
                onClick={() => {
                  setPasskeyRequired(false);
                  setAllowPasskeyFallback(true);
                }}
                disabled={passkeySubmitting}
              >
                Sign in another way
              </button>
            </div>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username webauthn"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email ? <p className="text-xs text-red-400">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password webauthn"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-xs text-red-400">{errors.password.message}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
            disabled={isLoading || passkeyRequired}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="rounded border-slate-300" {...register('rememberMe')} />
            Remember me
          </label>
        </form>

        <div className="mt-4">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={handlePasskeySignIn}
            disabled={passkeySubmitting}
          >
            {passkeySubmitting ? 'Waiting for passkey…' : 'Sign in with passkey'}
          </button>
        </div>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={() => handleProvider('whmcs')}
          >
            Continue with WHMCS
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={() => handleProvider('paymenter')}
          >
            Continue with Paymenter
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
