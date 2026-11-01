/**
 * 路径模式 ρ：边类型序列正则，编译为现有 `PathRule`。
 *
 * 璇玑图原型：「同一方锦缎，十种读法」。此前每种读法都得手写一个 `PathRule`——
 * `edgeTypes` 是一个**扁平 Set**，只能表达「每步可以走这些类型之一」，无法表达
 * 「第一步 call、第二步 import、第三步 dependency」这种**顺序约束**。
 * 研究方案 §4 把查询形式化为 `P = (v_s, ρ, v_t)`，ρ 是边类型序列正则——
 * 本模块就是把那个形式化落地的唯一入口。
 *
 * ## 设计裁决：编译到 PathRule，不新造枚举引擎
 *
 * 三条理由（每条都对应本仓已固化的事实，不是偏好）：
 *
 * 1. **剪枝与判据分离是本库的核心不变量**（`isLegalPath` 头注：「剪枝可以是超集，
 *    判据必须精确」）。ρ 天然适合这个分工：`edgeTypes` 取 ρ 中**出现过的所有类型**
 *    的并集（超集，安全方向——多走几步而已），精确的序列匹配放进 `pathConstraint`。
 *    复用一个已证明可靠的引擎，比新写一个 DFS 少一整套完备性风险。
 *
 * 2. **免费继承 `enumerate` 的全部工程能力**：分页游标（`nextCursor`）、Booth 规范化
 *    去重（同一条路径从不同起点读只算一条）、增量索引物化、`maxPaths` 截断、
 *    `top-k-weight` 排序。任何新引擎都要把这些重新做一遍并且重新证明。
 *
 * 3. **NFA 乘积索引被明确否决过**（cycle-111 / XJ-08 删除 `core/nfa.ts`：它只有
 *    `states = lMax - lMin + 1` 一个减法，而存在性需求已由 `existsWalk` 覆盖）。
 *    重新引入一个「状态表 + 乘积」的索引层会重复那次否决。本模块的 NFA 是
 *    **一次性的编译产物**（每规则一份、长度 = 正则规模），用于路径终判，
 *    不做跨规则乘积、不进哈希索引。
 *
 * ## 匹配语义（多重边：**并列标签**，不是「取第一条」）
 *
 * ρ 描述的是**边序列**（类型序列）。路径 `nodes` 有 `nodes.length - 1` 条边。
 *
 * 图空间允许多重边（`edgeKey` 是 `source->target->type`，同端不同型是两条边，
 * 见 `graph-space.ts` 的 `addEdge` 幂等键）。因此一条「节点对」在类型层面上是
 * **一组并列标签**：`u→v` 同时有 `call` 与 `import` 时，这条边的读法有两种。
 * 匹配语义必须是「**存在一种标签指派**使序列匹配 ρ」——这正好是 NFA 子集模拟
 * 的自然语义：每一步对**该节点对上所有存在的候选类型**取转移的并集。
 *
 * 为什么不能「取第一条命中的类型」（此处曾是一个真实缺陷，与 cycle-111 的
 * `pathWeight` 同族）：
 *
 * 取第一条会让 `Set` 的迭代序决定结果。实测反例：`u→v` 同时有 `call` 与
 * `import`，ρ = `import`。若候选集迭代序是 `['call','import']`，先命中 `call`，
 * ρ 判为不匹配——而图上明明存在一条 `import` 读法。更糟的是这个「不匹配」
 * 会随 `Set` 构造顺序翻转，同一条 ρ 在同一张图上有两种答案。取并集既正确又免疫顺序。
 *
 * 复杂度：编译 O(|ρ|)；终判 O(L·|Q|·|T|)，L 为路径边数、|Q| 为 NFA 状态数、
 * |T| 为该节点对上存在的候选类型数（通常 1，多重边时 2-3）。
 * 路径短（通常 ≤ 10）且 |Q| 与正则规模同阶，故终判成本可忽略。
 *
 * 零宿主依赖（库边界守卫会扫这个文件）。
 *
 * @module xuanji/core/path-pattern
 */

