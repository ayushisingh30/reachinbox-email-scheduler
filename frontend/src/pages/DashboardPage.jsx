import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';

import { AppLayout } from '../layouts/AppLayout';
import { ComposeModal } from '../components/ComposeModal';
import { EmailTable, Pagination } from '../components/EmailTable';
import { Alert, Button, Card, Spinner, cx } from '../components/ui';
import { emailApi, senderApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { formatNumber } from '../utils/format';

const TABS = [
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'sent', label: 'History' },
];

const STAT_CARDS = [
  { key: 'SCHEDULED', label: 'Scheduled', icon: Clock3, tone: 'text-slate-500' },
  { key: 'PROCESSING', label: 'Sending', icon: Loader2, tone: 'text-blue-600' },
  { key: 'RATE_LIMITED', label: 'Rate limited', icon: Gauge, tone: 'text-amber-600' },
  { key: 'SENT', label: 'Sent', icon: CheckCircle2, tone: 'text-emerald-600' },
  { key: 'FAILED', label: 'Failed', icon: AlertCircle, tone: 'text-rose-600' },
];

const REFRESH_MS = 10000;

function StatCard({ label, value, icon: Icon, tone, spin }) {
  return (
    <div className="surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <Icon className={cx('h-4 w-4', tone, spin && 'animate-spin')} aria-hidden="true" />
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
        {formatNumber(value)}
      </p>
    </div>
  );
}

export function DashboardPage() {
  const { status } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('scheduled');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [stats, setStats] = useState(null);
  const [emails, setEmails] = useState(null);
  const [senders, setSenders] = useState([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  const loadedOnce = useRef(false);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRefreshing(true);
      try {
        const list = tab === 'scheduled' ? emailApi.scheduled : emailApi.sent;
        const [statsData, listData] = await Promise.all([
          emailApi.stats(),
          list({ page, pageSize: 25, search }),
        ]);
        setStats(statsData);
        setEmails(listData);
        setLoadError(null);
      } catch (err) {
        // A background refresh failing should not blow away what is on screen.
        if (!silent || !loadedOnce.current) setLoadError(err.message);
      } finally {
        loadedOnce.current = true;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [tab, page, search]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    senderApi
      .list()
      .then((data) => setSenders(data.items ?? []))
      .catch((err) => toast.error(`Could not load senders: ${err.message}`));
  }, [toast]);

  const hasInFlight = Boolean(
    stats && (stats.SCHEDULED > 0 || stats.PROCESSING > 0 || stats.RATE_LIMITED > 0)
  );

  // Poll only while there is something to watch, and pause on a hidden tab.
  useEffect(() => {
    if (!hasInFlight) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasInFlight, load]);

  const handleCancel = async (email) => {
    setCancellingId(email.id);
    try {
      await emailApi.cancel(email.id);
      toast.success(`Cancelled the email to ${email.recipient}.`);
      await load({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancellingId(null);
    }
  };

  const statValues = useMemo(
    () => STAT_CARDS.map((card) => ({ ...card, value: stats?.[card.key] ?? 0 })),
    [stats]
  );

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your workspace..." />
      </div>
    );
  }

  if (status === 'anonymous') return <Navigate to="/login" replace />;

  return (
    <AppLayout
      actions={
        <Button variant="primary" onClick={() => setComposeOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Compose new email</span>
          <span className="sm:hidden">Compose</span>
        </Button>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything you have queued, with the exact time each email goes out.
          </p>
        </div>

        {loadError && (
          <Alert tone="error" title="Could not load your emails">
            {loadError}{' '}
            <button
              type="button"
              onClick={() => load()}
              className="font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {initialLoading
            ? STAT_CARDS.map((card) => (
                <div key={card.key} className="surface h-[5.25rem] animate-pulse bg-slate-50" />
              ))
            : statValues.map((card) => (
                <StatCard
                  key={card.key}
                  label={card.label}
                  value={card.value}
                  icon={card.icon}
                  tone={card.tone}
                  spin={card.key === 'PROCESSING' && card.value > 0}
                />
              ))}
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div
              className="inline-flex rounded-lg bg-slate-100 p-0.5"
              role="tablist"
              aria-label="Email views"
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => {
                    setTab(item.id);
                    setPage(1);
                  }}
                  className={cx(
                    'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                    tab === item.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search recipient or subject"
                  aria-label="Search emails"
                  className="field-control w-full pl-9 sm:w-64"
                />
              </div>

              <Button
                size="icon"
                onClick={() => load()}
                disabled={refreshing}
                aria-label="Refresh"
                title="Refresh"
              >
                <RefreshCw
                  className={cx('h-4 w-4', refreshing && 'animate-spin')}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>

          <EmailTable
            view={tab}
            data={emails}
            loading={initialLoading || refreshing}
            searchTerm={search}
            onCancel={handleCancel}
            cancellingId={cancellingId}
            onCompose={() => setComposeOpen(true)}
          />

          <Pagination data={emails} onPageChange={setPage} loading={refreshing} />
        </Card>

        {hasInFlight && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Auto-refreshing every {REFRESH_MS / 1000} seconds while emails are in the queue.
          </p>
        )}
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        senders={senders}
        onScheduled={() => {
          setTab('scheduled');
          setPage(1);
          load({ silent: true });
        }}
      />
    </AppLayout>
  );
}
