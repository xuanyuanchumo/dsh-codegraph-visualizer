/**
 * 原生通道 `call` 边提取 + 证据分级（T2）。
 *
 * ## 修前现场（决定本文件存在的那条证据）
 *
 * `grep -rc "call_expression" src/adapters/*.ts` 全 0 命中：`TreeSitterAdapter.walk`
 * 只抽符号节点与继承边，`FileSystemAdapter.fetchDataWithSymbols` 只推断
 * `contains` / `import` 边。于是原生通道产出的 `call` 边**恒为 0 条**——
 * 而 `DEFAULT_PATH_EDGE_TYPES`（`src/shared/analysis/XuanjiAdapter.ts`）含 `'call'`，
 * 影响面 / 调用链 / 环检测六条读法在上游 dsh-codegraph 缺席时全部读到空图。
 *
 * ## 本文件覆盖的四件事
 *
 * 1. **各 grammar 的 callee 简单名提取**（用真实 grammar 解析，不手搓 AST 节点——
 *    手搓的 fixture 只能证明「我写的模拟对象长得对」，证明不了 grammar 真的这么解析）；
 * 2. 同文件唯一命中 ⇒ `evidence: 'exact'`（`edgeOrigin: 'ast'`）；
 * 3. 跨文件（经已解析的 import）唯一命中 ⇒ `evidence: 'inferred'`（`edgeOrigin: 'heuristic'`）；
 * 4. **同名多义 ⇒ 无边 + ambiguous 计数**（防空转的核心用例）、模块顶层调用 ⇒ 无边、
 *    递归自引用 ⇒ 无边。
 *
 * ## 两条反自欺断言
 *
 * - 「≥3 种 grammar 真的被覆盖」：单一 grammar 全绿会看起来全绿，所以用例末尾用
 *   `coveredGrammars` 反向自检；
 * - 「exact / inferred 两种取值都真的出现过」：只断言其中一种存在时，
 *   把 `evidence` 恒定写成同一个值也能全绿。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { TreeSitterAdapter, isTreeSitterRuntimePresent, type TreeSitterNode } from '../../src/adapters/TreeSitterAdapter.ts';
import { FileSystemAdapter, type FileSystemApi } from '../../src/adapters/FileSystemAdapter.ts';
import {
  applyTodoMarkers,
  CALL_EXPRESSION_TYPES,
  extractCalleeName,
  resolveCallEdges,
} from '../../src/adapters/treeSitterExtractors.ts';
import { logger } from '../../src/shared/Logger.ts';
import type { GraphEdge, GraphNode, CallSite } from '../../src/types/index.ts';
import { NodeId } from '../../src/types/index.ts';

const tsAvailable = isTreeSitterRuntimePresent();

// ── 真实 grammar 解析（不是手搓 AST）──────────────────────────────────────
//
// 用 `web-tree-sitter` + `tree-sitter-wasm` 直接解析一段源码，返回根节点。
// 被测函数只依赖 TreeSitterNode 的四个成员（type/text/children/childForFieldName/
// startPosition），`web-tree-sitter` 的 Node 结构上完全兼容——这是**同一份**运行时
// 对象，所以测试与生产走的是同一条解析路径。

type RealParser = { parse(src: string): { rootNode: unknown }; delete(): void };
type RealLanguage = { load(path: string): Promise<unknown> };

let LanguageCtor: RealLanguage | null = null;
let ParserCtor: (new () => RealParser) | null = null;
const parserByGrammar = new Map<string, RealParser>();

async function realParser(grammar: string): Promise<RealParser> {
  const cached = parserByGrammar.get(grammar);
  if (cached) return cached;
  if (!LanguageCtor || !ParserCtor) throw new Error('tree-sitter runtime not initialized');
  const requireTs = createRequire(import.meta.url);
  const { getWasmPath } = requireTs('tree-sitter-wasm') as { getWasmPath(g: string): string };
  const language = await LanguageCtor.load(getWasmPath(grammar));
  const parser = new ParserCtor();
  (parser as unknown as { setLanguage(l: unknown): void }).setLanguage(language);
  parserByGrammar.set(grammar, parser);
  return parser;
}

/** 解析源码，返回根节点（已转成项目内的 TreeSitterNode 视图）。 */
async function parseRoot(grammar: string, source: string): Promise<TreeSitterNode> {
  const parser = await realParser(grammar);
  const tree = parser.parse(source);
  return tree.rootNode as unknown as TreeSitterNode;
}

