// 轨迹可见性契约（cycle-110 / P1-4）。
//
// ## 为什么需要这一条用例
//
// 用户 objective 要求在 DSH 会话轨迹里看到本插件的工具调用。轨迹能不能显示一次调用，
// 由两件**互相独立**的事决定：
//
//   1. 工具真的注册在 `ctx.tools` 上、名字与模型看到的 catalog 一致 —— 否则模型不会调用它，
//      轨迹里根本不会出现这一行（`ctx.tools.register()` 的返回值是 disposer，
//      `src/index.ts` 已逐条登记，但**缺席**不会报错）；
//   2. 调用发生之后，`presentCall`/`presentResult` 返回一个**合法的渲染意图** —— 否则 UI
//      回退到 "title = 工具名 + 原始参数"，调用虽然可见但卡片形状丢失。
//
// 本文件把 (2) 钉死，并把 (1) 的名字集合与 `src/index.ts` 的注册清单对齐。
//
// ## 历史陷阱（必须由用例守住，不能靠读代码）
//
// `defineTool` 把**两个** presenter 都包在参数校验门里
// （`@deepseek-ai/dsh-tools/lib/index.js:838-887`）：
//
//     if (userPresentCall) tool.presentCall = (args) => {
//       if (validate(args).length > 0) return void 0;
//       return userPresentCall(args);
//     };
//
// 于是「用非法参数调用 presenter」拿到 `undefined` 有两种可能：门拦下了，或者**我们的回调
// 自己**返回了 undefined。只看返回值分不清，而分不清的后果是：测试全绿、presenter 实际
// 从未执行。本文件用一对**互补**用例区分它们：
//
//   - `presentResult({}, null)` → `undefined` 且**不抛**（门在触碰 `result` 之前就返回了）；
//   - `presentResult(validArgs, null)` → **抛** TypeError（说明用户回调真的执行了，
//     它在读 `result.isError`）。
//
// 单看任何一条都可能是假绿；两条一起才证明「门在短路」与「回调在合法规格下真的跑」。
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/adapters/CodeGraphAdapter.ts', () => {
  const fetchData = vi.fn().mockResolvedValue({ nodes: [], edges: [], source: 'codegraph' as const, timestamp: 1 });
  return { CodeGraphAdapter: vi.fn().mockImplementation(() => ({ fetchData, source: 'codegraph' as const })) };
});

vi.mock('../../../src/adapters/LensAdapter.ts', () => {
  const fetchData = vi.fn().mockResolvedValue({ nodes: [], edges: [], source: 'lens' as const, timestamp: 1 });
  return { LensAdapter: vi.fn().mockImplementation(() => ({ fetchData, source: 'lens' as const })) };
});

const { createGraphTools } = await import('../../../src/tools.ts');
import type { Context } from '@deepseek-ai/cordis';

/** `ToolCallView` 的合法 `card` 标签（`docs/reference/subsystems/tools.md` §工具展示 UI 词汇）。 */
const CALL_CARDS = new Set(['generic', 'terminal', 'diff']);
/** `ToolResultView` 的合法 `card` 标签（同一节）。 */
const RESULT_CARDS = new Set(['generic', 'terminal', 'diff', 'search', 'read', 'web']);
/** `ToolCallKind`：通用卡片选图标用。 */
const CALL_KINDS = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'other']);

/**
 * **入口注册**的十个工具名（冻结）。P0-5 正在把 `graph_query` 追加入口注册，
 * 因此本清单刻意只列「此刻已注册」的名字，并以**子集**方式断言工厂产出：
 * 少一个（工具消失）必红；多一个（P0-5 要加的 graph_query）不会误红。
 *
 * 「工厂返回集合 == 入口注册集合」的集合相等守卫归 `tests/unit/tools.test.ts`（P0-5），
 * 本文件不重复实现，避免两名成员改同一断言。
 */
