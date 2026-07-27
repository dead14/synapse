import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageMeta from '../components/common/PageMeta';
import { apiFetch } from '../utils/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit the recovery request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageMeta title="Account recovery | Synapse PIMS" description="Request account recovery" />
      <main className="min-h-screen bg-gray-50 px-4 py-16">
        <section className="mx-auto max-w-md border border-gray-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Account recovery</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Forgot your password?</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            Enter your registered email. The master administrator will receive a recovery request.
          </p>
          {message ? (
            <div className="mt-6 border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900" role="status">
              {message}
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-medium text-gray-800" htmlFor="recovery-email">
                Email address
              </label>
              <input
                id="recovery-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? 'Sending request…' : 'Request recovery'}
              </button>
            </form>
          )}
          <Link className="mt-6 inline-block text-sm font-medium text-blue-700 hover:underline" to="/login">
            Back to sign in
          </Link>
        </section>
      </main>
    </>
  );
}