/**
 * 广度遍历找所有调用表达式节点，按**源码顺序**返回（断言读起来和源码一致）。
 *
 * 排序键是 (start row, start column, -end column)：链式调用 `a.b().c()` 的内外层
 * call_expression **起点相同**（都在 `a`），只有终点能区分——终点更远的那个是
 * 外层调用，排在前面（与源码「先看到整条表达式」的直觉一致）。
 */
function collectCallNodes(root: TreeSitterNode): TreeSitterNode[] {
  const out: TreeSitterNode[] = [];
  const stack: TreeSitterNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (CALL_EXPRESSION_TYPES.has(node.type)) out.push(node);
    for (const child of node.children ?? []) stack.push(child);
  }
  return out.sort((a, b) => (
    a.startPosition.row - b.startPosition.row
    || a.startPosition.column - b.startPosition.column
    || b.endPosition.column - a.endPosition.column
  ));
}

/** 一段源码里所有调用点提取出的简单名（null = 该形态刻意不取名）。 */
async function calleeNames(grammar: string, source: string): Promise<Array<string | null>> {
  const root = await parseRoot(grammar, source);
  return collectCallNodes(root).map((n) => extractCalleeName(n));
}

/** 本文件实际覆盖到的 grammar（末尾反向自检用）。 */
const coveredGrammars = new Set<string>();

beforeAll(async () => {
  if (!tsAvailable) return;
  const requireTs = createRequire(import.meta.url);
  const webTreeSitter = requireTs('web-tree-sitter') as {
    Parser: { init(): Promise<void> } & (new () => RealParser);
    Language: RealLanguage;
  };
  await webTreeSitter.Parser.init();
  ParserCtor = webTreeSitter.Parser as unknown as new () => RealParser;
  LanguageCtor = webTreeSitter.Language;
});

afterAll(() => {
  for (const parser of parserByGrammar.values()) parser.delete();
  parserByGrammar.clear();
});

// ── 1. 各 grammar 的 callee 名提取 ────────────────────────────────────────

