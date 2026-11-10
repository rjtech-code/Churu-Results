import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal } from './Modal';

const ALWAYS_ASK = { current: false };

/**
 * The ONE leave check of every form with typed input (booth entry, edit and its confirm step, postal,
 * correction, candidate list): any in-app navigation to another page (tabs and links included) asks
 * first, and closing/reloading the browser tab warns, but only while `dirty`. A form that saved sets
 * `allowRef.current = true` (or is no longer dirty) so its own navigation after the save goes through.
 */
export function LeaveGuard({
  dirty,
  allowRef = ALWAYS_ASK,
}: {
  dirty: boolean;
  allowRef?: { current: boolean };
}) {
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
    <Modal
      label="क्या आप सच में जाना चाहते हैं?"
      onCancel={() => {
        blocker.reset(); // Esc = stay on the page
      }}
    >
      <h2>क्या आप सच में जाना चाहते हैं?</h2>
      <p>सेव नहीं की गई जानकारी खो जाएगी।</p>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            blocker.reset();
          }}
        >
          रुकें
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            blocker.proceed();
          }}
        >
          छोड़कर जाएँ
        </button>
      </div>
    </Modal>
  );
}
