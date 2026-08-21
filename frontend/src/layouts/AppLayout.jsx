import { useEffect, useRef, useState } from 'react';
import { LogOut, Send } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, cx } from '../components/ui';

export function Logo({ className }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
        <Send className="h-4 w-4 text-white" aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">
        Reach<span className="text-brand-600">Inbox</span>
      </span>
    </span>
  );
}

function Avatar({ user, className }) {
  const [broken, setBroken] = useState(false);
  const initials = (user.name || user.email || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  if (user.avatarUrl && !broken) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cx('rounded-full bg-slate-200 object-cover', className)}
      />
    );
  }

  return (
    <span
      className={cx(
        'flex items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700',
        className
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
      >
        <Avatar user={user} className="h-8 w-8" />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-900">{user.name}</span>
          <span className="block max-w-[13rem] truncate text-xs leading-tight text-slate-500">
            {user.email}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-raised animate-rise-in"
        >
          <div className="border-b border-slate-100 px-3.5 py-3 sm:hidden">
            <p className="text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await logout();
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout({ actions, children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-raised"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="flex items-center gap-2 sm:gap-3">
            {actions}
            <div className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>ReachInbox email job scheduler</p>
          <p>Delivery runs through Ethereal - no email reaches a real inbox.</p>
        </div>
      </footer>
    </div>
  );
}

export { Button };
