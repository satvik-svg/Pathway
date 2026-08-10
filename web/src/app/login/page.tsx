'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/react';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    signInEmailPassword,
    isLoading: signingIn,
    error: signInError,
  } = useSignInEmailPassword();
  const {
    signUpEmailPassword,
    isLoading: signingUp,
    error: signUpError,
  } = useSignUpEmailPassword();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'signin') {
        const res = await signInEmailPassword(email, password);
        if (res.isError || res.error) {
          setError(res.error?.message || signInError?.message || 'Sign in failed');
          return;
        }
      } else {
        const res = await signUpEmailPassword(email, password, {
          displayName: email.split('@')[0],
        });
        if (res.isError || res.error) {
          setError(res.error?.message || signUpError?.message || 'Sign up failed');
          return;
        }
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const loading = signingIn || signingUp;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl">
        <div className="mb-6">
          <p className="text-emerald-400 text-sm font-medium">Chain AI</p>
          <h1 className="text-2xl font-semibold mt-1">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            nhost Auth · org-scoped workflows
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-zinc-400">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
              className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {(error || signInError || signUpError) && (
            <p className="text-sm text-red-400">
              {error || signInError?.message || signUpError?.message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium py-2.5 rounded-md disabled:opacity-50"
          >
            {loading
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Sign up'}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 text-sm text-zinc-400 hover:text-white w-full text-center"
          onClick={() =>
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          }
        >
          {mode === 'signin'
            ? 'Need an account? Sign up'
            : 'Have an account? Sign in'}
        </button>

        <div className="mt-6 pt-4 border-t border-zinc-800">
          <p className="text-[11px] text-zinc-500 mb-2 text-center">
            Interviewer demo accounts (password: password123)
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              'owner-a@example.com',
              'editor-a@example.com',
              'viewer-a@example.com',
              'owner-b@example.com',
            ].map((em) => (
              <button
                key={em}
                type="button"
                className="text-[10px] text-zinc-400 hover:text-emerald-400 border border-zinc-800 rounded px-1.5 py-1 truncate"
                onClick={() => {
                  setMode('signin');
                  setEmail(em);
                  setPassword('password123');
                }}
              >
                {em.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
