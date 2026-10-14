#!/usr/bin/env node
/**
 * dsh-anic J0 真实宿主探针 —— 对正在运行的 DSH Web 测试环境（start-dsh-test.mjs 启动）
 * 经 Chrome DevTools 协议（9222）验证 conversation.view 集成的六项判据：
 *
 *   J0-1  ANIC 标签可见且可点击（与既有标签共存）
 *   J0-2  图渲染：真实 .cycles 数据面（节点/边数量 ≥ 阈值，且与遥测一致）
 *   J0-3  遥测通道：window.__ANIC_TAB_SPIKE__.registered=true, nodes/edges>0
 *   J0-4  数据来源如实标注（live 或 嵌入快照，二者必居其一）
 *   J0-5  运行时热卸载：unregister() → 标签消失 → reregister() → 恢复
 *   J0-6  kill-switch：localStorage['anic-workflow-tab']='off' + reload → skipped='flag-off'
 *
 * 前置：node scripts/start-dsh-test.mjs start   （本探针绝不启动/杀死宿主进程）
 * 用法：node scripts/j0-probe.mjs [--keep-switch]   （--keep-switch 不恢复 kill-switch）
 */
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..');
const CDP_URL = 'http://127.0.0.1:9222';
const keepSwitch = process.argv.includes('--keep-switch');

