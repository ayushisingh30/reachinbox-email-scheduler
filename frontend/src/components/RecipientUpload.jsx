import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload, X } from 'lucide-react';
import { parseRecipientFile } from '../utils/recipients';
import { formatNumber } from '../utils/format';
import { Button, cx } from './ui';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = /\.(csv|txt)$/i;

/**
 * Drag-and-drop recipient list upload with an immediate parse preview.
 *
 * The counts shown here come from parsing in the browser so the user gets
 * instant feedback; the backend independently re-parses the same list before
 * anything is scheduled.
 */
export function RecipientUpload({ value, onChange, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  const handleFile = useCallback(
    async (file) => {
      setError(null);

      if (!file) return;
      if (!ACCEPTED.test(file.name)) {
        setError('Only .csv and .txt files are supported.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('That file is larger than the 5 MB limit.');
        return;
      }

      setParsing(true);
      setFileName(file.name);
      try {
        const result = await parseRecipientFile(file);
        onChange(result);
        if (result.recipients.length === 0) {
          setError('No valid email addresses were found in that file.');
        }
      } catch (err) {
        setError(err.message);
        onChange(null);
      } finally {
        setParsing(false);
      }
    },
    [onChange]
  );

  const clear = () => {
    onChange(null);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFile(event.dataTransfer.files?.[0]);
  };

  const summary = value;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'relative rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
          disabled && 'opacity-60',
          dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50/60',
          !disabled && 'hover:border-slate-400'
        )}
      >
        <input
          ref={inputRef}
          id="recipient-file"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          disabled={disabled || parsing}
          onChange={(event) => handleFile(event.target.files?.[0])}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-describedby="recipient-file-hint"
        />

        {parsing ? (
          <div className="flex flex-col items-center gap-2 text-slate-600">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">Reading {fileName}...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-6 w-6 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700">
              Drop a CSV or TXT file here, or click to browse
            </p>
            <p id="recipient-file-hint" className="text-xs text-slate-500">
              Any column layout works - every valid address in the file is picked up. Max 5 MB.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {summary && summary.recipients.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3.5" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {formatNumber(summary.validCount)} valid recipient
                  {summary.validCount === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  {fileName && (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      {fileName}
                    </span>
                  )}
                  {summary.invalidCount > 0 && (
                    <span className="text-amber-700">
                      {formatNumber(summary.invalidCount)} invalid skipped
                    </span>
                  )}
                  {summary.duplicateCount > 0 && (
                    <span>{formatNumber(summary.duplicateCount)} duplicates removed</span>
                  )}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={disabled}
              className="shrink-0"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </Button>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Preview
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {summary.recipients.slice(0, 8).map((email) => (
                <li
                  key={email}
                  className="max-w-full truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600"
                >
                  {email}
                </li>
              ))}
              {summary.recipients.length > 8 && (
                <li className="px-1 py-0.5 text-xs text-slate-500">
                  +{formatNumber(summary.recipients.length - 8)} more
                </li>
              )}
            </ul>
          </div>

          {summary.invalidSamples?.length > 0 && (
            <p className="mt-2.5 truncate text-xs text-slate-400">
              Skipped: {summary.invalidSamples.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
