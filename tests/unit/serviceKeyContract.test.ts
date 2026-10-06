import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 契约守卫：**外部服务键不得凭空发明**（cycle-83 / Round 19）。
 *
 * ## 为什么需要这条守卫
 *
 * 本项目曾围绕三个**并不存在**的 cordis 服务键写了三套集成：
 * `remoteWebUI`、`spotlight`、`desktopProfiles`。它们的集成函数在任何 DSH 环境下
 * 都在第一行早退，是死代码；但它们的测试（合计 100+ 处断言）**全绿**，
 * 因为夹具自己伪造了那两个服务对象。也就是说：**测试证明了自洽，而不是正确。**
 *
 * 这条守卫把"服务键必须可追溯到真实证据"变成编译期之后的第二道门：
 * 任何新增的 `ctx.get('<key>')` / `hasService(ctx, '<key>')` 都必须先落进
 * `ALLOWED_SERVICE_KEYS`，而该白名单的每一项都在注释里带着来源路径与行号。
 *
 * ## 证据来源
 *
 * `docs/research/dsh-多代API规范差异与兼容矩阵.md` §2：
 * - `<A>` = `…\@deepseek-ai\dsh\node_modules\@deepseek-ai`（gen2 / 0.2.0-rc.2）
 * - `<V>` = `…\.vscode\extensions\zwb8926.deepseekharness-for-vscode-2026.9.24\node_modules\@deepseek-ai`（gen1 / 0.1.7-rc.1）
 * - `<W>` = `…\.dsh\profiles\web\node_modules`（已装第三方插件）
 *
 * ## 一个反直觉的坑
 *
 * 本文件的检查必须**先剥掉注释**。因为被删除的幻影键在代码注释里被大量引用
 * （"此处曾探测 `remoteWebUI`…"），不剥注释就会把这些**教学性引用**误判成
 * 真实使用点，守卫会永远红。`workspacePathContract.test.ts` 用了同样的手法，
 * 理由也相同：**解释某个 workaround 被移除的散文，不应满足针对该 workaround 的检查。**
 */

const ROOT = path.resolve(__dirname, '../..');

/** 剥掉整行注释与块注释起始行，使散文中提到的键名不参与匹配。 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(
      (line) =>
        !line.trim().startsWith('//') &&
        !line.trim().startsWith('*') &&
        !line.trim().startsWith('/*'),
    )
    .join('\n');
}

function collectSources(dir: string): Array<{ rel: string; code: string; raw: string }> {
  const out: Array<{ rel: string; code: string; raw: string }> = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
        const raw = fs.readFileSync(full, 'utf8');
        out.push({ rel: path.relative(ROOT, full).replace(/\\/g, '/'), code: codeOnly(raw), raw });
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/**
 * 已被真实证据确认存在的服务键白名单。
 *
 * 每一条都必须能指向一处 `reflect.provide(` 或一个已装插件的 `ctx.get` 调用点；
 * 拿不出证据的键不得进入此表。**新增条目时必须同时补上证据注释。**
 */
const ALLOWED_SERVICE_KEYS: Readonly<Record<string, string>> = {
  // 本插件唯一的硬依赖（`src/client/index.ts` 的 `inject = ['slots']`）。
  // 探针不走 `ctx.get`，见 ClientCompatLayer.hasSlots（属性访问）。
  slots: 'client/index.ts inject; dsh-client-ui-slots（两代逐字节相同）',

  // DSH 原生右侧栏 tab 注册表。
  // 提供点：<A>\dsh-client-ui-sidebar-right\lib\client.js:9073
  //   `const disposeRegistry = ctx.reflect.provide("sidebarRightTabs", tabs);`
  // gen1 同形：<V> 同文件（行号相差约 585，代码逐行同形）⇒ 两代都有，不可作定代依据。
  sidebarRightTabs: '<A> dsh-client-ui-sidebar-right/lib/client.js:9073 reflect.provide("sidebarRightTabs")',

  // 第三方 `dsh-better-sidebar` 的 tab 服务。
  // 提供点：<W>\dsh-better-sidebar\lib\client-registry.js:23111 `ctx.provide("betterSidebar", service);`
  betterSidebar: '<W> dsh-better-sidebar/lib/client-registry.js:23111 provide("betterSidebar")',

  // 命令贡献面。经 `Service` 基类注册，故不出现在 `reflect.provide` 静态扫描里。
  // 提供点：<A>\dsh-client-ui-commands\lib\client.js:771 `super(ctx, "commandUi");`
  //        <V>\dsh-client-ui-commands\lib\client.js:737 同形 ⇒ 两代都有。
  commandUi: '<A>/<V> dsh-client-ui-commands/lib/client.js super(ctx, "commandUi")',

  // 宿主侧工作区注册表（gen2 有；gen1 亦有，见 <V>\dsh-workspace\lib\index.js:374）。
  // 提供点：<A>\dsh-workspace\lib\index.js:374 `super(ctx, "workspaceRegistry");`
  workspaceRegistry: '<A> dsh-workspace/lib/index.js:374 super(ctx, "workspaceRegistry")',

  // 会话服务，本插件 `inject` 列表必需项（`src/index.ts`）。
  sessions: 'client/index.ts inject + <A> dsh-api-session-controller/lib/client.js',

  // —— 以下两个是 gen2 独有服务，用作代际判别信号 ——
  // <A>\dsh-client-ui-plugin-manager\lib\client.js
  //   `ctx.reflect.provide("pluginNavigation", { openBundle: (packageName) => {…`
  // <V> 全树零命中（`dsh-client-ui-plugin-manager` 这个包 gen1 也存在，但 provide 只在 gen2）。
  pluginNavigation: '<A> dsh-client-ui-plugin-manager/lib/client.js provide("pluginNavigation")；<V> 零命中',
  // <A>\dsh-client-ui-user-questions\lib\client.js
  //   `ctx.reflect.provide("userQuestionPanels", { reveal: …, review: … })`
  // <V> 全树零命中。
  userQuestionPanels: '<A> dsh-client-ui-user-questions/lib/client.js provide("userQuestionPanels")；<V> 零命中',

  // 文档预览服务：**两代都有**（<A>:286 / <V>:281），只作「身处客户端」的下界证据。
  documentPreviews: '<A>/<V> dsh-client-ui-sidebar-documentpreview/lib/client.js provide("documentPreviews")',
};