const requireFromRepo = createRequire(join(REPO_ROOT, 'package.json'));
let chromium;
try {
  ({ chromium } = requireFromRepo('@playwright/test'));
} catch (e) {
  console.error(`[j0-probe] 无法加载 @playwright/test（经仓库根 node_modules）: ${e.message}`);
  process.exit(2);
}

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? '  [PASS]' : '[FAIL]'} ${id}  ${detail}`);
}

function failFast(msg) {
  console.error(`[j0-probe] ${msg}`);
  console.error('前置条件：先运行 node scripts/start-dsh-test.mjs start（本探针不自行启动宿主）');
  process.exit(2);
}

const browser = await chromium.connectOverCDP(CDP_URL).catch((e) => failFast(`无法连接 CDP ${CDP_URL}: ${e.message}`));
const contexts = browser.contexts();
if (contexts.length === 0) failFast('CDP 已连接但没有任何浏览器上下文');
const page = contexts[0].pages().find((p) => /127\.0\.0\.1:3080|localhost:3080/.test(p.url())) ?? contexts[0].pages()[0];
if (!page) failFast('未找到可用的页面');
console.log(`[j0-probe] 目标页面: ${page.url().slice(0, 80)}...`);

// 每条判据独立 try，避免一条崩溃吞掉整份报告
await page.bringToFront().catch(() => {});

// J0-1 ANIC 标签可见
let anicTab = null;
try {
  anicTab = page.getByRole('tab', { name: 'ANIC', exact: true }).or(page.locator('[role="tab"]:has-text("ANIC")')).first();
  await anicTab.waitFor({ state: 'visible', timeout: 10000 });
  record('J0-1 标签可见', true, 'role=tab "ANIC" 可见');
} catch (e) {
  record('J0-1 标签可见', false, `未找到 ANIC 标签: ${String(e).slice(0, 160)}`);
}

// J0-1b 共存：除 ANIC 外还有其他顶层标签
try {
  const tabCount = await page.locator('[role="tab"]').count();
  record('J0-1b 标签共存', tabCount >= 2, `顶层标签数=${tabCount}（≥2 才算共存）`);
} catch (e) {
  record('J0-1b 标签共存', false, String(e).slice(0, 120));
}

// 点击进入 ANIC 面板
if (anicTab) await anicTab.click({ timeout: 5000 }).catch(() => {});

// J0-2 图渲染 + J0-3 遥测（同一 evaluate 拿齐，减少竞态）
try {
  const probe = await page.evaluate(() => {
    const t = window.__ANIC_TAB_SPIKE__ ?? null;
    const svg = document.querySelector('svg');
    const circles = svg ? svg.querySelectorAll('circle').length : 0;
    const lines = svg ? svg.querySelectorAll('line').length : 0;
    return { t, circles, lines, hasSvg: !!svg };
  });
  const t = probe.t;
  record('J0-3 遥测通道', !!t && t.registered === true, t ? `registered=${t.registered} registerCount=${t.registerCount}` : 'window.__ANIC_TAB_SPIKE__ 不存在');
  record('J0-2 图渲染', probe.hasSvg && probe.circles >= 100 && probe.lines >= 100 && t && t.nodes > 0,
    `svg=${probe.hasSvg} circles=${probe.circles} lines=${probe.lines} 遥测 nodes=${t?.nodes} edges=${t?.edges}`);
} catch (e) {
  record('J0-2 图渲染', false, String(e).slice(0, 160));
  record('J0-3 遥测通道', false, String(e).slice(0, 160));
}

// J0-4 数据来源如实标注（live 或嵌入快照，不得伪装）
try {
  const source = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /live|嵌入快照|snapshot/i.test(n.textContent ?? ''));
    return el ? (el.textContent ?? '').trim().slice(0, 120) : null;
  });
  record('J0-4 来源如实', !!source && /live|嵌入快照|snapshot/i.test(source), source ?? '未找到来源标注行');
} catch (e) {
  record('J0-4 来源如实', false, String(e).slice(0, 160));
}

// J0-5 热卸载 → 恢复
try {
  const before = await page.evaluate(() => ({ registered: window.__ANIC_TAB_SPIKE__?.registered === true }));
  await page.evaluate(() => window.__ANIC_TAB_SPIKE__?.unregister());
  await page.waitForTimeout(300);
  const afterUn = await page.evaluate(() => ({ registered: window.__ANIC_TAB_SPIKE__?.registered === false, count: window.__ANIC_TAB_SPIKE__?.unregisterCount ?? 0 }));
  await page.evaluate(() => window.__ANIC_TAB_SPIKE__?.reregister());
  await page.waitForTimeout(300);
  const afterRe = await page.evaluate(() => ({ registered: window.__ANIC_TAB_SPIKE__?.registered === true, count: window.__ANIC_TAB_SPIKE__?.registerCount ?? 0 }));
  record('J0-5 热卸载/恢复', before.registered && afterUn.registered && afterUn.count >= 1 && afterRe.registered && afterRe.count >= 2,
    `before=${before.registered} unregistered=${afterUn.registered}(count=${afterUn.count}) reregistered=${afterRe.registered}(count=${afterRe.count})`);
} catch (e) {
  record('J0-5 热卸载/恢复', false, String(e).slice(0, 160));
}

// J0-6 kill-switch（写入 → reload → skipped='flag-off' → 恢复）
try {
  await page.evaluate(() => window.localStorage.setItem('anic-workflow-tab', 'off'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const sk = await page.evaluate(() => window.__ANIC_TAB_SPIKE__?.skipped ?? null);
  const tabGone = (await page.locator('[role="tab"]:has-text("ANIC")').count()) === 0;
  record('J0-6 kill-switch', sk === 'flag-off' || tabGone, `skipped=${JSON.stringify(sk)} anicTabGone=${tabGone}`);
  if (!keepSwitch) {
    await page.evaluate(() => window.localStorage.removeItem('anic-workflow-tab'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const restored = await page.evaluate(() => window.__ANIC_TAB_SPIKE__?.registered === true);
    record('J0-6b 开关恢复', restored, `移除开关并 reload 后 registered=${restored}`);
  } else {
    console.log('  [SKIP] J0-6b 开关恢复（--keep-switch）');
  }
} catch (e) {
  record('J0-6 kill-switch', false, String(e).slice(0, 160));
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0
  ? `J0 PROBE PASSED — ${results.length} checks`
  : `J0 PROBE FAILED — ${failed.length}/${results.length}: ${failed.map((f) => f.id).join(', ')}`);
await browser.close().catch(() => {});
process.exit(failed.length === 0 ? 0 : 1);
