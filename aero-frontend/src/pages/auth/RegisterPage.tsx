import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { registerSchema, RegisterSchema } from '../../validators/auth';

function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser, isLoading, error } = useAuthStore();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterSchema>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterSchema) => {
    try {
      await registerUser(values);
      // Redirect on successful registration
      setTimeout(() => {
        navigate('/servers');
      }, 100);
    } catch (err) {
      // Error is already in the store
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/80 px-6 py-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-slate-50">Create account</h1>
        <p className="mt-2 text-sm text-slate-400">Start managing your infrastructure.</p>

        {error ? (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              placeholder="yourname"
              {...register('username')}
            />
            {errors.username ? (
              <p className="text-xs text-red-400">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email ? <p className="text-xs text-red-400">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-slate-200" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-xs text-red-400">{errors.password.message}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-70"
            disabled={isLoading}
          >
            {isLoading ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default RegisterPage;
