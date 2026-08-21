import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { Logo } from '../layouts/AppLayout';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo />
      <p className="mt-10 text-sm font-medium text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        That page does not exist. The dashboard is where your scheduled and sent emails live.
      </p>
      <Button as={Link} to="/dashboard" variant="primary" className="mt-6">
        Back to dashboard
      </Button>
    </div>
  );
}