const REGISTERED_TOOL_NAMES = Object.freeze([
  'graph_status',
  'graph_data',
  'graph_symbol',
  'graph_impact',
  'graph_path_find',
  'graph_path_enumerate',
  'graph_cycles',
  'graph_health',
  'graph_rules_check',
  'graph_focus',
  'graph_query',
  'graph_integrity',
  // cycle-134：路径模式 ρ（边类型序列约束）。列在这里的理由与其它工具相同——
  // 入口注册了却拿不出合法 presentCall/presentResult，轨迹里就是一张空卡片。
  'graph_path_pattern',
  // cycle-135：多维视图切片（时序 / 所有权 / 领域 + 结构）。
  'graph_slice',
]);

/** 每个工具的**合法**参数样本：必须满足 `required: true` 的每一项且类型正确。 */
const VALID_ARGS: Record<string, Record<string, unknown>> = Object.freeze({
  graph_status: { repoId: 'repo-1' },
  graph_data: { repoId: 'repo-1', source: 'both' },
  graph_symbol: { symbolId: 'sym-1' },
  graph_impact: { symbolId: 'sym-1' },
  graph_path_find: { repoId: 'repo-1', sourceSymbol: 'a', targetSymbol: 'b' },
  graph_path_enumerate: { repoId: 'repo-1', sourceSymbol: 'a', targetSymbol: 'b' },
  graph_cycles: { repoId: 'repo-1' },
  graph_health: { repoId: 'repo-1' },
  graph_rules_check: { repoId: 'repo-1' },
  graph_focus: { repoId: 'repo-1', symbolId: 'sym-1' },
  graph_query: { repoId: 'repo-1', query: 'alpha' },
  graph_integrity: { repoId: 'repo-1' },
  graph_path_pattern: { repoId: 'repo-1', pattern: 'call+' },
  graph_slice: { repoId: 'repo-1', view: 'structural' },
});

type MockCtx = Context & {
  tools: { register: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  effect: ReturnType<typeof vi.fn>;
};

function makeMockCtx(): MockCtx {
  return {
    tools: {
      register: vi.fn(),
      execute: vi.fn().mockResolvedValue({ isError: false, value: null }),
      get: vi.fn().mockReturnValue(undefined),
    },
    on: vi.fn(),
    emit: vi.fn(),
    effect: vi.fn(),
  } as unknown as MockCtx;
}

/**
 * 工厂返回的**工具定义**，按名字索引。
 *
 * 注意 `createGraphTools` 的返回值里还有一个 `dispose` 函数：函数自带 `name` 属性
 * （等于 `'dispose'`），所以不能用「有 name 就是工具」筛，必须显式排除。
 */
async function buildTools(): Promise<Record<string, Record<string, unknown>>> {
  const ctx = makeMockCtx();
  const tools = await createGraphTools(ctx);
  const byName: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(tools)) {
    if (key === 'dispose' || typeof value === 'function') continue;
    const definition = value as unknown as Record<string, unknown> & { name?: string };
    if (definition && typeof definition.name === 'string') byName[definition.name] = definition;
  }
  return byName;
}

/** 本文件对某个工具的判据：`VALID_ARGS` 里必须有它的样本，否则用例无法证明它可用。 */
function validArgsFor(name: string): Record<string, unknown> {
  const args = VALID_ARGS[name];
  if (!args) {
    throw new Error(
      `tool "${name}" has no VALID_ARGS sample: every model-visible tool must be covered by the `
      + 'presenter contract, otherwise its trajectory card can silently degrade to generic.',
    );
  }
  return args;
}

interface ToolCallViewShape {
  card: string;
  title?: string;
  kind?: string;
  rawInput?: unknown;
}

