import { useUiStore } from '../store/uiStore';

/**
 * The uiStore's notice over the viewport: its text, its action button if it has one, and a
 * dismiss button. The region is always in the document, so screen readers announce what
 * appears in it; an error is an alert.
 */
export function NoticeBar() {
  const notice = useUiStore((s) => s.notice);
  const dismiss = useUiStore((s) => s.dismissNotice);
  return (
    <div className="notice-region" aria-live="polite">
      {notice && (
        <div className={`notice notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : undefined}>
          <span className="notice-text">{notice.text}</span>
          {notice.action && (
            <button type="button" onClick={notice.action.run}>
              {notice.action.label}
            </button>
          )}
          <button type="button" className="notice-dismiss" aria-label="Dismiss" onClick={dismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
