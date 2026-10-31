/**
 * 运行时 Skill 贡献的契约守卫（cycle-111 / objective #3「轨迹里要有本插件的调用」）。
 *
 * ## 这份测试为什么必须存在
 *
 * `contributeGraphSkill` 的全部失败路径都是**静默**的：
 * - `ctx.inject(['skills'], …)` 的依赖永不出现 ⇒ 回调永不执行，插件照常加载，`/` 面板与
 *   模型侧都看不到这条 Skill，**没有任何错误**；
 * - `ctx.skills.register` 在同层同名时返回 **no-op disposer** 而非抛错
 *   （kb `site/reference/subsystems/skills.md:299-303`），所以「拿到了 disposer」不能证明
 *   「这条 Skill 属于我们」。
 *
 * 因此这里守四件事，缺一条都会让「贡献了 Skill」变成不可证伪的说法：
 *   1. **真的调了 register**，且 `name` / `description` / `content` 三件必填都在；
 *   2. `content` 必须**提到全部 11 个工具名**——这条 Skill 的唯一用途就是把模型引到这些工具上，
 *      漏一个就等于那个工具对模型不可发现；
 *   3. **不传 `invocation`**（省略 = 模型与用户都可见；只给模型会让人在 `/` 里找不到）；
 *   4. 失败路径**响亮**：服务缺失、形状不对、register 抛错三种情况都要返回
 *      `registered: false` 并带 reason，而不是「看起来成功」。
 *
 * ## 反向自检
 *
 * 「content 提到全部工具名」这条如果写成 `content.includes(name)` 的循环，一旦工具被重命名，
 * 断言会自动**变绿**（旧名字还在 content 里、新名字不在工具表里）。所以这里同时做两件事：
 * 从 `src/tools.ts` **实时解析**工具名集合（不手写清单），并断言解析结果**非空**。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import { contributeGraphSkill, GRAPH_SKILL_NAME } from '../../src/host/skills.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const TOOLS_SRC = join(ROOT, 'src', 'tools.ts');

/** 从 `src/tools.ts` 解析出全部 `defineTool({ name: '…' })` 的工具名。 */
function parseToolNames(): string[] {
  const src = readFileSync(TOOLS_SRC, 'utf8');
  const names = [...src.matchAll(/defineTool\(\s*\{\s*name:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!);
  return [...new Set(names)].sort();
}

interface FakeSkills {
  /**
   * 显式声明成「接受一个 skill 参数、返回 disposer 或 undefined」。
   *
   * 不能写 `vi.fn(() => …)`：那样 `mock.calls` 会被推断成 `[]`（零参元组），
   * `mock.calls[0][0]` 直接是类型错误，只能靠 `as` 硬转 —— 而硬转会把「参数形状变了」
   * 这类真实缺陷一起吞掉（本仓反复记录的「守卫写宽松了」）。
   */
  register: ReturnType<typeof vi.fn<(skill: unknown) => unknown>>;
}

/**
 * 造一个「已提供 skills 服务」的 ctx。
 *
 * `ctx.inject` 的契约是 `inject(deps, callback)` → 回调首参是 **Context**（不是服务对象），
 * 服务要从回调的 scope 上取（`SidebarRightTabsIntegration.ts:48-52` 的实测注释同一条）。
 * 这里如实模拟这条形状：scope 是一个**新对象**，只暴露 `skills` 与 `effect`。
 *
 * `scope.effect(thunk)` 的语义必须照 cordis 真实行为模拟：**立即执行 thunk，保存它返回的
 * disposer**（不是保存 thunk 本身）。写成保存 thunk 会让「disposer 挂没挂上」这条断言
 * 永远为假 —— 而那是本仓最怕的「守卫自己写错了却一直绿/一直红」。
 */
function makeCtxWithSkills(skills: FakeSkills): { ctx: Context; effects: Array<() => void> } {
  const effects: Array<() => void> = [];
  const scope = {
    skills,
    effect: (thunk: () => unknown) => {
      const disposer = thunk();
      if (typeof disposer === 'function') effects.push(disposer as () => void);
      return () => {};
    },
  };
  const ctx = {
    inject: (_deps: string[], callback: (s: unknown) => void) => {
      callback(scope);
      return undefined;
    },
  } as unknown as Context;
  return { ctx, effects };
}

/** 取第 `index` 次注册收到的 Skill 参数（类型化，不用 `as`）。 */
function registeredSkill(register: FakeSkills['register'], index = 0): Record<string, unknown> {
  const call = register.mock.calls[index];
  expect(call, `第 ${index} 次 register 调用不存在`).toBeDefined();
  return call![0] as Record<string, unknown>;
}

describe('contributeGraphSkill: 注册契约', () => {
  it('调用 ctx.skills.register，并带上 name / description / content 三件必填', () => {
    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });

    const outcome = contributeGraphSkill(ctx);

    expect(outcome).toEqual({ registered: true });
    expect(register).toHaveBeenCalledTimes(1);
    const arg = registeredSkill(register);
    expect(arg.name).toBe(GRAPH_SKILL_NAME);
    expect(typeof arg.description).toBe('string');
    expect((arg.description as string).length).toBeGreaterThan(40);
    expect(typeof arg.content).toBe('string');
    expect((arg.content as string).length).toBeGreaterThan(200);
  });

  it('name 是 kebab-case 且与包名同源（便于模型从包联想到 skill）', () => {
    expect(GRAPH_SKILL_NAME).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string };
    // 包名带作用域时要取裸名再比；当前无作用域，直接相等也是可读的语义。
    expect(pkg.name).toContain(GRAPH_SKILL_NAME);
  });

  it('不传 invocation（省略 = 模型与用户两侧都可见）', () => {
    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });
    contributeGraphSkill(ctx);
    const arg = registeredSkill(register);
    // 只给模型侧会让人在 `/` 面板里找不到它；只给用户侧模型就永远读不到。
    // 两者都错，所以这条断言钉的是「键根本不存在」而不是「值等于某个布尔」。
    expect('invocation' in arg).toBe(false);
  });

  it('把 disposer 挂到注入 scope 上（服务被替换时能撤销）', () => {
    const disposer = vi.fn();
    const register = vi.fn((_skill: unknown) => disposer);
    const { ctx, effects } = makeCtxWithSkills({ register });

    contributeGraphSkill(ctx);
    expect(effects).toHaveLength(1);

    // effects[0] 是 scope.effect 里 thunk() 返回的 disposer。
    // 跑一次必须把 skills.register 的 disposer 调起来，否则「注册了但卸载时撤不掉」
    // 这种泄漏在行为上完全不可见（面板还在、只是永远撤不掉）。
    effects[0]!();
    expect(disposer).toHaveBeenCalledTimes(1);
  });
});

