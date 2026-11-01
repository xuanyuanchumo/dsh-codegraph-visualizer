/**
 * @vitest-environment jsdom
 *
 * cycle-130 · T2：数据来源徽章（GL）——StatusBar 对 metadata.graphLayer 的
 * 渲染契约。undefined = host 未提供 ⇒ 缺席渲染（宁缺勿造）；三态各有文案。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { StatusBar } from '../../src/client/components/StatusBar.tsx';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
});

afterEach(() => {
  cleanup();
});

function renderBar(props: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  return render(
    <StatusBar
      error={null}
      isLoading={false}
      lastUpdated={0}
      watchEnabled={false}
      {...props}
    />,
  );
}

describe('数据来源徽章（cycle-130 T2）', () => {
  it('GL-1 graphLayer=upstream 渲染「来源: 索引」', () => {
    renderBar({ graphLayer: 'upstream' });
    expect(screen.getByText('来源: 索引')).toBeTruthy();
  });

  it('GL-2 graphLayer=native 渲染「来源: 原生扫描」且带 native 染色类', () => {
    renderBar({ graphLayer: 'native' });
    const badge = screen.getByText('来源: 原生扫描');
    expect(badge.className).toContain('cg-status-graph-layer--native');
  });

  it('GL-3 graphLayer 缺席（旧版 host）不渲染徽章（宁缺勿造）', () => {
    renderBar({});
    expect(screen.queryByText(/来源:/)).toBeNull();
    expect(document.querySelector('.cg-status-graph-layer')).toBeNull();
  });

  it('GL-4 graphLayer=empty 渲染「来源: 空」', () => {
    renderBar({ graphLayer: 'empty' });
    expect(screen.getByText('来源: 空')).toBeTruthy();
  });
});
