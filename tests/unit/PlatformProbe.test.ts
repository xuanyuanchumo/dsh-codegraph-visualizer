/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import {
  detectHostPlatform,
  observeHostPlatform,
} from '../../src/client/compat/PlatformProbe.ts';

/** 清掉 `<html>` 上的平台标记与远程插件的 DOM 痕迹。 */
function resetDom(): void {
  delete document.documentElement.dataset.platform;
  document.documentElement.removeAttribute('data-windows-titlebar');
  document.body.classList.remove('dsh-remote-portrait');
  document.querySelectorAll('style[data-plugin-css]').forEach((el) => el.remove());
}

describe('detectHostPlatform', () => {
  afterEach(resetDom);

  it('reports web when no desktop mark is present', () => {
    resetDom();
    const info = detectHostPlatform();
    expect(info.carrier).toBe('web');
    expect(info.isDesktop).toBe(false);
  });

  it('reports desktop-darwin from the Electron preload mark', () => {
    // 权威依据：dsh-client-ui-primitives/lib/types/darwin-desktop.d.ts 的
    // 「the Electron preload marks `<html>` with data-platform="darwin"」。
    document.documentElement.dataset.platform = 'darwin';
    const info = detectHostPlatform();
    expect(info.carrier).toBe('desktop-darwin');
    expect(info.isDesktop).toBe(true);
  });

  it('reports desktop-windows from the titlebar attribute', () => {
    // 依据：dsh-client-ui-layout/lib/client.js:241 的
    // `document.documentElement.hasAttribute("data-windows-titlebar")`。
    document.documentElement.setAttribute('data-windows-titlebar', '');
    const info = detectHostPlatform();
    expect(info.carrier).toBe('desktop-windows');
    expect(info.isDesktop).toBe(true);
  });

  it('prefers the darwin mark when both are somehow present', () => {
    document.documentElement.dataset.platform = 'darwin';
    document.documentElement.setAttribute('data-windows-titlebar', '');
    expect(detectHostPlatform().carrier).toBe('desktop-darwin');
  });

  it('re-reads the DOM on every call instead of caching', () => {
    // 这是本模块最关键的契约：Electron preload 的标记可能晚到 DOMContentLoaded，
    // 若在 apply() 时刻读一次并缓存，桌面端会被永久误判为网页端。
    resetDom();
    expect(detectHostPlatform().isDesktop).toBe(false);
    document.documentElement.dataset.platform = 'darwin';
    expect(detectHostPlatform().isDesktop).toBe(true);
    resetDom();
    expect(detectHostPlatform().isDesktop).toBe(false);
  });

  it('detects the remote narrow-screen plugin by its body class', () => {
    document.body.classList.add('dsh-remote-portrait');
    expect(detectHostPlatform().isRemoteNarrow).toBe(true);
  });

  it('detects the remote narrow-screen plugin by its injected style tag', () => {
    const style = document.createElement('style');
    style.setAttribute('data-plugin-css', 'dsh-remote-web-ui/mobile-adapt.css');
    document.head.appendChild(style);
    expect(detectHostPlatform().isRemoteNarrow).toBe(true);
  });

  it('keeps desktop and remote-narrow independent', () => {
    document.documentElement.dataset.platform = 'darwin';
    document.body.classList.add('dsh-remote-portrait');
    const info = detectHostPlatform();
    expect(info.isDesktop).toBe(true);
    expect(info.isRemoteNarrow).toBe(true);
  });
});

describe('observeHostPlatform', () => {
  afterEach(resetDom);

  it('notifies when the desktop mark arrives after the fact', async () => {
    resetDom();
    const seen: number[] = [];
    const dispose = observeHostPlatform(() => seen.push(detectHostPlatform().isDesktop ? 1 : 0));

    document.documentElement.dataset.platform = 'darwin';
    // MutationObserver 在微任务里投递。
    await new Promise((resolve) => setTimeout(resolve, 0));

    dispose();
    expect(seen).toContain(1);
  });

  it('stops notifying after disposal', async () => {
    resetDom();
    let calls = 0;
    const dispose = observeHostPlatform(() => { calls += 1; });
    dispose();

    document.documentElement.dataset.platform = 'darwin';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(0);
  });

  it('ignores attribute changes it does not watch', async () => {
    resetDom();
    let calls = 0;
    const dispose = observeHostPlatform(() => { calls += 1; });
    document.documentElement.setAttribute('data-unrelated', '1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    dispose();
    expect(calls).toBe(0);
    document.documentElement.removeAttribute('data-unrelated');
  });
});
