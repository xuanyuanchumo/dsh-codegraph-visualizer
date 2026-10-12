import {
  useRef, useCallback, useLayoutEffect, useMemo, memo, useState, type CSSProperties, type ReactNode,
} from 'react';

import { useDismissable } from '../hooks/useDismissable.ts';
import { Portal } from './Portal.tsx';

export type DropdownChildren = ReactNode | ((close: () => void) => ReactNode);

export interface DropdownProps {
  triggerClassName: string;
  triggerTitle: string;
  triggerAriaLabel: string;
  triggerContent: ReactNode;
  triggerAriaHasPopup?: 'menu' | 'true' | 'false';
  triggerDisabled?: boolean;
  contentClassName?: string;
  contentRole?: string;
  children: DropdownChildren;
  onOpenChange?: (open: boolean) => void;
  closeOnOutsideClick?: boolean;
  containerClassName?: string;
  /** portal 挂载点；缺省 `document.body`，测试可注入容器以保持作用域查询。 */
  portalTarget?: HTMLElement | null;
}

/** 下拉内容与触发器之间的垂直间距。 */
const DROPDOWN_GAP = 6;
/** 下拉内容与视口边缘之间的最小留白。 */
const VIEWPORT_MARGIN = 8;
/** 宿主面板窄于此宽度时，下拉退化为贴面板底部的抽屉。 */
const NARROW_PANEL_PX = 320;
/** 宿主面板根元素选择器，用于测量面板宽度。 */
const PANEL_SELECTOR = '.cg-graph-panel';
/** 抽屉形态与面板边缘之间的留白。 */
const DRAWER_INSET = 4;

/** 下拉内容的定位结果：常规锚定或窄面板抽屉。 */
type DropdownPlacement =
  | { mode: 'anchor'; left: number; top: number }
  | { mode: 'drawer'; left: number; bottom: number; width: number };

export const Dropdown = memo(function Dropdown({
  triggerClassName,
  triggerTitle,
  triggerAriaLabel,
  triggerContent,
  triggerAriaHasPopup,
  triggerDisabled = false,
  contentClassName = 'cg-dropdown-content',
  contentRole,
  children,
  onOpenChange,
  closeOnOutsideClick = true,
  containerClassName = 'cg-dropdown-menu',
  portalTarget,
}: DropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  const toggle = useCallback(() => {
    if (triggerDisabled) return;
    setOpen((v) => {
      const next = !v;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange, triggerDisabled]);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  // 下拉内容被 portal 到 body 之后不再位于 containerRef 内，
  // 因此"外部点击"必须同时对触发器容器与 portal 内容取并集判断。
  const dismissRefs = useMemo(() => [containerRef, contentRef], []);
  useDismissable(dismissRefs, open, close, { closeOnOutsideClick });

  // 内容位置依赖真实渲染尺寸，故在 layout 阶段测量后再写自定义属性；
  // 不使用 inline left/top，避免压过样式表里按 `--cg-portal-*` 声明的定位规则。
  // 注意：内容被 portal 到 body 后不再是 `.cg-graph-panel` 的后代，
  // `@container graphpanel` 查询不再命中，因此窄面板抽屉必须在此按测量结果判定。
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;

    const measure = () => {
      const panel = trigger.closest(PANEL_SELECTOR);
      const panelWidth = panel instanceof HTMLElement ? panel.clientWidth : 0;
      if (panelWidth > 0 && panelWidth <= NARROW_PANEL_PX) {
        const panelRect = (panel as HTMLElement).getBoundingClientRect();
        const width = Math.max(0, panelWidth - DRAWER_INSET * 2);
        setPlacement({
          mode: 'drawer',
          left: panelRect.left + DRAWER_INSET,
          bottom: Math.max(DRAWER_INSET, window.innerHeight - panelRect.bottom + DRAWER_INSET),
          width,
        });
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const width = contentRef.current?.offsetWidth ?? 0;
      const height = contentRef.current?.offsetHeight ?? 0;
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - width, maxLeft));
      let top = rect.bottom + DROPDOWN_GAP;
      if (height > 0 && top + height > window.innerHeight - VIEWPORT_MARGIN) {
        const above = rect.top - height - DROPDOWN_GAP;
        top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
      }
      setPlacement({ mode: 'anchor', left, top });
    };

    measure();
    window.addEventListener('resize', measure);

    // 内容用 `position: fixed` 定位，写进 `--cg-portal-*` 的是**视口坐标**
    // （layout.css 的 `.cg-export-dropdown` / `.cg-dropdown-content`）。
    // 视口坐标只在「触发器的视口位置不变」时才成立，所以页面或任一祖先容器一滚动
    // 就必须重新测量，否则菜单停在原地、触发器移走。实测向下滚 100px 后菜单与
    // 触发器底边的间距从 6px 变成 106px —— 菜单会飘到离触发器很远的地方。
    //
    // capture: true 是必需的：滚动祖先（如 DSH 会话面板）的 scroll 事件不冒泡到
    // window，只有捕获阶段才收得到。
    // 用 rAF 合并同一帧内的多次 scroll，避免每帧多次 setState 重排。
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    window.addEventListener('scroll', onScroll, true);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open]);

  // 五条自定义属性始终全部写出，避免切换形态时残留上一形态的定位值。
  const contentStyle = {
    '--cg-portal-left': `${placement?.left ?? 0}px`,
    '--cg-portal-top': placement?.mode === 'drawer' ? 'auto' : `${placement?.top ?? 0}px`,
    '--cg-portal-bottom': placement?.mode === 'drawer' ? `${placement.bottom}px` : 'auto',
    '--cg-portal-width': placement?.mode === 'drawer' ? `${placement.width}px` : 'auto',
  } as CSSProperties;

  return (
    <div className={containerClassName} ref={containerRef}>
      <button
        ref={triggerRef}
        className={`${triggerClassName} ${open ? 'cg-active' : ''}`}
        onClick={toggle}
        disabled={triggerDisabled}
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        aria-expanded={open}
        aria-haspopup={triggerAriaHasPopup}
        aria-disabled={triggerDisabled || undefined}
      >
        {triggerContent}
      </button>
      {open && !triggerDisabled && (
        <Portal target={portalTarget}>
          <div
            className={`${contentClassName}${placement?.mode === 'drawer' ? ' cg-portal-drawer' : ''}`}
            ref={contentRef}
            style={contentStyle}
            role={contentRole}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </Portal>
      )}
    </div>
  );
});
