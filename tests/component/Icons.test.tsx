import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  GraphIcon,
  SearchIcon,
  ChainIcon,
  CycleIcon,
  MapIcon,
  RefreshIcon,
  SunIcon,
  MoonIcon,
  DownloadIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  UploadIcon,
  FolderIcon,
  AlertIcon,
  LayersIcon,
  ZapIcon,
  WatchIcon,
  WorkspaceIcon,
  PlusIcon,
  CheckIcon,
  CopyIcon,
  TreeIcon,
  PathIcon,
  HeartIcon,
  RuleIcon,
  FlameIcon,
  AlertCircleIcon,
  ExpandIcon,
  ContractIcon,
  FocusIcon,
  UndoIcon,
  RedoIcon,
  StarIcon,
  FilterIcon,
  GithubIcon,
} from '../../src/client/components/Icons.tsx';

describe('Icons', () => {
  afterEach(() => {
    cleanup();
  });

  const icons = [
    { name: 'GraphIcon', Comp: GraphIcon },
    { name: 'SearchIcon', Comp: SearchIcon },
    { name: 'ChainIcon', Comp: ChainIcon },
    { name: 'CycleIcon', Comp: CycleIcon },
    { name: 'MapIcon', Comp: MapIcon },
    { name: 'RefreshIcon', Comp: RefreshIcon },
    { name: 'SunIcon', Comp: SunIcon },
    { name: 'MoonIcon', Comp: MoonIcon },
    { name: 'DownloadIcon', Comp: DownloadIcon },
    { name: 'ChevronDownIcon', Comp: ChevronDownIcon },
    { name: 'ChevronUpIcon', Comp: ChevronUpIcon },
    { name: 'CloseIcon', Comp: CloseIcon },
    { name: 'UploadIcon', Comp: UploadIcon },
    { name: 'FolderIcon', Comp: FolderIcon },
    { name: 'AlertIcon', Comp: AlertIcon },
    { name: 'LayersIcon', Comp: LayersIcon },
    { name: 'ZapIcon', Comp: ZapIcon },
    { name: 'WatchIcon', Comp: WatchIcon },
    { name: 'WorkspaceIcon', Comp: WorkspaceIcon },
    { name: 'PlusIcon', Comp: PlusIcon },
    { name: 'CheckIcon', Comp: CheckIcon },
    { name: 'CopyIcon', Comp: CopyIcon },
    { name: 'TreeIcon', Comp: TreeIcon },
    { name: 'PathIcon', Comp: PathIcon },
    { name: 'HeartIcon', Comp: HeartIcon },
    { name: 'RuleIcon', Comp: RuleIcon },
    { name: 'FlameIcon', Comp: FlameIcon },
    { name: 'AlertCircleIcon', Comp: AlertCircleIcon },
    { name: 'ExpandIcon', Comp: ExpandIcon },
    { name: 'ContractIcon', Comp: ContractIcon },
    { name: 'FocusIcon', Comp: FocusIcon },
    { name: 'UndoIcon', Comp: UndoIcon },
    { name: 'RedoIcon', Comp: RedoIcon },
    { name: 'StarIcon', Comp: StarIcon },
    { name: 'FilterIcon', Comp: FilterIcon },
    { name: 'GithubIcon', Comp: GithubIcon },
  ];

  it('应渲染所有 36 个图标', () => {
    expect(icons.length).toBe(36);
    for (const { name, Comp } of icons) {
      const { container } = render(<Comp />);
      const svg = container.querySelector('svg');
      expect(svg, `${name} 应渲染 svg 元素`).toBeTruthy();
    }
  });

  it('应使用默认 size=16', () => {
    const { container } = render(<GraphIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });

  it('应支持自定义 size', () => {
    const { container } = render(<SearchIcon size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('应支持 className', () => {
    const { container } = render(<CloseIcon className="my-icon" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('my-icon');
  });

  it('svg 应有 viewBox=0 0 24 24', () => {
    const { container } = render(<GraphIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });
});