/** 被证伪的幻影键：出现即失败，除非在注释里（已由 codeOnly 剥离）。 */
const PHANTOM_SERVICE_KEYS = ['remoteWebUI', 'spotlight', 'desktopProfiles'] as const;

function scanLiteralLookups(code: string): Array<{ key: string }> {
  const found: Array<{ key: string }> = [];
  const patterns = [/ctx\.get\(\s*'([^']+)'/g, /hasService\(ctx,\s*'([^']+)'/g];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) found.push({ key });
    }
  }
  return found;
}

/** 提取形如 `const NAME = ['a', 'b'] as const;` 的数组字面量内容。 */
function extractStringArray(code: string, constName: string): string[] {
  const match = code.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]`));
  const body = match?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((value): value is string => value !== undefined);
}

const SRC_FILES = collectSources('src');

describe('external service key contract (cycle-83)', () => {
  it('only probes service keys that carry recorded evidence', () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      for (const { key } of scanLiteralLookups(file.code)) {
        if (!Object.hasOwn(ALLOWED_SERVICE_KEYS, key)) {
          offenders.push(`${file.rel} probes '${key}'`);
        }
      }
    }
    expect(offenders, '新增服务键前必须先在 ALLOWED_SERVICE_KEYS 里登记证据').toEqual([]);
  });

  it('never resurrects a phantom service key in executable code', () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      for (const phantom of PHANTOM_SERVICE_KEYS) {
        // 代码里不得出现该字面量（注释已被 codeOnly 剥离）。
        if (file.code.includes(`'${phantom}'`) || file.code.includes(`"${phantom}"`)) {
          offenders.push(`${file.rel} mentions '${phantom}' in code`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the probe-evidence tables free of phantom keys', () => {
    const probe = SRC_FILES.find((f) => f.rel.endsWith('host/compat/HostCapabilityProbe.ts'));
    expect(probe, 'HostCapabilityProbe.ts 必须存在').toBeTruthy();
    // 证据表里的每个键都必须是白名单成员。
    const evidenceKeys = extractStringArray(probe!.code, 'SERVICE_EVIDENCE').concat(
      extractStringArray(probe!.code, 'TOOL_EVIDENCE'),
    );
    // 工具名不在服务键白名单里，按前缀区分。
    const serviceKeys = evidenceKeys.filter((k) => !k.startsWith('codegraph_'));
    for (const key of serviceKeys) {
      expect(Object.hasOwn(ALLOWED_SERVICE_KEYS, key), `证据表里的 '${key}' 未登记`).toBe(true);
    }
    // 幻影键不得出现在证据表里（含工具名）。注意用 code 而非 raw：
    // 文件注释里**应当**留有「此处曾探测 remoteWebUI，cycle-83 删除」这类教学性说明，
    // 那是有价值的记录，不是违规。
    for (const phantom of PHANTOM_SERVICE_KEYS) {
      expect(probe!.code).not.toContain(`'${phantom}'`);
    }
  });

  it('identifies a generation only by services exclusive to one line', () => {
    const detector = SRC_FILES.find((f) => f.rel.endsWith('client/compat/ClientVersionDetector.ts'));
    expect(detector).toBeTruthy();
    const gen2Only = extractStringArray(detector!.code, 'GEN2_ONLY_SERVICES');
    // 只有这两个键在 gen1 树里零命中，因此只有它们可以定 gen2。
    expect([...gen2Only].sort()).toEqual(['pluginNavigation', 'userQuestionPanels']);
    // 两代都有的服务必须待在 SHARED_SERVICES 里，不得混进 GEN2_ONLY_SERVICES。
    const shared = extractStringArray(detector!.code, 'SHARED_SERVICES');
    expect([...shared].sort()).toEqual(['documentPreviews', 'sidebarRightTabs']);
    for (const key of shared) {
      expect(gen2Only).not.toContain(key);
    }
  });
});

describe('host platform probe contract (cycle-83)', () => {
  it('re-reads the DOM on every call instead of caching at apply() time', () => {
    const probe = SRC_FILES.find((f) => f.rel.endsWith('client/compat/PlatformProbe.ts'));
    expect(probe, 'PlatformProbe.ts 必须存在').toBeTruthy();
    const code = probe!.code;
    // 依据：<A>\dsh-client-ui-primitives\lib\types\darwin-desktop.d.ts 的 JSDoc
    // 「Read at render time — the mark may arrive as late as DOMContentLoaded.」
    // ⇒ `detectHostPlatform` 每次调用都要重新取 DOM 根，不得返回模块级缓存。
    // 真实实现把取根收敛在 `rootElement()` 里，故此处断言「函数体直接调用 rootElement()」
    // 且该 helper 自身读 `documentElement`——而不是要求函数体里出现 documentElement。
    expect(code).toMatch(/export function detectHostPlatform\(\)[\s\S]{0,600}?rootElement\(\)/);
    expect(code).toMatch(/function rootElement\(\)[\s\S]{0,300}?documentElement/);
    // 不得存在 `let cached…` / `??=` 形式的记忆化。
    expect(code).not.toMatch(/let\s+\w*[Cc]ached\w*\s*:/);
    expect(code).not.toMatch(/[Cc]achedHostPlatform\s*\?\?=/);
    // 晚到的标记必须有观察者通道。
    expect(code).toContain('export function observeHostPlatform(');
    expect(code).toContain('MutationObserver');
  });

  it('reads only the DOM marks the Electron preload actually writes', () => {
    const probe = SRC_FILES.find((f) => f.rel.endsWith('client/compat/PlatformProbe.ts'))!;
    // 依据：<A>\dsh-client-ui-layout\lib\client.js:240-241 与
    // <A>\dsh-client-ui-primitives\lib\index.js:8070-8072。
    expect(probe.code).toContain("dataset.platform === 'darwin'");
    expect(probe.code).toContain("hasAttribute('data-windows-titlebar')");
    // `process.versions.electron` 在全部 @deepseek-ai/**/*.js 中零命中 ⇒ 不得使用。
    expect(probe.code).not.toContain('process.versions.electron');
    expect(probe.code).not.toMatch(/require\(['"]electron['"]\)/);
  });
});

describe('cordis service-probe timing contract (cycle-83)', () => {
  // 依据：<A>\cordis\lib\index.js:763-772 `_getImpl` 内
  // `if (strict && impl.fiber.state !== 2) return;`，以及
  // <A>\cordis\lib\types\reflect.d.ts:16 JSDoc「when `true` (default), only return
  // implementations whose providing fiber is currently active.」
  // ⇒ `ctx.get(name)` 默认语义是「提供者 fiber 活跃」，不是「服务存在」。
  // 本插件 apply() 是同步一次性执行，用它做能力快照会把稍后才活跃的服务永久判死。
  //
  // 允许清单：下列调用点**故意**保留默认 strict=true，各有理由（与
  // ALLOWED_SERVICE_KEYS 同一手法：每条都要写明依据，新增项必须先登记）。
  const ALLOWED_STRICT_GET: Readonly<Record<string, string>> = {
    'src/host/prerequisites.ts':
      'resolveWorkspaceRoots 是**逐请求**重新解析（host/routes/shared.ts 的 ensureWorkspaceRootsAllowed），' +
      '不是 apply() 时的一次性快照，故会自愈；此处 strict=true 正是想要的语义 —— ' +
      '「不要用一个正在卸载的服务」。',
  };

  it('never probes a service with the default strict=true get outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (Object.hasOwn(ALLOWED_STRICT_GET, file.rel)) continue;
      for (const line of file.code.split('\n')) {
        // 只认 `ctx.get(...)` 且**不带第二参**（strict）。键可以是字面量，也可以是
        // 变量 —— 后者正是 cycle-83 的漏洞：`hasService(ctx, key)` 内部写
        // `ctx.get(key)`，第一版正则只匹配字面量，变异探针证明守卫拦不住它。
        // 刻意不匹配 `scope.get(...)`（位于 ctx.inject 回调内，注入已保证可用）、
        // `params.get(...)` / `Map.get(...)` / `headers.get(...)` 等无关 receiver。
        if (/ctx\.get\(\s*['"A-Za-z_$][^,)]*\)/.test(line)) offenders.push(`${file.rel}: ${line.trim()}`);
      }
    }
    // 失败信息即修复指引。
    expect(
      offenders,
      'ctx.get(key) 默认 strict=true，只返回提供者 fiber 活跃的服务；存在性探测必须写 ctx.get(key, false)',
    ).toEqual([]);
  });

  it('actually catches a variable-key strict get (the cycle-83 blind spot)', () => {
    // 反向自检：这条守卫必须能拦住 `ctx.get(key)`（变量键）而不仅仅是
    // `ctx.get('literal')`。变异探针曾把 ClientCompatLayer 的
    // `ctx.get(key, false)` 改回 `ctx.get(key)` 而守卫仍绿 —— 本用例把那个
    // 盲点本身变成断言，避免守卫退化成装饰。
    const strictGet = /ctx\.get\(\s*['"A-Za-z_$][^,)]*\)/;
    expect(strictGet.test('const value = ctx.get(key);'), '变量键必须命中').toBe(true);
    expect(strictGet.test("const value = ctx.get('commandUi');"), '字面量键必须命中').toBe(true);
    // 带第二参的调用不得命中（那是修好后的写法）。
    expect(strictGet.test('const value = ctx.get(key, false);'), 'strict=false 不得命中').toBe(false);
    expect(strictGet.test("const v = ctx.get('betterSidebar', false);"), 'strict=false 不得命中').toBe(false);
    // 无关 receiver 不得命中。
    expect(strictGet.test('scope.get(key)'), 'scope.get 不得命中').toBe(false);
    expect(strictGet.test('params.get(id)'), 'params.get 不得命中').toBe(false);
  });

  it('keeps every strict=true allowance documented', () => {
    // 允许清单里的每个文件都必须真实存在，且理由非空 —— 防止清单变成无声的豁免。
    for (const [rel, reason] of Object.entries(ALLOWED_STRICT_GET)) {
      expect(SRC_FILES.some((f) => f.rel === rel), `${rel} 不在扫描范围内`).toBe(true);
      expect(reason.length, `${rel} 的豁免理由不能为空`).toBeGreaterThan(20);
    }
  });

  it('gates an integration on reactive injection, not on a capability snapshot', () => {
    // 依据：`CommandUiIntegration` 曾因 `if (!state.flags.commandUi) return;` 在
    // `commandUi: false` 快照下永久早退，5 条斜杠命令一条都没注册（真机实测）。
    // 该集成面不占用互斥资源，故必须走 ctx.inject 而非快照早退。
    const cmd = SRC_FILES.find((f) => f.rel.endsWith('client/integrations/CommandUiIntegration.ts'));
    expect(cmd, 'CommandUiIntegration.ts 必须存在').toBeTruthy();
    expect(cmd!.code).not.toMatch(/if\s*\(\s*!state\.flags\.commandUi\s*\)\s*return/);
    expect(cmd!.code).toContain("ctx.inject(['commandUi']");
  });

  it('keeps mutually exclusive channels synchronous so priority order holds', () => {
    // 依据：conversation.view → sidebar-right → better-sidebar → slot → floating 靠
    // `state.navButtonRegistered` 组成同步优先级链。任一通道变异步，兜底就会在注入回调
    // 跑之前占位，造成优先级反转（更好的通道永远拿不到入口）。
    const exclusive = [
      'client/integrations/ConversationViewIntegration.ts',
      'client/integrations/SidebarRightTabsIntegration.ts',
      'client/integrations/BetterSidebarIntegration.ts',
      'client/integrations/SlotsFallback.ts',
      'client/integrations/FloatingPanelIntegration.ts',
    ];
    for (const rel of exclusive) {
      const file = SRC_FILES.find((f) => f.rel.endsWith(rel));
      expect(file, `${rel} 必须存在`).toBeTruthy();
      // 互斥通道必须读 navButtonRegistered 才能维持优先级。
      expect(file!.code).toContain('navButtonRegistered');
    }
    // BetterSidebarIntegration 尤其不得用 cordis 服务注入（它曾在 cycle-83 被改后回退）。
    const better = SRC_FILES.find((f) => f.rel.endsWith('client/integrations/BetterSidebarIntegration.ts'))!;
    expect(better.code).not.toMatch(/ctx\.inject\(\s*\[\s*['"]betterSidebar['"]/);
  });
});
