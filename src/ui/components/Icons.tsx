import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const CalendarIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M8 2v4M16 2v4M3 10h18" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
  </svg>
);

export const SparklesIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 3l1.7 4.7L18.5 9.5l-4.8 1.8L12 16l-1.7-4.7L5.5 9.5l4.8-1.8L12 3z" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
  </svg>
);

export const RefreshIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const CloseIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const ClockIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const ExternalLinkIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M14 5h5v5" />
    <path d="M10 14L19 5" />
    <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
  </svg>
);

export const CheckIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </svg>
);

export const CheckCircleIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.3 2.3 4.8-5" />
  </svg>
);

export const EyeOffIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C6.5 20 2.73 16.11 1 12a21.8 21.8 0 0 1 5.06-6.94" />
    <path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c5.5 0 9.27 3.89 11 8a21.8 21.8 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="M2 2l20 20" />
  </svg>
);

export const SearchIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const CopyIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const DownloadIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);

export const SettingsIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 .99-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51.99H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const SunIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const AlertTriangleIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const UploadIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 15V3" />
    <path d="M7 8l5-5 5 5" />
    <path d="M5 20h14" />
  </svg>
);

export const LayersIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

export const GripIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const ChevronDownIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const HelpCircleIcon = ({ size, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.8.9c0 1.6-2.3 2.1-2.3 3.1" />
    <path d="M12 17h.01" />
  </svg>
);