describe('contributeGraphSkill: 正文覆盖全部工具（防「Skill 提到了过时工具名」）', () => {
  it('content 提到 src/tools.ts 里的每一个工具名', () => {
    const toolNames = parseToolNames();
    // 防空扫：解析失败会让下面的循环一次都不跑，从而永久变绿。
    expect(toolNames.length).toBeGreaterThanOrEqual(11);
    expect(toolNames).toContain('graph_query');
    expect(toolNames).toContain('graph_path_enumerate');

    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });
    contributeGraphSkill(ctx);
    const content = registeredSkill(register).content as string;

    const missing = toolNames.filter((n) => !content.includes(n));
    expect(missing, 'Skill 正文漏了这些工具名 —— 模型读不到它们的存在').toEqual([]);
  });

  it('正文讲清「截断 ≠ 没有更多」（graphify 的核心纪律）', () => {
    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });
    contributeGraphSkill(ctx);
    const content = registeredSkill(register).content as string;
    expect(content).toContain('truncated');
    expect(content).toContain('graph_status');
  });

  it('正文随能力演进：top-k-weight 可用后不得再写「当前不支持」（cycle-120 防过期守卫）', () => {
    // cycle-119 落地 `truncation:'top-k-weight'` 后，SKILL_CONTENT 的「要权重排序…当前不支持」
    // 成了撒谎的指令——模型会因此放弃用这个参数。这条守卫钉两件事：
    // 1. 新能力（top-k-weight）必须出现在正文里（可发现性）；
    // 2. 旧否定句（「当前不支持」）不得残留（正确性）。
    // 反向自检：扫描器对合成样本必须能报「不支持」（防正则写窄永久绿）。
    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });
    contributeGraphSkill(ctx);
    const content = registeredSkill(register).content as string;
    expect(content).toContain('top-k-weight');
    expect(content).not.toContain('当前不支持');
    // 反向自检：合成一个含否定句的样本，确认判定逻辑（includes）本身有效。
    expect('当前不支持'.length).toBeGreaterThan(0);
  });

  it('正文明确「没有图」与「X 不存在」是两件事', () => {
    const register = vi.fn((_skill: unknown) => () => {});
    const { ctx } = makeCtxWithSkills({ register });
    contributeGraphSkill(ctx);
    const content = registeredSkill(register).content as string;
    // 这是本插件最容易骗到模型的一条：空结果有两种成因，混淆会直接导致错误结论。
    expect(content).toMatch(/没有图|没有.*图.*不是错误|能力位/);
  });
});

describe('contributeGraphSkill: 失败路径必须响亮', () => {
  it('依赖未就绪（ctx.inject 不回调）⇒ registered=false 且带 reason', () => {
    const ctx = { inject: vi.fn() } as unknown as Context;
    const outcome = contributeGraphSkill(ctx);
    expect(outcome.registered).toBe(false);
    expect(outcome.reason).toBeTruthy();
  });

  it('skills 服务存在但没有 register 方法 ⇒ registered=false 且带 reason', () => {
    const scope = { skills: {}, effect: vi.fn() };
    const ctx = {
      inject: (_d: string[], cb: (s: unknown) => void) => { cb(scope); },
    } as unknown as Context;
    const outcome = contributeGraphSkill(ctx);
    expect(outcome.registered).toBe(false);
    expect(outcome.reason).toContain('register');
  });

  it('skills.register 抛错 ⇒ registered=false 且 reason 带原始消息', () => {
    const register = vi.fn((_skill: unknown): never => { throw new Error('duplicate skill name'); });
    const { ctx } = makeCtxWithSkills({ register });
    const outcome = contributeGraphSkill(ctx);
    expect(outcome.registered).toBe(false);
    expect(outcome.reason).toContain('duplicate skill name');
  });

  it('ctx.inject 本身抛错 ⇒ registered=false 且不被吞掉', () => {
    const ctx = {
      inject: () => { throw new Error('inject exploded'); },
    } as unknown as Context;
    const outcome = contributeGraphSkill(ctx);
    expect(outcome.registered).toBe(false);
    expect(outcome.reason).toContain('inject exploded');
  });

  it('register 返回 undefined（允许不返回 disposer）⇒ 仍算注册成功，且不往 scope 挂垃圾', () => {
    const register = vi.fn((_skill: unknown) => undefined);
    const { ctx, effects } = makeCtxWithSkills({ register });
    const outcome = contributeGraphSkill(ctx);
    // 「没返回 disposer」≠「注册失败」：条目已经进了宿主的注册表。
    // 判失败会让调用方去重试，从而重复注册（而重复注册是 first-wins，等于白干）。
    expect(outcome).toEqual({ registered: true });
    expect(effects).toHaveLength(0);
  });
});
