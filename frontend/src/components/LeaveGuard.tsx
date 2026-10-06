import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Warns before leaving a page with unsaved numbers (in-app navigation and closing/reloading the tab).
 * `allowRef.current = true` lets an intentional navigation (after a save) through.
 */
export function LeaveGuard({ dirty, allowRef }: { dirty: boolean; allowRef: { current: boolean } }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && !allowRef.current && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!allowRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, allowRef]);
  if (blocker.state !== 'blocked') return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-label="बिना सेव किए छोड़ें?">
        <p>
          आपने जो संख्याएँ भरी हैं, वे अभी सेव नहीं हुई हैं। क्या आप बिना सेव किए यह पेज छोड़ना चाहते हैं?
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              blocker.reset();
            }}
          >
            रुकें, पेज पर रहें
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              blocker.proceed();
            }}
          >
            बिना सेव किए जाएँ
          </button>
        </div>
      </div>
    </div>
  );
}
