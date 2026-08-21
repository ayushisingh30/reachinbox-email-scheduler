import { ExternalLink, Inbox, MailX, Search, XCircle } from 'lucide-react';
import { Button, EmptyState, Spinner, StatusBadge, cx } from './ui';
import { formatDateTime, formatNumber, formatRelative } from '../utils/format';

const CANCELLABLE = new Set(['SCHEDULED', 'RATE_LIMITED']);

function TimeCell({ email, view }) {
  if (view === 'scheduled') {
    return (
      <div>
        <div className="whitespace-nowrap text-slate-700">{formatDateTime(email.scheduledAt)}</div>
        <div className="mt-0.5 whitespace-nowrap text-xs text-slate-400">
          {formatRelative(email.scheduledAt)}
        </div>
      </div>
    );
  }

  const at = email.sentAt || email.failedAt;
  return (
    <div>
      <div className="whitespace-nowrap text-slate-700">{at ? formatDateTime(at) : '--'}</div>
      {at && (
        <div className="mt-0.5 whitespace-nowrap text-xs text-slate-400">{formatRelative(at)}</div>
      )}
    </div>
  );
}

function ResultCell({ email }) {
  if (email.status === 'SENT') {
    return email.previewUrl ? (
      <a
        href={email.previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
      >
        View message
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    ) : (
      <span className="text-sm text-slate-400">Delivered</span>
    );
  }

  if (email.errorMessage) {
    return (
      <span className="line-clamp-2 text-sm text-rose-600" title={email.errorMessage}>
        {email.errorMessage}
      </span>
    );
  }

  return <span className="text-sm text-slate-400">--</span>;
}

export function EmailTable({ view, data, loading, searchTerm, onCancel, cancellingId, onCompose }) {
  const items = data?.items ?? [];

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner label="Loading emails..." />
      </div>
    );
  }

  if (items.length === 0) {
    if (searchTerm) {
      return (
        <EmptyState
          icon={Search}
          title="No matching emails"
          description={`Nothing matches "${searchTerm}". Try a different recipient or subject.`}
        />
      );
    }

    return view === 'scheduled' ? (
      <EmptyState
        icon={Inbox}
        title="Nothing in the queue"
        description="Scheduled emails appear here with their exact send time until the worker picks them up."
        action={
          onCompose && (
            <Button variant="primary" onClick={onCompose}>
              Compose new email
            </Button>
          )
        }
      />
    ) : (
      <EmptyState
        icon={MailX}
        title="No delivery history yet"
        description="Once the worker sends your first email, it shows up here with a link to the delivered message."
      />
    );
  }

  return (
    <div className={cx('overflow-x-auto', loading && 'opacity-60 transition-opacity')}>
      <table className="w-full min-w-[52rem] border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th scope="col" className="table-head">
              Recipient
            </th>
            <th scope="col" className="table-head">
              Subject
            </th>
            <th scope="col" className="table-head">
              Sender
            </th>
            <th scope="col" className="table-head">
              {view === 'scheduled' ? 'Send time' : 'Completed'}
            </th>
            <th scope="col" className="table-head">
              Status
            </th>
            <th scope="col" className="table-head">
              {view === 'scheduled' ? '' : 'Result'}
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.map((email) => (
            <tr key={email.id} className="transition-colors hover:bg-slate-50/70">
              <td className="table-cell font-medium text-slate-900">
                <span className="block max-w-[16rem] truncate" title={email.recipient}>
                  {email.recipient}
                </span>
              </td>

              <td className="table-cell">
                <span className="block max-w-[18rem] truncate" title={email.subject}>
                  {email.subject}
                </span>
              </td>

              <td className="table-cell">
                <span
                  className="block max-w-[14rem] truncate text-slate-500"
                  title={email.sender?.email}
                >
                  {email.sender?.email ?? '--'}
                </span>
              </td>

              <td className="table-cell">
                <TimeCell email={email} view={view} />
              </td>

              <td className="table-cell">
                <div className="flex items-center gap-2">
                  <StatusBadge status={email.status} />
                  {email.attempts > 1 && (
                    <span className="text-xs text-slate-400" title="Delivery attempts">
                      {email.attempts}x
                    </span>
                  )}
                </div>
              </td>

              <td className="table-cell">
                {view === 'scheduled' ? (
                  CANCELLABLE.has(email.status) && onCancel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCancel(email)}
                      loading={cancellingId === email.id}
                      className="text-slate-500 hover:text-rose-600"
                    >
                      {cancellingId !== email.id && (
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Cancel
                    </Button>
                  ) : null
                ) : (
                  <ResultCell email={email} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ data, onPageChange, loading }) {
  if (!data || data.total === 0) return null;

  const { page, pageSize, total } = data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 sm:flex-row">
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{formatNumber(first)}</span>-
        <span className="font-medium text-slate-700">{formatNumber(last)}</span> of{' '}
        <span className="font-medium text-slate-700">{formatNumber(total)}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
        >
          Previous
        </Button>
        <span className="px-1 text-sm text-slate-500">
          Page {page} of {pages}
        </span>
        <Button
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages || loading}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