describe('extractCalleeName：六种 grammar 的调用形态', () => {
  it('捕获调用节点类型集合（3 类，不是 4 类同族）', () => {
    // 任务书假设「四类 call_expression 家族」，实测：python 是 `call`、
    // java 是 `method_invocation`。这里钉住集合内容，避免有人「统一」成一种拼写。
    expect([...CALL_EXPRESSION_TYPES].sort()).toEqual(['call', 'call_expression', 'method_invocation']);
  });

  it.skipIf(!tsAvailable)('TypeScript：foo() 取 foo，a.b() 取 b（末段）', async () => {
    coveredGrammars.add('typescript');
    expect(await calleeNames('typescript', 'function f() { foo(); }')).toEqual(['foo']);
    expect(await calleeNames('typescript', 'function f() { a.b(); }')).toEqual(['b']);
    expect(await calleeNames('typescript', 'function f() { this.x(); }')).toEqual(['x']);
    // 链式调用：a.b().c() 的末段是 c，a.b() 自身也是一次调用（两个节点）。
    expect(await calleeNames('typescript', 'function f() { a.b().c(); }')).toEqual(['c', 'b']);
    // 泛型 / 可选链 / 私有字段：文本切分会错，字段读取才对。
    // `this.#p()` 的末段节点类型是 private_property_identifier，text 保留 `#` 前缀
    // （实测），而符号侧 extractSymbolName 读到的 label 同样是 `#p`——两侧同域才能
    // 名称解析到符号，所以这里刻意**不**剥 `#`。
    expect(await calleeNames('typescript', 'function f() { a.b<T>(); a?.b(); this.#p(); }'))
      .toEqual(['b', 'b', '#p']);
    // 数组下标不是符号引用 ⇒ 刻意不取名（宁缺勿造）。
    expect(await calleeNames('typescript', 'function f() { arr[0](); }')).toEqual([null]);
  });

  it.skipIf(!tsAvailable)('tsx：与 typescript 同形（JSX 由 tsx grammar 解析）', async () => {
    coveredGrammars.add('tsx');
    expect(await calleeNames('tsx', 'const C = () => <div/>; function f() { a.b(); }')).toEqual(['b']);
  });

  it.skipIf(!tsAvailable)('JavaScript：foo() / a.b()', async () => {
    coveredGrammars.add('javascript');
    expect(await calleeNames('javascript', 'function f() { foo(); a.b(); }')).toEqual(['foo', 'b']);
  });

  it.skipIf(!tsAvailable)('Python：foo() 取 foo，self.foo() / a.b.c() 取末段', async () => {
    coveredGrammars.add('python');
    expect(await calleeNames('python', 'def f():\n  foo()\n')).toEqual(['foo']);
    expect(await calleeNames('python', 'class C:\n  def m(self):\n    self.foo()\n')).toEqual(['foo']);
    expect(await calleeNames('python', 'def f():\n  a.b.c()\n')).toEqual(['c']);
  });

  it.skipIf(!tsAvailable)('Java：obj.m() 取 m，helper() 取 helper（name 字段）', async () => {
    coveredGrammars.add('java');
    expect(await calleeNames('java', 'class C { void f() { obj.m(); } }')).toEqual(['m']);
    expect(await calleeNames('java', 'class C { void f() { helper(); } }')).toEqual(['helper']);
    // 泛型实参不干扰末段名。
    expect(await calleeNames('java', 'class C { void f() { obj.<T>g(); } }')).toEqual(['g']);
  });

  it.skipIf(!tsAvailable)('Rust：helper()、a::b::c()、obj.method() 各取末段', async () => {
    coveredGrammars.add('rust');
    expect(await calleeNames('rust', 'fn f() { helper(); }')).toEqual(['helper']);
    expect(await calleeNames('rust', 'fn f() { a::b::c(); }')).toEqual(['c']);
    expect(await calleeNames('rust', 'fn f() { obj.method(); }')).toEqual(['method']);
    // 泛型调用外包 generic_function：内层表达式才是被调方。
    expect(await calleeNames('rust', 'fn f() { o.m::<i32>(); }')).toEqual(['m']);
  });

  it.skipIf(!tsAvailable)('Go：helper()、obj.M()（selector_expression）、实例化调用', async () => {
    coveredGrammars.add('go');
    expect(await calleeNames('go', 'package main\nfunc f() { helper() }')).toEqual(['helper']);
    expect(await calleeNames('go', 'package main\nfunc f() { obj.M() }')).toEqual(['M']);
    expect(await calleeNames('go', 'package main\nfunc f() { pkg.F() }')).toEqual(['F']);
    // foo[int]() 的 index_expression：operand 是函数表达式，index 是类型实参。
    expect(await calleeNames('go', 'package main\nfunc f() { foo[int]() }')).toEqual(['foo']);
  });
});

// ── 2. 纯函数层的两跳解析（exact / inferred / ambiguous）──────────────────

function site(callerId: string, calleeName: string, line = 1): CallSite {
  return { callerId: NodeId(callerId), calleeName, line };
}