import type { GraphSpace, NodeId } from './graph-space.ts';
import type { EdgeType } from './graph-space.ts';
import type { PathRule, NormalizeStrategy } from './path-rule.ts';

// ── 语法树 ──────────────────────────────────────────────────────────────

/** ρ 的语法树节点（编译前的中间表示）。 */
export type PatternNode =
  /** 单个边类型。 */
  | { readonly kind: 'type'; readonly type: EdgeType }
  /** 拼接（a b 或 a.b）：先 a 后 b。 */
  | { readonly kind: 'concat'; readonly parts: readonly PatternNode[] }
  /** 并（a|b）：任一匹配。 */
  | { readonly kind: 'union'; readonly options: readonly PatternNode[] }
  /** 量词：重复 min..max 次（max 为 `Infinity` 表示无上界）。 */
  | { readonly kind: 'repeat'; readonly inner: PatternNode; readonly min: number; readonly max: number }
  /** 空串 ε：匹配零条边。 */
  | { readonly kind: 'empty' };

// ── 解析错误 ────────────────────────────────────────────────────────────

/**
 * ρ 解析/编译错误。
 *
 * 响亮失败：非法模式一律抛错，**不静默降级为「匹配一切」**。这条立场与
 * `effectiveMaxEdges`（无界 + 非 simple 直接抛错，不静默用 |V| 近似）同源——
 * 静默近似会让调用方以为自己拿到了精确结果。
 */
export class PathPatternError extends Error {
  readonly position: number;
  constructor(message: string, position = -1) {
    super(position >= 0 ? `${message} (at offset ${position})` : message);
    this.name = 'PathPatternError';
    this.position = position;
  }
}

// ── 词法 ────────────────────────────────────────────────────────────────

type TokenKind = 'type' | 'pipe' | 'dot' | 'lparen' | 'rparen' | 'star' | 'plus' | 'question' | 'lbrace' | 'rbrace' | 'comma' | 'number';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly pos: number;
}

