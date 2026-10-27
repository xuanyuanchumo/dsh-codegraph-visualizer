/**
 * 规则注册表：热插拔、版本演进、惰性索引、废弃回收。
 *
 * 璇玑图原型：同一方锦缎的读法可以随朝代更替而增删——新读法顶替旧读法时，
 * 旧读法不是立刻消失，而是先被标记 deprecated；等引用它的索引真正空掉，
 * GC 才回收这个名字。
 *
 * 隔离性（关键契约）：索引按规则名隔离。更新/废弃一条规则只影响它自己的索引，
 * **不触碰其它规则已物化的条目**——否则一次热插拔会让所有读法重新枚举。
 *
 * 零宿主依赖。
 *
 * @module xuanji/registry/rule-registry
 */

import type { EdgeType } from '../core/graph-space.ts';
import type { PathRule, RuleValidation } from '../core/path-rule.ts';
import { validateRule } from '../core/path-rule.ts';
import { PathIndex } from '../index/path-index.ts';

/** 注册表的内部槽位：当前版本 + 退役版本历史 + 名称级废弃标记。 */
interface RuleSlot {
  current: PathRule | undefined;
  /** 被同名新版本顶替的旧版本（deprecated，仅供审计/GC 判定）。 */
  readonly history: PathRule[];
  /** 名称级废弃：deprecate() 置位，gc() 回收。 */
  deprecated: boolean;
}

/**
 * 规则注册表。
 *
 * 版本语义：
 * - `register` 遇到同名规则时视为一次热替换：旧版本进 history（deprecated），新版本成为 current；
 * - `replace` 是热替换的显式入口，返回被顶替的旧版本；
 * - `get` 只返回 current（已废弃的名字返回 undefined）；
 * - `gc` 只回收「名称已废弃且没有 live 物化条目」的槽位——
 *   索引里仍有 live 条目说明调用方可能还在用，回收会让查询凭空少数据。
 */
export class RuleRegistry {
  /** 构造成员：注册时用于校验 Σ_R ⊆ Σ。 */
  readonly knownEdgeTypes: ReadonlySet<EdgeType>;

  private readonly slots = new Map<string, RuleSlot>();
  private readonly indexes = new Map<string, PathIndex>();
  private readonly warningsByRule = new Map<string, string[]>();

  constructor(knownEdgeTypes: ReadonlySet<EdgeType>) {
    this.knownEdgeTypes = new Set(knownEdgeTypes);
  }

  /**
   * 注册规则。校验有 error 时**不注册**，原样返回校验结果（errors 非空）；
   * 校验产生的 warnings 记录在 `warningsFor(name)`，同时随返回值交给调用方。
   *
   * 同名规则再次注册等价于一次热替换：旧版本进入 history（deprecated），
   * 该名字的索引被丢弃（旧版本的物化结果对新版本不再可信），其它规则索引不受影响。
   *
   * @param options.eager 为 true 时立刻创建（空）索引；缺省惰性创建
   */
  register(rule: PathRule, options: { eager?: boolean } = {}): RuleValidation {
    const validation = validateRule(rule, this.knownEdgeTypes);
    if (validation.errors.length > 0) return validation;

    const warnings = [...validation.warnings];
    let slot = this.slots.get(rule.name);
    if (!slot) {
      slot = { current: undefined, history: [], deprecated: false };
      this.slots.set(rule.name, slot);
    } else if (slot.current) {
      slot.history.push(slot.current);
      warnings.push('rule "' + rule.name + '" replaced: previous version ' + slot.current.version + ' is now deprecated');
    }
    slot.current = rule;
    slot.deprecated = false;

    // 旧版本的索引对新版本不再可信；其它规则名下的索引保持不变。
    this.indexes.delete(rule.name);
    this.warningsByRule.set(rule.name, warnings);
    if (options.eager === true) this.indexes.set(rule.name, new PathIndex());

    return { errors: [], warnings };
  }

  /** 当前版本（已废弃/未注册的名字返回 undefined）。 */
  get(name: string): PathRule | undefined {
    return this.slots.get(name)?.current;
  }

  /** 当前版本号。 */
  getVersion(name: string): number | undefined {
    return this.slots.get(name)?.current?.version;
  }

  /** 所有未废弃规则（插入序）。 */
  list(): PathRule[] {
    const result: PathRule[] = [];
    for (const slot of this.slots.values()) {
      if (slot.current) result.push(slot.current);
    }
    return result;
  }

  /**
   * 显式热替换：同名新版本顶替当前版本，旧版本进入 history（deprecated）。
   *
   * 与 `register` 的区别：这里**不做静态校验**（热替换的规则通常已由上游校验过）。
   * 需要校验请先调用 `register`，或用 `validateRule` 自行校验。
   */
  replace(rule: PathRule): { previous: PathRule | undefined } {
    const slot = this.slots.get(rule.name);
    const previous = slot?.current;
    if (!slot) {
      this.slots.set(rule.name, { current: rule, history: [], deprecated: false });
      this.indexes.delete(rule.name);
      return { previous: undefined };
    }
    if (previous) slot.history.push(previous);
    slot.current = rule;
    slot.deprecated = false;
    this.indexes.delete(rule.name);
    return { previous };
  }

  /**
   * 废弃一个规则名：当前版本移入 history，名字置为 deprecated。
   * 幂等：已废弃或不存在返回 false。
   *
   * 索引**刻意保留**：gc 需要靠它判断是否仍有 live 物化条目（引用）。
   */
  deprecate(name: string): boolean {
    const slot = this.slots.get(name);
    if (!slot || slot.deprecated) return false;
    if (slot.current) {
      slot.history.push(slot.current);
      slot.current = undefined;
    }
    slot.deprecated = true;
    return true;
  }

  /**
   * 回收「名称已废弃且索引中没有 live 物化条目」的规则。
   *
   * 「无引用」的定义：该名字下不再有 live 物化路径。索引里还剩 live 条目时保留，
   * 因为调用方可能仍持有索引引用——回收会让它的查询凭空少数据。
   *
   * @returns 本次回收的规则名
   */
  gc(): string[] {
    const collected: string[] = [];
    for (const [name, slot] of this.slots) {
      if (!slot.deprecated || slot.current) continue;
      const index = this.indexes.get(name);
      if (index && index.liveCount() > 0) continue;
      this.slots.delete(name);
      this.indexes.delete(name);
      this.warningsByRule.delete(name);
      collected.push(name);
    }
    return collected;
  }

  /** 名称是否已被废弃（gc 之前为 true）。 */
  isDeprecated(name: string): boolean {
    return this.slots.get(name)?.deprecated === true;
  }

  /** 惰性创建并返回该规则名的索引；名字未注册返回 undefined。 */
  index(name: string): PathIndex | undefined {
    if (!this.slots.has(name)) return undefined;
    let index = this.indexes.get(name);
    if (!index) {
      index = new PathIndex();
      this.indexes.set(name, index);
    }
    return index;
  }

  /** 某规则最近一次注册产生的校验告警（只读副本）。 */
  warningsFor(name: string): readonly string[] {
    return [...(this.warningsByRule.get(name) ?? [])];
  }
}
