import type { ReactNode } from 'react';

/**
 * One-screen form layout: the sheet on the left, and on the right a sticky panel holding the
 * total, the live sum line, the error and the action button, so they are always in view.
 * Below ~1000px wide the two stack.
 */
export function SplitLayout({
  main,
  panel,
  panelLabel,
}: {
  main: ReactNode;
  panel: ReactNode;
  panelLabel: string;
}) {
  return (
    <div className="split">
      <div className="split-main">{main}</div>
      <aside className="side-panel" aria-label={panelLabel}>
        {panel}
      </aside>
    </div>
  );
}