/** 边类型名的合法字符集：字母、数字、下划线、连字符。 */
const TYPE_CHAR = /[A-Za-z0-9_-]/;

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '|') { tokens.push({ kind: 'pipe', text: ch, pos: i++ }); continue; }
    if (ch === '.') { tokens.push({ kind: 'dot', text: ch, pos: i++ }); continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', text: ch, pos: i++ }); continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', text: ch, pos: i++ }); continue; }
    if (ch === '*') { tokens.push({ kind: 'star', text: ch, pos: i++ }); continue; }
    if (ch === '+') { tokens.push({ kind: 'plus', text: ch, pos: i++ }); continue; }
    if (ch === '?') { tokens.push({ kind: 'question', text: ch, pos: i++ }); continue; }
    if (ch === '{') { tokens.push({ kind: 'lbrace', text: ch, pos: i++ }); continue; }
    if (ch === '}') { tokens.push({ kind: 'rbrace', text: ch, pos: i++ }); continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', text: ch, pos: i++ }); continue; }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < pattern.length && /[0-9]/.test(pattern[j]!)) j++;
      tokens.push({ kind: 'number', text: pattern.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (TYPE_CHAR.test(ch)) {
      let j = i;
      while (j < pattern.length && TYPE_CHAR.test(pattern[j]!)) j++;
      tokens.push({ kind: 'type', text: pattern.slice(i, j), pos: i });
      i = j;
      continue;
    }
    throw new PathPatternError(`unexpected character "${ch}" in path pattern`, i);
  }
  return tokens;
}

// ── 语法分析（递归下降） ────────────────────────────────────────────────

/**
 * 优先级（低 → 高）：`|` < 拼接 < 量词 < 原子。
 * 拼接是最松的隐式运算符：`a b` == `a.b` == 先 a 后 b。
 */
class PatternParser {
  private index = 0;
  private readonly tokens: readonly Token[];
  private readonly source: string;

  constructor(tokens: readonly Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  parse(): PatternNode {
    if (this.tokens.length === 0) return { kind: 'empty' };
    const node = this.parseUnion();
    if (this.index < this.tokens.length) {
      const tok = this.tokens[this.index]!;
      throw new PathPatternError(`unexpected "${tok.text}" in path pattern "${this.source}"`, tok.pos);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private eat(kind: TokenKind): Token | undefined {
    const tok = this.peek();
    if (!tok || tok.kind !== kind) return undefined;
    this.index++;
    return tok;
  }

  /** union := concat ('|' concat)* */
  private parseUnion(): PatternNode {
    const options: PatternNode[] = [this.parseConcat()];
    while (this.eat('pipe')) options.push(this.parseConcat());
    return options.length === 1 ? options[0]! : { kind: 'union', options };
  }

  /** concat := quantified (('.'? quantified))* */
  private parseConcat(): PatternNode {
    const parts: PatternNode[] = [this.parseQuantified()];
    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.kind === 'pipe' || tok.kind === 'rparen') break;
      this.eat('dot'); // `.` 是可选的显式拼接符
      parts.push(this.parseQuantified());
    }
    return parts.length === 1 ? parts[0]! : { kind: 'concat', parts };
  }

  /** quantified := atom ('*' | '+' | '?' | '{n[,m]}')? */
  private parseQuantified(): PatternNode {
    const atom = this.parseAtom();
    const tok = this.peek();
    if (!tok) return atom;
    if (tok.kind === 'star') { this.index++; return { kind: 'repeat', inner: atom, min: 0, max: Number.POSITIVE_INFINITY }; }
    if (tok.kind === 'plus') { this.index++; return { kind: 'repeat', inner: atom, min: 1, max: Number.POSITIVE_INFINITY }; }
    if (tok.kind === 'question') { this.index++; return { kind: 'repeat', inner: atom, min: 0, max: 1 }; }
    if (tok.kind === 'lbrace') {
      this.index++;
      const minTok = this.eat('number');
      if (!minTok) throw new PathPatternError('expected a number after "{"', tok.pos);
      const min = Number(minTok.text);
      let max = min;
      if (this.eat('comma')) {
        const maxTok = this.eat('number');
        max = maxTok ? Number(maxTok.text) : Number.POSITIVE_INFINITY;
      }
      if (!this.eat('rbrace')) throw new PathPatternError('expected "}" to close the repetition', tok.pos);
      if (!Number.isInteger(min) || min < 0) throw new PathPatternError(`invalid repetition lower bound ${min}`, tok.pos);
      if (max !== Number.POSITIVE_INFINITY && (!Number.isInteger(max) || max < min)) {
        throw new PathPatternError(`invalid repetition upper bound ${max} (min is ${min})`, tok.pos);
      }
      return { kind: 'repeat', inner: atom, min, max };
    }
    return atom;
  }

  /** atom := type | '(' union ')' */
  private parseAtom(): PatternNode {
    const tok = this.peek();
    if (!tok) throw new PathPatternError('unexpected end of path pattern', this.source.length);
    if (tok.kind === 'type') { this.index++; return { kind: 'type', type: tok.text }; }
    if (tok.kind === 'lparen') {
      this.index++;
      const inner = this.parseUnion();
      if (!this.eat('rparen')) throw new PathPatternError('expected ")" to close the group', tok.pos);
      return inner;
    }
    throw new PathPatternError(`unexpected "${tok.text}" in path pattern`, tok.pos);
  }
}

/** 解析 ρ 字符串为语法树。空串返回 ε（匹配零条边的空路径）。 */
export function parsePathPattern(pattern: string): PatternNode {
  if (typeof pattern !== 'string') throw new PathPatternError('path pattern must be a string');
  return new PatternParser(tokenize(pattern), pattern).parse();
}

// ── 编译：语法树 → NFA ──────────────────────────────────────────────────

/**
 * NFA 状态：一组「接受某条边之后能到达的状态」的转移表。
 *
 * 用**转移边标注的类型集合**而非字符集——一次转移可以同时接受多个边类型
 * （多类型分支合并），减少状态数。
 */
interface NfaState {
  /** 该状态是否为接受态。 */
  accept: boolean;
  /** 出边：{ 可接受的边类型集合, 目标状态 }。 */
  readonly transitions: Array<{ types: ReadonlySet<EdgeType>; to: number }>;
  /** ε 转移（Thompson 构造的胶水）。 */
  readonly epsilon: number[];
}

class NfaBuilder {
  readonly states: NfaState[] = [];

  newState(accept = false): number {
    this.states.push({ accept, transitions: [], epsilon: [] });
    return this.states.length - 1;
  }

  addTransition(from: number, types: ReadonlySet<EdgeType>, to: number): void {
    this.states[from]!.transitions.push({ types, to });
  }

  addEpsilon(from: number, to: number): void {
    this.states[from]!.epsilon.push(to);
  }
}

/**
 * Thompson 构造：返回 { start, accept }（都不是子片段自己的状态）。
 *
 * 说明：`repeat` 的 `max` 在编译期被展开为有限份拷贝（`max` 有限时），
 * 无上界时用「循环回到自身」表达（Kleene 星）。因此**编译产物大小与
 * `{n,m}` 的 m 线性相关**——`call{1,50}` 会产生 50 份拷贝，这是显式代价。
 */
function compileNode(node: PatternNode, b: NfaBuilder): { start: number; accept: number } {
  switch (node.kind) {
    case 'empty': {
      const s = b.newState();
      const a = b.newState(true);
      b.addEpsilon(s, a);
      return { start: s, accept: a };
    }
    case 'type': {
      const s = b.newState();
      const a = b.newState(true);
      b.addTransition(s, new Set([node.type]), a);
      return { start: s, accept: a };
    }
    case 'concat': {
      if (node.parts.length === 0) return compileNode({ kind: 'empty' }, b);
      let acc = compileNode(node.parts[0]!, b);
      const start = acc.start;
      for (let i = 1; i < node.parts.length; i++) {
        const next = compileNode(node.parts[i]!, b);
        // 拼接点：前一子片段的 accept 不再是接受态
        b.states[acc.accept]!.accept = false;
        b.addEpsilon(acc.accept, next.start);
        acc = { start, accept: next.accept };
      }
      return acc;
    }
    case 'union': {
      const s = b.newState();
      const a = b.newState(true);
      for (const option of node.options) {
        const sub = compileNode(option, b);
        b.addEpsilon(s, sub.start);
        b.states[sub.accept]!.accept = false;
        b.addEpsilon(sub.accept, a);
      }
      return { start: s, accept: a };
    }
    case 'repeat':
      return compileRepeat(node, b);
  }
}

function compileRepeat(
  node: Extract<PatternNode, { kind: 'repeat' }>,
  b: NfaBuilder,
): { start: number; accept: number } {
  const s = b.newState();
  // 先放 min 份必需拷贝
  let cursor = s;
  for (let i = 0; i < node.min; i++) {
    const sub = compileNode(node.inner, b);
    b.addEpsilon(cursor, sub.start);
    b.states[sub.accept]!.accept = false;
    // 中间态的 accept 已被清掉；用其 accept 作为下一段的入口
    cursor = sub.accept;
  }

  if (node.max === Number.POSITIVE_INFINITY) {
    // Kleene 星：一个可跳过的循环体
    const a = b.newState(true);
    const body = compileNode(node.inner, b);
    b.addEpsilon(cursor, a);          // 零次（或 min 次之后停止）
    b.addEpsilon(cursor, body.start); // 再来一次
    b.states[body.accept]!.accept = false;
    b.addEpsilon(body.accept, cursor); // 回到循环入口
    return { start: s, accept: a };
  }

  // 有限上界：额外 (max - min) 份可选拷贝
  const a = b.newState(true);
  b.addEpsilon(cursor, a); // 取 min 次就停
  let tail = cursor;
  const extra = node.max - node.min;
  for (let i = 0; i < extra; i++) {
    const sub = compileNode(node.inner, b);
    b.addEpsilon(tail, sub.start);
    b.states[sub.accept]!.accept = false;
    b.addEpsilon(sub.accept, a);
    tail = sub.accept;
  }
  return { start: s, accept: a };
}

/** ε 闭包（幂等：visited 集合保证每个状态只处理一次）。 */
function epsilonClosure(states: ReadonlySet<number>, nfa: readonly NfaState[]): Set<number> {
  const out = new Set<number>(states);
  const stack = [...states];
  while (stack.length > 0) {
    const s = stack.pop()!;
    for (const next of nfa[s]!.epsilon) {
      if (!out.has(next)) { out.add(next); stack.push(next); }
    }
  }
  return out;
}

/** 编译后的路径模式（可复用的终判器）。 */
export interface CompiledPathPattern {
  /** 原始 ρ 文本（诊断用）。 */
  readonly source: string;
  /** ρ 中出现的所有边类型（超集剪枝用）。 */
  readonly edgeTypes: ReadonlySet<EdgeType>;
  /** NFA 状态数（预算/诊断用）。 */
  readonly stateCount: number;
  /** 路径的最小边数（ρ 的下界，`lMin` 至少取它）。 */
  readonly minEdges: number;
  /** 路径的最大边数；无上界为 `Infinity`。 */
  readonly maxEdges: number;
  /**
   * 判断「给定的边类型序列」是否匹配 ρ（每步恰好一个标签）。
   *
   * 这是终判入口的**退化形态**：多重边上请用 {@link matchesLabelSequence}
   * （每步一组并列标签）。提供它是因为绝大多数单测与诊断场景只关心
   * 「类型序列字面匹配」，不需要建图。
   */
  matchesEdgeSequence(types: readonly EdgeType[]): boolean;
  /**
   * 判断「每步一组并列标签」的序列是否匹配 ρ。
   *
   * 多重边语义：存在一种「每步选一个标签」的指派使序列匹配。
   * 实现为 NFA 子集模拟，每步对**该步全部标签**取转移并集。
   */
  matchesLabelSequence(labelsPerStep: readonly (readonly EdgeType[])[]): boolean;
}

/** 语法树 → 各类型出现集合 + 长度区间（纯静态分析）。 */
function analyze(node: PatternNode, types: Set<EdgeType>): { min: number; max: number } {
  switch (node.kind) {
    case 'empty': return { min: 0, max: 0 };
    case 'type': types.add(node.type); return { min: 1, max: 1 };
    case 'union': {
      let min = Number.POSITIVE_INFINITY;
      let max = 0;
      for (const option of node.options) {
        const r = analyze(option, types);
        min = Math.min(min, r.min);
        max = Math.max(max, r.max);
      }
      return { min: min === Number.POSITIVE_INFINITY ? 0 : min, max };
    }
    case 'concat': {
      let min = 0;
      let max = 0;
      for (const part of node.parts) {
        const r = analyze(part, types);
        min += r.min;
        max = max === Number.POSITIVE_INFINITY || r.max === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : max + r.max;
      }
      return { min, max };
    }
    case 'repeat': {
      const r = analyze(node.inner, types);
      const max = r.max === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : r.max * node.max;
      return { min: r.min * node.min, max: node.max === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : max };
    }
  }
}

/**
 * 编译 ρ 为可复用终判器。
 *
 * @throws {PathPatternError} 语法错误 / 空类型名 / 重复上界小于下界
 */
export function compilePathPattern(pattern: string): CompiledPathPattern {
  const ast = parsePathPattern(pattern);
  const edgeTypes = new Set<EdgeType>();
  const bounds = analyze(ast, edgeTypes);
  if (edgeTypes.size === 0) {
    // ε 模式（空路径）是合法的，但没有边类型可剪枝——调用方会得到空子集，
    // 因此这里**明确允许**，由 compilePathRule 决定怎么处理（见其注释）。
  }

  const builder = new NfaBuilder();
  const fragment = compileNode(ast, builder);
  const nfa = builder.states;
  const startClosure = epsilonClosure(new Set([fragment.start]), nfa);

  return {
    source: pattern,
    edgeTypes,
    stateCount: nfa.length,
    minEdges: bounds.min,
    maxEdges: bounds.max,
    matchesEdgeSequence(types: readonly EdgeType[]): boolean {
      return runNfa(types.map((t) => [t]));
    },
    matchesLabelSequence(labelsPerStep: readonly (readonly EdgeType[])[]): boolean {
      if (labelsPerStep.some((labels) => labels.length === 0)) return false;
      return runNfa(labelsPerStep);
    },
  };

  /**
   * NFA 子集模拟。每步对**该步全部并列标签**取转移并集——
   * 这正是「存在一种标签指派使序列匹配」的实现（多重边语义）。
   */
  function runNfa(steps: readonly (readonly EdgeType[])[]): boolean {
    let current = startClosure;
    for (const labels of steps) {
      const next = new Set<number>();
      for (const state of current) {
        for (const transition of nfa[state]!.transitions) {
          for (const label of labels) {
            if (transition.types.has(label)) { next.add(transition.to); break; }
          }
        }
      }
      if (next.size === 0) return false;
      current = epsilonClosure(next, nfa);
    }
    for (const state of current) if (nfa[state]!.accept) return true;
    return false;
  }
}

// ── 与 PathRule 的桥接 ─────────────────────────────────────────────────

/**
 * 从图解析一对节点之间**所有存在的候选边类型**（多重边的并列标签）。
 *
 * 返回空数组表示「这对节点之间没有任何候选边」——调用方应判为不匹配。
 *
 * **刻意返回数组而不是单个类型。** 曾经这里是 `Edgetype | null`，按
 * `candidates` 的迭代序取第一条命中的类型，于是 `Set` 的构造顺序决定了
 * 匹配结果（多条边并存时 ρ 有两种答案）。取全部并列标签把「存在一种读法」
 * 这个语义交给 NFA 子集模拟处理，结果与迭代序无关。详见模块头注。
 *
 * 为什么不放在 `CompiledPathPattern` 里：那会让终判器依赖 `GraphSpace`，
 * 而终判器只需要类型序列。分层清楚，也让 `matchesEdgeSequence` 可以用
 * 纯字符串数组单测（无需建图）。
 */
export function edgeTypesBetween(
  graph: GraphSpace,
  from: NodeId,
  to: NodeId,
  candidates: ReadonlySet<EdgeType>,
): EdgeType[] {
  const present: EdgeType[] = [];
  for (const type of candidates) {
    if (graph.getEdge(from, to, type)) present.push(type);
  }
  return present;
}

/** `compilePathRule` 的选项。 */
export interface PathPatternRuleOptions {
  /** 规则名（诊断/索引键用）。 */
  readonly name?: string;
  /** 起点谓词；缺省「任意节点」。 */
  readonly start?: PathRule['start'];
  /** 终点谓词。 */
  readonly end?: PathRule['end'];
  /** 路径上每个节点必须满足（超集剪枝）。 */
  readonly nodeConstraint?: PathRule['nodeConstraint'];
  /**
   * 显式跳数区间。缺省取 ρ 自身的长度区间。
   *
   * 为什么允许覆盖：ρ 的 `{n,m}` 已表达长度，但调用方常用「任意 ρ、最多 5 跳」
   * 这种正交约束。取**交集**（与 ρ 的区间求交）而不是替换——替换会让
   * `call{2,4}` + `maxHops: 10` 静默接受 10 跳路径。
   */
  readonly minHops?: number;
  readonly maxHops?: number;
  /** 是否要求简单路径；缺省 `true`（与 findPathsBetween 一致）。 */
  readonly simple?: boolean;
  /** 是否闭合（环枚举）。 */
  readonly closed?: boolean;
  /** 规范化策略；缺省 `'none'`（与 findPathsBetween 一致）。 */
  readonly normalize?: NormalizeStrategy;
}

/**
 * 把 ρ 编译成一条 `PathRule`——**这是 ρ 进入枚举引擎的唯一通道**。
 *
 * 三件事的分工（缺一不可）：
 * - `edgeTypes` = ρ 中出现过的**所有**类型的并集（超集剪枝：不会误剪合法路径，
 *   只可能多走几步）。ε 模式（无类型）时为**空集**，`enumerate` 会因此返回空
 *   （`outNeighbors(node, 空集)` = 空）——这是诚实行为：没有边类型的 ρ 无法在
 *   非空路径上匹配，只有 `lMin = 0` 的单节点路径合法。
 * - `pathConstraint` = 精确的 NFA 终判（序列匹配）。
 * - `lMin` / `lMax` = ρ 长度区间与显式跳数区间的**交集**；ρ 无上界时用
 *   `minHops`/`maxHops`（或 `|V|`）兜底，绝不留下无界 + 非 simple 的非法组合。
 */
export function compilePathRule(pattern: string, options: PathPatternRuleOptions = {}): PathRule {
  const compiled = compilePathPattern(pattern);

  const patternMax = compiled.maxEdges;
  const optMax = options.maxHops ?? Number.POSITIVE_INFINITY;
  const lMaxRaw = Math.min(patternMax, optMax);
  const lMinRaw = Math.max(compiled.minEdges, options.minHops ?? 0);

  const simple = options.simple ?? true;
  // 无界 + 非 simple 是非法规则（路径集合无限，spec §八）：此时把 simple 强制为 true。
  // 静默把 lMax 收到 |V| 而保留 simple:false 会枚举「长度 ≤ |V| 的任意路径」，
  // 与调用方「简单路径」的预期不符——所以这里改 simple 而不是改 lMax。
  const needsBounding = lMaxRaw === Number.POSITIVE_INFINITY;
  const effectiveSimple = needsBounding ? true : simple;
  // 无上界时留给 effectiveMaxEdges 用 |V| 兜底（它要求 simple === true，上面已保证）。
  const lMax = needsBounding ? Number.POSITIVE_INFINITY : lMaxRaw;

  const rule: PathRule = {
    name: options.name ?? `pattern:${pattern}`,
    version: 1,
    start: options.start ?? (() => true),
    edgeTypes: compiled.edgeTypes,
    lMin: lMinRaw,
    lMax,
    simple: effectiveSimple,
    ...(options.nodeConstraint ? { nodeConstraint: options.nodeConstraint } : {}),
    ...(options.end ? { end: options.end } : {}),
    ...(options.closed === true ? { closed: true } : {}),
    normalize: options.normalize ?? 'none',
    // 精确终判：把 nodes 解成「每步并列标签」的序列，交给 NFA 子集模拟。
    // 迭代序无关性由 matchesLabelSequence 保证（见模块头注的实测反例）。
    pathConstraint: (nodes: readonly NodeId[], graph: GraphSpace) => {
      const labelsPerStep: EdgeType[][] = [];
      for (let i = 0; i + 1 < nodes.length; i++) {
        const labels = edgeTypesBetween(graph, nodes[i]!, nodes[i + 1]!, compiled.edgeTypes);
        if (labels.length === 0) return false;
        labelsPerStep.push(labels);
      }
      return compiled.matchesLabelSequence(labelsPerStep);
    },
  };
  return rule;
}

/**
 * 解析错误诊断：把 ρ 的错误位置映射回人类可读的指示（供工具层返回给模型）。
 *
 * 为什么单独给一个函数：LLM 拿到 `PathPatternError` 的裸 message 只能看到
 * 「unexpected `` at offset 12」，无法定位。这里给出带 `^` 标记的双行片段。
 */
export function describePatternError(pattern: string, error: unknown): string {
  if (!(error instanceof PathPatternError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.position < 0) return error.message;
  const caret = `${' '.repeat(Math.max(0, error.position))}^`;
  return `${error.message}\n  ${pattern}\n  ${caret}`;
}
