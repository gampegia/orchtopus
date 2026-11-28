// The read-only setup check: one row per item with an icon and a status word, its detail, and
// a copy button for a suggested fix. Orchtopus applies nothing; the user copies and runs it.
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info, Lightbulb, type LucideIcon } from 'lucide-react';
import type { SetupItem } from '../../shared/api-types';

const STATUS_ICON: Record<SetupItem['status'], LucideIcon> = {
  ok: CircleCheck,
  hint: Lightbulb,
  problem: CircleAlert,
  info: Info,
};

const COPIED_MS = 1500;

/**
 * Copies text through a selected textarea. The app denies every permission (security.ts), so
 * navigator.clipboard is refused; the copy command works inside the user's click without one.
 */
function copyText(text: string, near: HTMLElement): Promise<void> {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  // Next to the button, inside the dialog, so the dialog's focus trap leaves the selection alone.
  near.after(area);
  area.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only copy without a permission
  const copied = document.execCommand('copy');
  area.remove();
  near.focus();
  return copied ? Promise.resolve() : Promise.reject(new Error('copy failed'));
}

function CopyButton({ text, title }: { text: string; title: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const copy = (event: React.MouseEvent<HTMLButtonElement>): void => {
    copyText(text, event.currentTarget)
      .then(() => {
        setState('copied');
      })
      .catch(() => {
        setState('failed');
      })
      .finally(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setState('idle');
        }, COPIED_MS);
      });
  };

  return (
    <button type="button" className="btn small" onClick={copy}>
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
      <span className="visually-hidden"> fix for {title}</span>
    </button>
  );
}

export function SetupChecklist({ items }: { items: readonly SetupItem[] }): React.JSX.Element {
  return (
    <ul role="list" aria-label="Setup check" className="checklist">
      {items.map((item) => {
        const Icon = STATUS_ICON[item.status];
        return (
          <li key={item.id} className="check-item" data-status={item.status}>
            <Icon className="icon-small check-icon" strokeWidth={1.5} aria-hidden="true" />
            <div className="check-body">
              <div className="check-head">
                <span className="check-title">{item.title}</span>
                <span className="check-word" data-status-word>
                  {item.status}
                </span>
              </div>
              <p className="check-detail">{item.detail}</p>
              {item.fix !== null && (
                <div className="check-fix">
                  <code className="mono truncate" title={item.fix}>
                    {item.fix}
                  </code>
                  <CopyButton text={item.fix} title={item.title} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
