// Bộ icon nét mảnh (stroke 1.6) thay cho emoji. Luôn aria-hidden; nút chỉ có icon phải có aria-label.
import type { SVGProps } from 'react';

const paths = {
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M7 7l10 10M17 7L7 17',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  crown: 'M4 18h16M5 15l-1-8 5 4 3-6 3 6 5-4-1 8z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  terminal: 'M5 7l5 5-5 5M12 17h7',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  flame: 'M12 21c-4 0-6-2.7-6-6 0-4 4-6 4-10 3 2 5 4.5 5 7 1-1 1.5-2 1.5-3 2 2 1.5 4.5 1.5 6 0 3.3-2 6-6 6z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015-2.7M19 12.5a10 10 0 00-2.3-1.7M2 8.8a15 15 0 015.5-3.3M22 8.8A15 15 0 0012 5',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
