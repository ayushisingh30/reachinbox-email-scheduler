import { useEffect, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Modal } from './Modal';
import { RecipientUpload } from './RecipientUpload';
import { Alert, Button, Field } from './ui';
import { emailApi } from '../services/api';
import { useToast } from '../hooks/useToast';
import { formatDelay, formatNumber, pluralize, toLocalInputValue } from '../utils/format';

const DEFAULTS = {
  subject: '',
  body: '',
  startTime: '',
  delaySeconds: 2,
  hourlyLimit: 100,
};

/** Mirrors the server's estimate so the user can see the shape of the run. */
function estimateDuration({ count, delaySeconds, hourlyLimit }) {
  if (!count) return null;
  const waves = Math.ceil(count / Math.max(1, hourlyLimit));
  const lastWaveSize = count - (waves - 1) * hourlyLimit;
  const spanMs = (waves - 1) * 3600000 + Math.max(0, lastWaveSize - 1) * delaySeconds * 1000;
  return { waves, spanMs };
}

function formatSpan(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}

export function ComposeModal({ open, onClose, senders, onScheduled }) {
  const toast = useToast();

  const [form, setForm] = useState(DEFAULTS);
  const [senderId, setSenderId] = useState('');
  const [parsed, setParsed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // A fresh key per open: retrying the same submission is idempotent server
  // side, but a new campaign must not reuse a previous key.
  const requestKey = useRef(null);

  useEffect(() => {
    if (!open) return;
    setForm(DEFAULTS);
    setParsed(null);
    setFormError(null);
    setFieldErrors({});
    setSenderId((current) => current || senders[0]?.id || '');
    requestKey.current =
      globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, [open, senders]);

  const set = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const recipientCount = parsed?.recipients.length ?? 0;

  const estimate = useMemo(
    () =>
      estimateDuration({
        count: recipientCount,
        delaySeconds: Number(form.delaySeconds) || 0,
        hourlyLimit: Number(form.hourlyLimit) || 1,
      }),
    [recipientCount, form.delaySeconds, form.hourlyLimit]
  );

  function validate() {
    const errors = {};
    if (!form.subject.trim()) errors.subject = 'A subject is required.';
    if (!form.body.trim()) errors.body = 'An email body is required.';
    if (!senderId) errors.senderId = 'Choose a sender.';

    const delay = Number(form.delaySeconds);
    if (!Number.isFinite(delay) || delay < 0) errors.delaySeconds = 'Enter 0 or more seconds.';

    const limit = Number(form.hourlyLimit);
    if (!Number.isFinite(limit) || limit < 1) errors.hourlyLimit = 'Enter at least 1.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (recipientCount === 0) {
      setFormError('Upload a CSV or TXT file with at least one valid recipient first.');
      return;
    }
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await emailApi.schedule(
        {
          senderId,
          subject: form.subject.trim(),
          body: form.body,
          recipients: parsed.recipients,
          startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
          delayBetweenSeconds: Number(form.delaySeconds),
          hourlyLimit: Number(form.hourlyLimit),
        },
        requestKey.current
      );

      toast.success(
        result.replayed
          ? 'That campaign was already scheduled - showing the original.'
          : `Scheduled ${pluralize(result.scheduled, 'email')}.`
      );
      onScheduled?.(result);
      onClose();
    } catch (err) {
      // A 503 here means the emails are saved and will be queued on recovery,
      // so it is phrased as a warning rather than a hard failure.
      setFormError(err.message);
      if (err.status !== 503) toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Compose new email"
      description="Upload a recipient list, then choose how fast it should go out."
      size="xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="compose-form"
            variant="primary"
            loading={submitting}
            disabled={submitting || recipientCount === 0}
          >
            {!submitting && <Send className="h-4 w-4" aria-hidden="true" />}
            {submitting ? 'Scheduling...' : `Schedule ${formatNumber(recipientCount)}`}
          </Button>
        </>
      }
    >
      <form id="compose-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {formError && <Alert tone="warning">{formError}</Alert>}

        <Field
          label="From"
          htmlFor="senderId"
          required
          error={fieldErrors.senderId}
          hint="SMTP credentials stay on the server; only the identity is stored."
        >
          <select
            id="senderId"
            className="field-control"
            value={senderId}
            onChange={(event) => setSenderId(event.target.value)}
            disabled={submitting || senders.length === 0}
          >
            {senders.length === 0 && <option value="">No sender available</option>}
            {senders.map((sender) => (
              <option key={sender.id} value={sender.id}>
                {sender.name} &lt;{sender.email}&gt;
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subject" htmlFor="subject" required error={fieldErrors.subject}>
          <input
            id="subject"
            type="text"
            className={`field-control ${fieldErrors.subject ? 'field-control-invalid' : ''}`}
            placeholder="Quick question about your outbound process"
            value={form.subject}
            onChange={set('subject')}
            maxLength={300}
            disabled={submitting}
          />
        </Field>

        <Field
          label="Body"
          htmlFor="body"
          required
          error={fieldErrors.body}
          hint="Plain text. Line breaks are preserved in the delivered email."
        >
          <textarea
            id="body"
            rows={7}
            className={`field-control resize-y ${fieldErrors.body ? 'field-control-invalid' : ''}`}
            placeholder={'Hi there,\n\nI noticed your team is scaling outbound...'}
            value={form.body}
            onChange={set('body')}
            disabled={submitting}
          />
        </Field>

        <Field label="Recipients" required>
          <RecipientUpload value={parsed} onChange={setParsed} disabled={submitting} />
        </Field>

        <div className="grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-3">
          <Field
            label="Start sending"
            htmlFor="startTime"
            hint="Leave blank to start now."
            error={fieldErrors.startTime}
          >
            <input
              id="startTime"
              type="datetime-local"
              className="field-control"
              value={form.startTime}
              min={toLocalInputValue()}
              onChange={set('startTime')}
              disabled={submitting}
            />
          </Field>

          <Field
            label="Delay between emails"
            htmlFor="delaySeconds"
            hint="Seconds between two sends."
            error={fieldErrors.delaySeconds}
          >
            <input
              id="delaySeconds"
              type="number"
              min={0}
              max={3600}
              className={`field-control ${fieldErrors.delaySeconds ? 'field-control-invalid' : ''}`}
              value={form.delaySeconds}
              onChange={set('delaySeconds')}
              disabled={submitting}
            />
          </Field>

          <Field
            label="Hourly limit"
            htmlFor="hourlyLimit"
            hint="Max emails per sender per hour."
            error={fieldErrors.hourlyLimit}
          >
            <input
              id="hourlyLimit"
              type="number"
              min={1}
              max={10000}
              className={`field-control ${fieldErrors.hourlyLimit ? 'field-control-invalid' : ''}`}
              value={form.hourlyLimit}
              onChange={set('hourlyLimit')}
              disabled={submitting}
            />
          </Field>
        </div>

        {estimate && recipientCount > 0 && (
          <Alert tone="info">
            {formatNumber(recipientCount)} emails, one every {formatDelay(form.delaySeconds * 1000)},
            capped at {formatNumber(form.hourlyLimit)}/hour
            {estimate.waves > 1
              ? ` - delivered across ${estimate.waves} hourly waves, finishing ${formatSpan(estimate.spanMs)} after the start time.`
              : ` - the whole run takes ${formatSpan(estimate.spanMs)}.`}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
