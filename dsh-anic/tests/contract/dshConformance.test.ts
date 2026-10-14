/**
 * DSH 规范契约守卫 —— 源码形状 + 构建产物（parent CLAUDE.md「源码形状守卫」纪律）。
 *
 * 守卫三条纪律（docs/anic/09 §7）：
 *   1. 反向自检 —— 每个负向断言都先证明自己的正例样例能被匹配（否则坏 regex 永远绿）；
 *   2. 不匹配自身 —— 样例字面量一律拼接构造，避免守卫扫到自己；
 *   3. 扫描集非空 —— files.length 必须有下限断言，静默空扫描等同永久绿。
 *
 * 依据（docs/anic/07 §2，asar 逐行取证）：
 *   - exports["./client"] 是唯一客户端入口权威，缺失即 throw（dsh-client-modules:170-181）；
 *   - client.platform 'web' 是规范值（dsh-client-modules:714）；
 *   - client.inject 是客户端模块图边，只允许官方包（B4 防御）；
 *   - SlotRegistry.register 必须保持原型方法调用，别名提取会让 per-plugin disposal 失效（CRITICAL）；
 *   - icon ≤ 256KiB。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- 扫描助手 ----------
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walkTs(join(PLUGIN_ROOT, 'src'));
const CLIENT_FILES = SRC_FILES.filter((f) => f.includes(`${join('src', 'client')}`));

// ---------- 反向自检样例（拼接构造，永不匹配自身文件） ----------
// 反模式 = 提取未绑定方法（丢 this → per-plugin disposal 失效）：`= api.register` 后不跟 `(`
const ALIAS_SAMPLE = ['const', ' r = api', '.register;'].join('');
// 正形态 A：直接调用；正形态 B：捕获返回的 disposer（必需，不得误伤）
const GOOD_CALL_SAMPLE = ['api', '.register(defn, render);'].join('');
const GOOD_CAPTURE_SAMPLE = ['const registration = api', '.register(defn, render);'].join('');
const CONSOLE_SAMPLE = ['console', '.', 'log("x");'].join('');
const ALIAS_RE = /(?:const|let|var)\s+\w+\s*=\s*api\.register(?!\s*\()/;

// ---------- manifest ----------
const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')) as {
  name: string; type: string; icon: string;
  exports: Record<string, string>;
  dsh: { manifestVersion: number; client: { platform: string; inject: string[] } };
};

describe('manifest 符合 DSH 规范（07 §2 asar 取证）', () => {
  it('type=module 且 manifestVersion=1', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.dsh.manifestVersion).toBe(1);
  });

  it('client.platform = web（规范值；非 web 不加载客户端半边）', () => {
    expect(pkg.dsh.client.platform).toBe('web');
  });

  it('client.inject 只允许官方包（客户端模块图边；第三方包 = B4 破坏性变更面）', () => {
    for (const entry of pkg.dsh.client.inject) {
      expect(entry).toMatch(/^@deepseek-ai\//);
    }
  });

  it('exports["./client"] 存在 —— 唯一客户端入口权威，缺失即宿主 throw', () => {
    expect(pkg.exports['./client']).toBeDefined();
    expect(pkg.exports['./locale/*.json']).toBeDefined();
    expect(pkg.exports['./package.json']).toBeDefined();
  });

  it('icon 存在且 ≤ 256KiB', () => {
    const iconPath = join(PLUGIN_ROOT, pkg.icon.replace(/^\.\//, ''));
    expect(existsSync(iconPath)).toBe(true);
    expect(statSync(iconPath).size).toBeLessThanOrEqual(256 * 1024);
  });

  it('locale en/zh 齐备、meta.title/description 非空、键集对齐', () => {
    const en = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale', 'en.json'), 'utf8')) as Record<string, unknown>;
    const zh = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale', 'zh.json'), 'utf8')) as Record<string, unknown>;
    for (const [name, data] of [['en', en], ['zh', zh]] as const) {
      const meta = data.meta as { title?: string; description?: string } | undefined;
      expect(meta?.title, `${name} meta.title`).toBeTruthy();
      expect(meta?.description, `${name} meta.description`).toBeTruthy();
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});

describe('构建产物契约（dist）', () => {
  it('client bundle 按 __ModuleLoader__.load({id, factory}) 契约包装且语法可解析', () => {
    const clientJs = join(PLUGIN_ROOT, 'dist', 'client.js');
    expect(existsSync(clientJs)).toBe(true);
    const text = readFileSync(clientJs, 'utf8');
    expect(text).toContain('__ModuleLoader__');
    expect(text).toContain('.load(');
    expect(text).toContain('factory');
    expect(() => execFileSync(process.execPath, ['--check', clientJs], { stdio: 'pipe' })).not.toThrow();
  });

  it('host bundle 是 ESM 入口：apply 函数 + inject 服务清单（非空字符串）', async () => {
    const hostJs = join(PLUGIN_ROOT, 'dist', 'host.js');
    expect(existsSync(hostJs)).toBe(true);
    const mod = (await import(`file://${hostJs.split('\\').join('/')}`)) as {
      apply?: unknown; inject?: unknown; name?: unknown;
    };
    expect(typeof mod.apply).toBe('function');
    expect(Array.isArray(mod.inject)).toBe(true);
    for (const s of (mod.inject as unknown[])) expect(typeof s).toBe('string');
    expect((mod.inject as string[]).length).toBeGreaterThan(0);
    expect(mod.name).toBe('dsh-anic');
  });
});

describe('源码形状守卫（slots / disposer / 注入形态）', () => {
  it('扫描集非空（空扫描 = 守卫永久绿的假象）', () => {
    expect(SRC_FILES.length).toBeGreaterThan(3);
    expect(CLIENT_FILES.length).toBeGreaterThan(0);
  });

  it('slots.register 保持原型方法调用 —— 未绑定方法提取会让 per-plugin disposal 失效（CRITICAL）', () => {
    // 反向自检：反模式样例必须被匹配；两种正形态（直接调用 / 捕获 disposer）必须不被匹配
    expect(ALIAS_SAMPLE).toMatch(ALIAS_RE);
    expect(GOOD_CALL_SAMPLE).not.toMatch(ALIAS_RE);
    expect(GOOD_CAPTURE_SAMPLE).not.toMatch(ALIAS_RE);

    const all = CLIENT_FILES.map((f) => ({ f, text: readFileSync(f, 'utf8') }));
    const callers = all.filter((x) => /api\.register\(/.test(x.text));
    expect(callers.length, '至少一处 slots.register 调用').toBeGreaterThan(0);
    for (const { f, text } of callers) {
      expect(text, f).not.toMatch(ALIAS_RE);
    }
  });

  it('conversation.view 走 inject 回调形态（席位由 conversation.session 声明后就绪）', () => {
    const integ = CLIENT_FILES.filter((f) => f.endsWith('WorkflowTabIntegration.ts'));
    expect(integ).toHaveLength(1);
    const text = readFileSync(integ[0] ?? '', 'utf8');
    expect(text).toMatch(/api\.inject\(\s*'conversation\.view'/);
    expect(text).toMatch(/name:\s*'conversation\.view'/);
  });

  it('路由 disposer 不丢弃：snapshotRoute 返回 webServer disposer，宿主入口经 effect 承接', () => {
    const route = SRC_FILES.find((f) => f.endsWith('snapshotRoute.ts'));
    const index = SRC_FILES.find((f) => f.endsWith(join('src', 'index.ts')) || /src[\\/]index\.ts$/.test(f));
    expect(route).toBeDefined();
    expect(index).toBeDefined();
    const routeText = readFileSync(route ?? '', 'utf8');
    expect(routeText).toMatch(/typeof disposer === 'function'\s*\?\s*disposer/);
    const indexText = readFileSync(index ?? '', 'utf8');
    expect(indexText).toMatch(/effect\(\s*\(\)\s*=>\s*registerSnapshotRoute/);
  });

  it('遥测 + kill-switch 双通道在场（J0 可验证性与热卸载）', () => {
    const integ = CLIENT_FILES.find((f) => f.endsWith('WorkflowTabIntegration.ts'));
    const text = readFileSync(integ ?? '', 'utf8');
    expect(text).toContain('__ANIC_TAB_SPIKE__');
    expect(text).toContain("'anic-workflow-tab'");
    expect(text).toMatch(/localStorage\.getItem/);
  });

  it('src/ 零 console.*（日志纪律：宿主面无 scoped logger 前一律静默，观测定向走遥测）', () => {
    expect(CONSOLE_SAMPLE).toMatch(/console\.(log|warn|error|info|debug)\(/);
    for (const f of SRC_FILES) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.(log|warn|error|info|debug)\(/);
    }
  });

  it('宿主 inject 只含必需服务且不含可选服务（registry 走探测不进 inject）', () => {
    const indexText = readFileSync(SRC_FILES.find((f) => /src[\\/]index\.ts$/.test(f)) ?? '', 'utf8');
    expect(indexText).toMatch(/inject\s*=\s*\['webServer',\s*'sessions'\]/);
    expect(indexText).not.toMatch(/inject\s*=\s*\[[^\]]*workspaceRegistry/);
  });
});
