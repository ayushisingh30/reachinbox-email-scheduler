import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Clock3, Database, Gauge, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Alert, Button, Spinner } from '../components/ui';
import { Logo } from '../layouts/AppLayout';

const OAUTH_ERRORS = {
  google_denied: 'Google sign-in was cancelled.',
  state_mismatch: 'That sign-in link expired or was tampered with. Please try again.',
  missing_code: 'Google did not return an authorization code. Please try again.',
};

const HIGHLIGHTS = [
  {
    icon: Clock3,
    title: 'Delayed jobs, not polling',
    body: 'Every email becomes a BullMQ delayed job in Redis. No cron, no interval loops.',
  },
  {
    icon: Gauge,
    title: 'Throttling that actually holds',
    body: 'Per-sender hourly caps and minimum spacing are enforced atomically in Redis, across every worker.',
  },
  {
    icon: Database,
    title: 'Survives a restart',
    body: 'PostgreSQL is the source of truth. Stop everything mid-campaign and the queue picks up where it left off.',
  },
  {
    icon: ShieldCheck,
    title: 'No duplicate sends',
    body: 'A conditional claim in PostgreSQL means a retry, a restart or a second worker cannot send the same email twice.',
  },
];

export function LoginPage() {
  const { status, login, error } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const oauthError = params.get('error');

  useEffect(() => {
    if (!oauthError) return;
    toast.error(OAUTH_ERRORS[oauthError] ?? 'Sign-in failed. Please try again.');
    // Clear the query string so a refresh does not re-raise the same toast.
    params.delete('error');
    setParams(params, { replace: true });
  }, [oauthError, params, setParams, toast]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session..." />
      </div>
    );
  }

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,30rem)]">
      {/* Product context - hidden on small screens so the form leads. */}
      <section className="hidden flex-col justify-between border-r border-slate-200 bg-white px-10 py-12 lg:flex xl:px-16">
        <Logo />

        <div className="max-w-lg">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900">
            Schedule cold email campaigns that respect the limits you set.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            Upload a list, pick a start time, a delay and an hourly cap. ReachInbox queues every
            message and delivers it on schedule.
          </p>

          <ul className="mt-9 space-y-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                  <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-400">
          Messages are delivered to Ethereal, a capture-only SMTP sandbox. Nothing reaches a real
          inbox.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <Logo />
          </div>

          <h2 className="mt-8 text-2xl font-semibold tracking-tight text-slate-900 lg:mt-0">
            Sign in
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Use your Google account to reach the scheduler dashboard.
          </p>

          {error && (
            <Alert tone="error" className="mt-5">
              {error}
            </Alert>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={login}
            className="mt-7 w-full"
            data-testid="google-signin"
          >
            <GoogleMark />
            Continue with Google
          </Button>

          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            Authentication runs entirely on the server using the OAuth 2.0 authorization-code flow.
            Your session is held in an httpOnly cookie.
          </p>

          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="mt-8 text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
          >
            Already signed in? Go to the dashboard
          </button>
        </div>
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#FFF"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.26-2.09 3.56-5.17 3.56-8.87Z"
        opacity=".9"
      />
      <path
        fill="#FFF"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
        opacity=".75"
      />
      <path
        fill="#FFF"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.28a12 12 0 0 0 0 10.74l3.99-3.09Z"
        opacity=".6"
      />
      <path
        fill="#FFF"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
