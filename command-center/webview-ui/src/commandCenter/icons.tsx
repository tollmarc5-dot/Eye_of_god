import { memo } from 'react';

import type { IconName } from './iconNames.js';

/** Line icons for the command center chrome. They inherit `currentColor`. */
const PATHS: Record<IconName, string> = {
  agents:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-1a5 5 0 0 1 10 0v1M16 11a3 3 0 1 0 0-6M21 20v-1a5 5 0 0 0-4-4.9',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  spark:
    'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v1',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  branch:
    'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3M12 15h5',
  file: 'M6 2h8l5 5v15H6zM14 2v5h5M9 13h7M9 17h7',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h1M4 12h1M4 18h1',
  chat: 'M4 4h16v12H9l-5 4zM9 9h.01M12 9h.01M15 9h.01',
  reply: 'M4 5h16v11H8l-4 4zM8 10h8',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 21 21',
  close: 'M6 6l12 12M18 6 6 18',
  hooks: 'M12 3v6M12 9a4 4 0 1 0 4 4v-2M8 21h8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
};

export const Icon = memo(function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="cc-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
});