describe('resolveCallEdges：证据分级与歧义丢弃', () => {
  it('同文件唯一命中 ⇒ exact，edgeOrigin=ast', () => {
    const out = resolveCallEdges({
      callSites: [site('a.ts:main:2', 'foo')],
      localSymbols: [{ label: 'main', id: 'a.ts:main:2' }, { label: 'foo', id: 'a.ts:foo:1' }],
      importedFileSymbols: new Map(),
    });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.target).toBe('a.ts:foo:1');
    expect(out.edges[0]!.properties.evidence).toBe('exact');
    expect(out.edges[0]!.properties.edgeOrigin).toBe('ast');
    expect(out.edges[0]!.id).toBe('tscall:a.ts:main:2:a.ts:foo:1');
    expect(out.byEvidence).toEqual({ exact: 1, inferred: 0 });
  });

  it('跨文件（经 import）唯一命中 ⇒ inferred，edgeOrigin=heuristic', () => {
    const out = resolveCallEdges({
      callSites: [site('b.ts:run:2', 'helper')],
      localSymbols: [{ label: 'run', id: 'b.ts:run:2' }],
      importedFileSymbols: new Map([['a.ts', [{ label: 'helper', id: 'a.ts:helper:1' }]]]),
    });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.properties.evidence).toBe('inferred');
    // 名字 + import 图推断出的目标**不是**语法树直接给出的，所以不能挂 ast 档。
    expect(out.edges[0]!.properties.edgeOrigin).toBe('heuristic');
    expect(out.byEvidence).toEqual({ exact: 0, inferred: 1 });
  });

  it('同文件多义 ⇒ 无边 + ambiguous=1（不猜）', () => {
    const out = resolveCallEdges({
      callSites: [site('a.ts:main:9', 'dup')],
      localSymbols: [
        { label: 'main', id: 'a.ts:main:9' },
        { label: 'dup', id: 'a.ts:dup:1' },
        { label: 'dup', id: 'a.ts:dup:2' },
      ],
      importedFileSymbols: new Map(),
    });
    expect(out.edges).toEqual([]);
    expect(out.ambiguous).toBe(1);
    expect(out.unresolved).toBe(0);
  });

  it('同文件唯一但目标在多个 import 文件里也存在 ⇒ 仍按同文件 exact（hop1 优先）', () => {
    const out = resolveCallEdges({
      callSites: [site('b.ts:run:2', 'helper')],
      localSymbols: [{ label: 'run', id: 'b.ts:run:2' }, { label: 'helper', id: 'b.ts:helper:1' }],
      importedFileSymbols: new Map([['a.ts', [{ label: 'helper', id: 'a.ts:helper:1' }]]]),
    });
    expect(out.edges[0]!.target).toBe('b.ts:helper:1');
    expect(out.edges[0]!.properties.evidence).toBe('exact');
  });

  it('跨文件命中分散在两个 import 文件 ⇒ 视为歧义（不猜）', () => {
    const out = resolveCallEdges({
      callSites: [site('c.ts:run:2', 'shared')],
      localSymbols: [{ label: 'run', id: 'c.ts:run:2' }],
      importedFileSymbols: new Map([
        ['a.ts', [{ label: 'shared', id: 'a.ts:shared:1' }]],
        ['b.ts', [{ label: 'shared', id: 'b.ts:shared:1' }]],
      ]),
    });
    expect(out.edges).toEqual([]);
    expect(out.ambiguous).toBe(1);
  });

  it('两跳都落空 ⇒ 无边 + unresolved=1', () => {
    const out = resolveCallEdges({
      callSites: [site('a.ts:main:2', 'nowhere')],
      localSymbols: [{ label: 'main', id: 'a.ts:main:2' }],
      importedFileSymbols: new Map(),
    });
    expect(out.edges).toEqual([]);
    expect(out.ambiguous).toBe(0);
    expect(out.unresolved).toBe(1);
  });

  it('递归自引用 ⇒ 无边（也不计入 ambiguous/unresolved）', () => {
    const out = resolveCallEdges({
      callSites: [site('a.ts:rec:1', 'rec')],
      localSymbols: [{ label: 'rec', id: 'a.ts:rec:1' }],
      importedFileSymbols: new Map(),
    });
    expect(out.edges).toEqual([]);
    expect(out.ambiguous).toBe(0);
    expect(out.unresolved).toBe(0);
  });

  it('同一对 (caller, callee) 多次调用只出一条边', () => {
    const out = resolveCallEdges({
      callSites: [site('a.ts:main:2', 'foo', 2), site('a.ts:main:2', 'foo', 3)],
      localSymbols: [{ label: 'main', id: 'a.ts:main:2' }, { label: 'foo', id: 'a.ts:foo:1' }],
      importedFileSymbols: new Map(),
    });
    expect(out.edges).toHaveLength(1);
  });
});

