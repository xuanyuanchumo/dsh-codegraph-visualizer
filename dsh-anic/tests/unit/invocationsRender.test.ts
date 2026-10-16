/**
 * renderInvocations 渲染测试（cycle-97 动态白盒分区）。
 *
 * 用 renderToStaticMarkup 真渲染（与 orgStatusRender.test.ts 同纪律）：
 * "返回 ReactElement" 与 "渲染出正确标记" 是两个命题，类型对不等于标记对。
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderInvocations, type InvocationJson, type InvocationsJson } from '../../src/client/features/live/renderInvocations.ts';

function inv(over: Partial<InvocationJson>): InvocationJson {
  return {
    callId: 'c1', name: 'anic_evaluate', argumentsPreview: '{}',
    startedAt: 1, status: 'done', ...over,
  };
}

function snap(invocations: InvocationJson[]): InvocationsJson {
  return { invocations, total: invocations.length, generatedAt: '2026-10-17T00:00:00.000Z' };
}

describe('renderInvocations（动态白盒分区）', () => {
  it('data 为 null：显示等待首轮轮询（不伪造空态引导）', () => {
    const html = renderToStaticMarkup(renderInvocations(null, null));
    expect(html).toContain('data-anic-invocations="section"');
    expect(html).toContain('未取得');
    expect(html).toContain('data-anic-invocations-pending');
    expect(html).not.toContain('data-anic-invocations-empty');
    expect(html).not.toContain('暂无插件调用');
  });
  it('空流：如实显示空态引导文案（与 null 区分）', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([]), null));
    expect(html).toContain('data-anic-invocations-empty');
    expect(html).toContain('暂无插件调用');
    expect(html).toContain('0 条');
  });
  it('三态卡片：done/error/in-flight 各自的状态属性与文案', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([
      inv({ callId: 'a', status: 'done', durationMs: 1234 }),
      inv({ callId: 'b', status: 'error', error: { name: 'GateError', code: 'G1', reason: '缺任务清单' } }),
      inv({ callId: 'c', status: 'in-flight', turn: 2, step: 5 }),
    ]), null));
    expect(html).toContain('data-anic-invocation="a"');
    expect(html).toContain('data-anic-invocation-status="done"');
    expect(html).toContain('data-anic-invocation-status="error"');
    expect(html).toContain('data-anic-invocation-status="in-flight"');
    expect(html).toContain('1234ms');
    expect(html).toContain('GateError(G1)');
    expect(html).toContain('t2/s5'); // turn/step 坐标
    expect(html).toContain('完成');
    expect(html).toContain('失败');
    expect(html).toContain('执行中');
  });
  it('in-flight 卡片带脉冲动画类；样式块含 prefers-reduced-motion 逃逸', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([inv({ status: 'in-flight' })]), null));
    expect(html).toContain('anic-live-dot');
    expect(html).toContain('@keyframes anic-live-pulse');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('animation:none'); // 降级逃逸真的写了 none，不是只声明媒体查询
  });
  it('疑似失联（possiblyOrphaned）显示"疑似失联"而非"执行中"——不把失联伪装成在跑', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([inv({ status: 'in-flight', possiblyOrphaned: true })]), null));
    expect(html).toContain('疑似失联');
    expect(html).not.toContain('>执行中<');
  });
  it('轮询失败：显示失败原因并保留最后已知数据（两个事实同时呈现）', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([inv({ callId: 'a', status: 'done' })]), '路由 500'));
    expect(html).toContain('轮询失败（路由 500）');
    expect(html).toContain('最后已知数据');
    expect(html).toContain('data-anic-invocation="a"'); // 数据仍在，不是空白
  });
  it('错误 reason 截断到 120 字符（不把超长错误刷满面板）', () => {
    const longReason = 'x'.repeat(300);
    const html = renderToStaticMarkup(renderInvocations(snap([inv({ status: 'error', error: { name: 'E', code: 'C', reason: longReason } })]), null));
    expect(html).not.toContain('x'.repeat(121));
    expect(html).toContain('x'.repeat(120));
  });
  it('忠实渲染传入顺序（最新在前的排序契约由 feed.snapshot 承担，见 invocationFeed.test.ts）', () => {
    const html = renderToStaticMarkup(renderInvocations(snap([
      inv({ callId: 'first-passed', name: 'anic_a' }),
      inv({ callId: 'second-passed', name: 'anic_b' }),
    ]), null));
    const iFirst = html.indexOf('data-anic-invocation="first-passed"');
    const iSecond = html.indexOf('data-anic-invocation="second-passed"');
    expect(iFirst).toBeGreaterThan(-1);
    expect(iSecond).toBeGreaterThan(iFirst); // 渲染层不重排：feed 给什么序就什么序
  });
});