describe('轨迹可见性：工具名与模型可见 catalog 一致', () => {
  it('入口注册的十个工具一个都不能从工厂里消失', async () => {
    const tools = await buildTools();
    for (const name of REGISTERED_TOOL_NAMES) {
      expect(Object.hasOwn(tools, name), `factory no longer produces "${name}"`).toBe(true);
    }
    // 工厂返回的每个工具都必须被本文件的 presenter 契约覆盖。
    for (const name of Object.keys(tools)) validArgsFor(name);
  });

  it('名字是 snake_case、互不重复，且不占用保留名 run_code', async () => {
    const tools = await buildTools();
    const names = Object.values(tools).map((t) => t['name'] as string);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      // 模型面向的名字只允许小写字母开头的 snake_case（catalog 与 `/` 补全都按它匹配）。
      expect(name, `${name} must be model-facing snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      // `run_code` 是 PTC 传输的保留名：注册同名工具会失败（tools.md §ctx.tools.register）。
      expect(name).not.toBe('run_code');
    }
  });

  it('每个工具都真的注册在 ctx.tools 上（缺席不会报错，所以必须正向断言）', async () => {
    const ctx = makeMockCtx();
    const tools = await createGraphTools(ctx);
    // 逐个模拟 `src/index.ts` 的注册动作：任何定义若缺 `name`/`execute` 会在这里暴露。
    for (const [key, value] of Object.entries(tools)) {
      const definition = value as unknown as { name?: string; execute?: unknown; description?: string };
      if (key === 'dispose') continue;
      expect(typeof definition.name, `${key}.name`).toBe('string');
      expect(typeof definition.description, `${key}.description`).toBe('string');
      expect(typeof definition.execute, `${key}.execute`).toBe('function');
      expect(ctx.tools.register).toBeTypeOf('function');
    }
  });
});

describe('轨迹可见性：presentCall 在合法规格下产出可渲染卡片', () => {
  let tools: Record<string, Record<string, unknown>>;

  beforeEach(async () => { tools = await buildTools(); });

  it('十个工具的 presentCall 都用合法参数返回合法的 ToolCallView', () => {
    for (const name of Object.keys(tools)) {
      const definition = tools[name]!;
      const presentCall = definition['presentCall'] as (args: unknown) => ToolCallViewShape | undefined;
      expect(typeof presentCall, `${name}.presentCall`).toBe('function');

      const view = presentCall(validArgsFor(name));
      expect(view, `${name}: presentCall must return a view for schema-valid args`).toBeDefined();
      expect(CALL_CARDS.has(view!.card), `${name}: card "${view!.card}" is not a ToolCallView tag`).toBe(true);
      expect(typeof view!.title, `${name}: title`).toBe('string');
      expect(view!.title!.length).toBeGreaterThan(0);
      if (view!.kind !== undefined) {
        expect(CALL_KINDS.has(view!.kind), `${name}: kind "${view!.kind}" is not a ToolCallKind`).toBe(true);
      }
      // 展示意图会被写进会话日志（"a UI may call it during live streaming AND a session-log
      // replay"），因此必须是可 JSON 序列化的纯数据，不能带函数/循环引用。
      expect(() => JSON.stringify(view), `${name}: view must be JSON-serializable`).not.toThrow();
    }
  });

  it('参数校验失败时 presentCall 短路返回 undefined（十个工具各有必填项）', () => {
    for (const name of Object.keys(tools)) {
      const presentCall = tools[name]!['presentCall'] as (args: unknown) => unknown;
      // 空对象：每个工具都至少有一个 `required: true` 参数，因此必然违规。
      expect(presentCall({}), `${name}: presentCall({}) must be short-circuited to undefined`).toBeUndefined();
      // 类型错误同样要短路（`repoId: 42` 不是 string）。
      expect(presentCall({ repoId: 42, symbolId: 42, sourceSymbol: 1, targetSymbol: 2 })).toBeUndefined();
    }
  });

  it('presentCall 是纯函数：同一参数两次调用结果深相等（回放一致性）', () => {
    for (const name of Object.keys(tools)) {
      const presentCall = tools[name]!['presentCall'] as (args: unknown) => unknown;
      const args = validArgsFor(name);
      expect(presentCall(args), `${name}: presenter must be deterministic`).toEqual(presentCall(args));
      // 且不修改入参（回放时参数对象可能被多个 presenter 共享）。
      expect(args).toEqual(validArgsFor(name));
    }
  });
});

describe('轨迹可见性：presentResult 在合法规格下产出可渲染卡片', () => {
  let tools: Record<string, Record<string, unknown>>;

  beforeEach(async () => { tools = await buildTools(); });

  it('十个工具的 presentResult 都用合法参数返回合法的 ToolResultView', () => {
    for (const name of Object.keys(tools)) {
      const definition = tools[name]!;
      const presentResult = definition['presentResult'] as
        (args: unknown, result: unknown) => { card: string; title?: string } | undefined;
      expect(typeof presentResult, `${name}.presentResult`).toBe('function');

      const ok = presentResult(validArgsFor(name), { isError: false });
      expect(ok, `${name}: presentResult must return a view`).toBeDefined();
      expect(RESULT_CARDS.has(ok!.card), `${name}: card "${ok!.card}" is not a ToolResultView tag`).toBe(true);
      expect(ok!.title!.length).toBeGreaterThan(0);

      // 失败态也要有可渲染标题（否则报错在轨迹里显示为空白卡片）。
      const failed = presentResult(validArgsFor(name), { isError: true });
      expect(failed, `${name}: presentResult must return a view on failure too`).toBeDefined();
      expect(failed!.title!.length).toBeGreaterThan(0);
      // 成功/失败标题必须不同 —— 相同就等于把失败渲染成成功。
      expect(failed!.title, `${name}: failure title must differ from success title`).not.toBe(ok!.title);
    }
  });

  it('参数校验失败时 presentResult 短路返回 undefined', () => {
    for (const name of Object.keys(tools)) {
      const presentResult = tools[name]!['presentResult'] as (args: unknown, result: unknown) => unknown;
      expect(presentResult({}, { isError: false }), `${name}: presentResult({}) must short-circuit`).toBeUndefined();
    }
  });

  // ★ 本文件的核心证据对：区分「门短路」与「回调返回 undefined」。
  it('短路证明：非法参数下连 result 都不会被触碰；合法参数下回调真的执行', () => {
    const definition = tools['graph_status']!;
    const presentResult = definition['presentResult'] as (args: unknown, result: unknown) => unknown;

    // 非法参数 + `null` result：门在调用用户回调**之前**就返回了 void 0，
    // 所以读 `result.isError` 的那行代码不会执行 —— 不抛异常。
    expect(() => presentResult({}, null), 'schema-invalid args must not reach the user presenter')
      .not.toThrow();
    expect(presentResult({}, null)).toBeUndefined();

    // 合法参数 + 同样的 `null` result：用户回调确实执行了，于是它在 `result.isError`
    // 上抛 TypeError。这条断言是"回调真的跑了"的**唯一**直接证据。
    expect(() => presentResult(VALID_ARGS['graph_status'], null),
      'schema-valid args must reach the user presenter (it dereferences result)')
      .toThrow(TypeError);
  });
});

describe('工具定义不得把宿主侧字段泄漏进模型可见 schema', () => {
  let tools: Record<string, Record<string, unknown>>;

  beforeEach(async () => { tools = await buildTools(); });

  it('parameters 是 object 根 schema，required 与声明一致，属性都带 type', () => {
    for (const name of Object.keys(tools)) {
      const params = tools[name]!['parameters'] as Record<string, unknown>;
      expect(params['type'], `${name}: parameters.type`).toBe('object');
      const properties = params['properties'] as Record<string, { type?: string }>;
      expect(properties, `${name}: parameters.properties`).toBeTypeOf('object');
      for (const [prop, schema] of Object.entries(properties)) {
        expect(typeof schema.type, `${name}.${prop} must declare a type`).toBe('string');
      }
      const required = (params['required'] ?? []) as string[];
      // 每个 required 项必须真的存在于 properties 里（否则模型永远满足不了 schema）。
      for (const key of required) {
        expect(Object.hasOwn(properties, key), `${name}: required "${key}" missing from properties`).toBe(true);
      }
      // 至少一个必填项：本插件每个工具都需要一个定位参数。
      expect(required.length, `${name} must declare at least one required parameter`).toBeGreaterThan(0);
    }
  });

  it('注册表的显式允许列表之外，宿主侧字段绝不能出现在模型请求里', () => {
    // docs/reference/subsystems/tools.md：
    // "`output`/`execute`/`projectContent`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/
    //  `presentCall`/`presentResult` 绝不能泄漏到模型请求中"。
    const hostOnly = ['presentCall', 'presentResult', 'execute', 'projectContent', 'finalizeContent',
      'isConcurrencySafe', 'timeoutMs', 'presentationMeta'];
    for (const name of Object.keys(tools)) {
      const params = JSON.stringify(tools[name]!['parameters']);
      for (const key of hostOnly) {
        expect(params, `${name}: host-only "${key}" leaked into parameters`).not.toContain(key);
      }
    }
  });
});