// ── 3. 端到端：FileSystemAdapter 真的产出 call 边（含两跳与跳过）────────────

/**
 * 内存 fs（与 `tests/unit/nativeEnrichmentContract.test.ts` 同构）。
 * `readFile` 在键缺席时抛错——FileSystemAdapter 依赖这个语义区分「文件不存在」。
 */
function createMemFs(files: Record<string, string>): FileSystemApi {
  return {
    readdir(p: string): string[] {
      const prefix = p.endsWith('/') ? p : `${p}/`;
      const dirs = new Set<string>();
      const out: string[] = [];
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (rest.includes('/')) dirs.add(rest.split('/')[0]!);
        else out.push(rest);
      }
      return [...out, ...dirs];
    },
    readFile(p: string): string {
      const content = files[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    stat(p: string): { isDirectory: boolean } {
      const isDirectory = Object.keys(files).some((f) => f.startsWith(`${p}/`))
        && !Object.keys(files).includes(p);
      return { isDirectory };
    },
  };
}

interface ScanOutcome {
  nodes: GraphNode[];
  edges: GraphEdge[];
  callEdges: GraphEdge[];
}

async function scan(files: Record<string, string>): Promise<ScanOutcome> {
  const adapter = new FileSystemAdapter();
  adapter.setFileSystem(createMemFs(files));
  const ts = new TreeSitterAdapter();
  await ts.init();
  adapter.setTreeSitterAdapter(ts);
  try {
    const result = await adapter.fetchDataWithSymbols('D:/proj');
    return {
      nodes: result.nodes,
      edges: result.edges,
      callEdges: result.edges.filter((e) => e.type === 'call'),
    };
  } finally {
    ts.destroy();
  }
}

/** 取某个函数符号的 id（label 唯一时用它断言边端点）。 */
function functionId(nodes: GraphNode[], fileSuffix: string, label: string): string {
  const found = nodes.find((n) => n.type === 'function'
    && n.label === label
    && String(n.filePath).endsWith(fileSuffix));
  expect(found, `function ${label} in ${fileSuffix} not found`).toBeDefined();
  return String(found!.id);
}

describe('FileSystemAdapter：call 边端到端', () => {
  it.skipIf(!tsAvailable)('同文件唯一命中 ⇒ exact 边', async () => {
    coveredGrammars.add('typescript');
    const { nodes, callEdges } = await scan({
      'D:/proj/src/a.ts': [
        'function helper() { return 1; }',
        'function main() { return helper(); }',
      ].join('\n'),
    });
    expect(callEdges.length).toBeGreaterThan(0);
    const helperId = functionId(nodes, '/a.ts', 'helper');
    const mainId = functionId(nodes, '/a.ts', 'main');
    const edge = callEdges.find((e) => String(e.source) === mainId && String(e.target) === helperId);
    expect(edge).toBeDefined();
    expect(edge!.properties.evidence).toBe('exact');
    expect(edge!.properties.edgeOrigin).toBe('ast');
    expect(String(edge!.id)).toBe(`tscall:${mainId}:${helperId}`);
    expect(edge!.properties.calleeName).toBe('helper');
    expect(typeof edge!.properties.line).toBe('number');
  });

  it.skipIf(!tsAvailable)('跨文件（经 import）唯一命中 ⇒ inferred 边', async () => {
    coveredGrammars.add('typescript');
    const { nodes, callEdges } = await scan({
      'D:/proj/src/a.ts': 'export function helper() { return 1; }',
      'D:/proj/src/b.ts': [
        "import { helper } from './a';",
        'export function run() { return helper(); }',
      ].join('\n'),
    });
    const helperId = functionId(nodes, '/a.ts', 'helper');
    const runId = functionId(nodes, '/b.ts', 'run');
    const edge = callEdges.find((e) => String(e.source) === runId && String(e.target) === helperId);
    expect(edge).toBeDefined();
    expect(edge!.properties.evidence).toBe('inferred');
    expect(edge!.properties.edgeOrigin).toBe('heuristic');
  });

  it.skipIf(!tsAvailable)('同名多义 ⇒ 无边，且 ambiguous 计数在日志里可观测', async () => {
    coveredGrammars.add('typescript');
    // 清空环形缓冲，否则下面读到的可能是**别的用例**写下的那条日志（假绿）。
    logger.clear();
    // 两个同名函数（不同行）在同文件里 ⇒ 名字无法裁决，必须跳过。
    const { nodes, callEdges } = await scan({
      'D:/proj/src/dup.ts': [
        'function dup() { return 1; }',
        'function dup() { return 2; }',
        'function main() { return dup(); }',
      ].join('\n'),
    });
    const mainId = functionId(nodes, '/dup.ts', 'main');
    // 没有任何一条 call 边从 main 出发 —— 这是「不猜」的行为证据。
    expect(callEdges.filter((e) => String(e.source) === mainId)).toEqual([]);
    // 计数必须真的出现在日志里：0 条边到底是「没有调用」还是「全被跳过」，
    // 只有这个数字能区分。它若恒为 0（例如跳过路径没接线），这条会红——
    // 这正是「防空转」的反向自检。
    const logLine = logger.entries().find((e) => e.scope === 'fs-adapter' && e.message.includes('ambiguous'));
    expect(logLine, 'fs-adapter ambiguous log line missing').toBeDefined();
    const ambiguous = Number(/ambiguous (\d+)/.exec(logLine!.message)?.[1] ?? '-1');
    expect(ambiguous).toBe(1);
  });

  it.skipIf(!tsAvailable)('模块顶层调用 ⇒ 无边（不编造 file 级 call）', async () => {
    coveredGrammars.add('typescript');
    const { callEdges } = await scan({
      'D:/proj/src/top.ts': [
        'function helper() { return 1; }',
        'const x = helper();',
      ].join('\n'),
    });
    expect(callEdges).toEqual([]);
  });

  it.skipIf(!tsAvailable)('递归自引用 ⇒ 无边', async () => {
    coveredGrammars.add('typescript');
    const { callEdges } = await scan({
      'D:/proj/src/rec.ts': 'function rec() { return rec(); }',
    });
    expect(callEdges).toEqual([]);
  });

  it.skipIf(!tsAvailable)('Python / Java / Rust / Go 也产出 call 边（不是只有 TS 通道）', async () => {
    coveredGrammars.add('python');
    coveredGrammars.add('java');
    coveredGrammars.add('rust');
    coveredGrammars.add('go');
    const { nodes, callEdges } = await scan({
      'D:/proj/src/py.py': 'def helper():\n    return 1\n\ndef main():\n    return helper()\n',
      'D:/proj/src/J.java': 'class J { void helper() {} void main() { helper(); } }',
      'D:/proj/src/r.rs': 'fn helper() -> i32 { 1 }\nfn main() { helper(); }',
      'D:/proj/src/g.go': 'package main\n\nfunc helper() {}\n\nfunc main() { helper() }\n',
    });
    // 逐个文件断言，而不是只看总数：总数 4 也可以由「一个文件产出 4 条、其余 0 条」满足，
    // 那样单一 grammar 坏掉时这条依然会绿。
    for (const file of ['/py.py', '/J.java', '/r.rs', '/g.go']) {
      const helperId = functionId(nodes, file, 'helper');
      const mainId = functionId(nodes, file, 'main');
      const edge = callEdges.find((e) => String(e.source) === mainId && String(e.target) === helperId);
      expect(edge, `no call edge main -> helper in ${file}`).toBeDefined();
      expect(edge!.properties.evidence).toBe('exact');
    }
    expect(callEdges).toHaveLength(4);
  });
});

// ── 5. 伴随重构的语义守卫（applyTodoMarkers 从 walk 搬出时不得改行为）────────

describe('applyTodoMarkers：搬出 walk 时语义逐行等价', () => {
  /**
   * 这段逻辑本来在 `TreeSitterAdapter.walk` 里，为了把 walk 从 101 压回预算内
   * 才搬成纯函数。搬动最大的风险不是「编译不过」，而是**悄悄改掉行为**且没有
   * 任何测试会红——所以这里直接钉住两处最容易改错的语义。
   */
  function target(): { tags?: string[]; properties: Record<string, unknown> } {
    return { properties: {} };
  }

  it('TODO + FIXME 同时命中：两个标签、两个计数、hasTodoFixme', () => {
    const node = target();
    applyTodoMarkers(node, ['TODO', 'FIXME']);
    expect(node.tags).toEqual(['todo', 'fixme']);
    expect(node.properties.todoCount).toBe(1);
    expect(node.properties.fixmeCount).toBe(1);
    expect(node.properties.hasTodoFixme).toBe(true);
  });

  it('计数是累加、标签只加一次（同一宿主下多条注释）', () => {
    const node = target();
    applyTodoMarkers(node, ['TODO']);
    applyTodoMarkers(node, ['TODO']);
    expect(node.tags).toEqual(['todo']);         // 不重复
    expect(node.properties.todoCount).toBe(2);   // 累加
  });

  it('只有 HACK 也要置 hasTodoFixme，但**不**产生 todo/fixme 标签', () => {
    // 这是搬动时最容易被「优化掉」的一条：hasTodoFixme 的判据是「命中任意标记」，
    // 不是「命中 TODO 或 FIXME」。写进循环体就会让这条用例红。
    const node = target();
    applyTodoMarkers(node, ['HACK']);
    expect(node.properties.hasTodoFixme).toBe(true);
    expect(node.properties.todoCount).toBeUndefined();
    expect(node.properties.fixmeCount).toBeUndefined();
    // 原实现只在需要追加标签时才赋值，所以 tags 保持 undefined（不是空数组）。
    expect(node.tags).toBeUndefined();
  });
});

// ── 6. 反向自检：本文件真的覆盖了多种 grammar ─────────────────────────────

describe('本测试自身覆盖度（防止单一 grammar 全绿看起来全绿）', () => {
  it('覆盖 ≥3 种 grammar', () => {
    expect(coveredGrammars.size).toBeGreaterThanOrEqual(3);
  });

  it('既断言过 exact 也断言过 inferred（单一取值不能全绿）', async () => {
    // 直接对纯函数构造两种输入，确认两种证据取值都可达——若实现把 evidence
    // 写死成常量，上面两组端到端用例必有一条失败；这里再钉一次取值域。
    const exact = resolveCallEdges({
      callSites: [site('x:main:2', 'foo')],
      localSymbols: [{ label: 'main', id: 'x:main:2' }, { label: 'foo', id: 'x:foo:1' }],
      importedFileSymbols: new Map(),
    });
    const inferred = resolveCallEdges({
      callSites: [site('x:main:2', 'foo')],
      localSymbols: [{ label: 'main', id: 'x:main:2' }],
      importedFileSymbols: new Map([['y', [{ label: 'foo', id: 'y:foo:1' }]]]),
    });
    const grades = new Set([
      exact.edges[0]!.properties.evidence,
      inferred.edges[0]!.properties.evidence,
    ]);
    expect(grades.size).toBe(2);
  });
});
