import React from 'react';

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

function memo(Component: React.FC<IconProps>) {
  return React.memo(Component);
}

export const GraphIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
    <path d="M5 8v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M12 12v4" />
  </svg>
));

export const SearchIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
));

export const ChainIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
));

export const CycleIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
));

export const MapIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14" /><path d="M15 6v14" />
  </svg>
));

export const RefreshIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />
  </svg>
));

export const SunIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
));

export const MoonIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
));

export const DownloadIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
));

export const ChevronDownIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m6 9 6 6 6-6" /></svg>
));

export const ChevronUpIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m18 15-6-6-6 6" /></svg>
));

export const CloseIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
));

export const UploadIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
));

export const FolderIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
));

export const AlertIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
));

export const LayersIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
));

export const ZapIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg>
));

export const WatchIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="7" /><path d="M12 9v3l2 2" /><path d="M9 1h6M9 23h6" />
  </svg>
));

export const WorkspaceIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
));

export const PlusIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
));

export const CheckIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M20 6 9 17l-5-5" /></svg>
));

export const CopyIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
));

export const TreeIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="2" width="6" height="4" rx="1" />
    <rect x="2" y="18" width="6" height="4" rx="1" />
    <rect x="16" y="18" width="6" height="4" rx="1" />
    <path d="M12 6v4M12 10H5v4M12 10h7v4M5 14v4M19 14v4" />
  </svg>
));

export const PathIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" />
    <path d="M5 7v4a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4" />
  </svg>
));

export const HeartIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
  </svg>
));

export const RuleIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
));

export const FlameIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  </svg>
));

export const AlertCircleIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
  </svg>
));

export const ExpandIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 21H3M21 3H3M9 9l3-3 3 3M9 15l3 3 3-3" />
  </svg>
));

export const ContractIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 21H3M21 3H3M15 9l-3-3-3 3M15 15l-3 3-3-3" />
  </svg>
));

export const FocusIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
  </svg>
));

export const UndoIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </svg>
));

export const RedoIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 7v6h-6" />
    <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
  </svg>
));

export const StarIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
));
export const FilterIcon = memo(({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
));
