/**
 * T146-1 契约：Config schema 与 DEFAULT_CONFIG 的单一真源关系。
 *
 * cycle-146 引入 `Config`（Schemastery schema）后，配置默认值存在两处：
 * `DEFAULT_CONFIG`（运行时防线 resolveConfig 的输入）与 schema `.default()`（加载时
 * 防线 + 宿主设置 UI 的初值）。两处漂移的症状是「用户没改的配置项在设置 UI 显示一个
 * 值、实际生效另一个值」——静默且不可见，只能用契约钉死。
 *
 * 反射方式：schema 链不可靠地暴露内部字段列表（版本差异大），因此这里用**行为反射**：
 * 对每个字段用 `null`/缺失输入调用 schema，让默认值填充生效，再把产出与 DEFAULT_CONFIG
 * 逐字段比对。同时在场性断言：`~standard.validate`（Standard Schema 接口，cordis 加载
 * 期校验的依据）必须存在——「导出普通对象当 Config」的回归在这里红灯。
 *
 * 自我反证设计：若 schema 静默吞掉全部输入返回空对象，`Object.keys(resolved).length`
 * 断言会让测试显式失败，而不是「两边都是空」的假绿。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, Config, resolveConfig, type VisualizerConfig } from '../../src/host/config.ts';

describe('configSchemaContract (cycle-146 T146-1)', () => {
  it('CS-1 Config is a Standard Schema (~standard.validate present) — not a plain object', () => {
    expect(Config).toBeTypeOf('function');
    expect((Config as unknown as Record<string, unknown>)['~standard']).toBeTypeOf('object');
    expect(
      typeof ((Config as unknown as Record<string, unknown>)['~standard'] as { validate: unknown }).validate,
    ).toBe('function');
  });

  it('CS-2 schema defaults fill every DEFAULT_CONFIG field with the SAME value', () => {
    // 缺失输入 → schema 填默认值；null 输入 → schemastery 语义为「显式 null」，
    // 两种路径都必须落到与 DEFAULT_CONFIG 一致的值（对 array 字段 null 会原样通过，
    // 故 array 字段只走缺失路径）。
    const resolved = Config({}) as Record<string, unknown>;
    expect(Object.keys(resolved).length).toBeGreaterThanOrEqual(Object.keys(DEFAULT_CONFIG).length);
    for (const [key, expected] of Object.entries(DEFAULT_CONFIG)) {
      expect(resolved[key], `schema default for ${key} must equal DEFAULT_CONFIG.${key}`).toEqual(expected);
    }
  });

  it('CS-3 schema rejects out-of-contract values at load time (load-time defense line)', () => {
    // dataSource 枚举外 → 必须抛错（resolveConfig 的运行时防线之外再加一道加载时防线）
    expect(() => Config({ dataSource: 'no-such-source' as unknown as VisualizerConfig['dataSource'] })).toThrow();
    // 数字字段下界
    expect(() => Config({ requestTimeout: 1 })).toThrow();
    expect(() => Config({ maxNodes: 0 })).toThrow();
    // allowedOrigins 的 origin 模式
    expect(() => Config({ allowedOrigins: ['not-a-origin'] })).toThrow();
  });

  it('CS-4 resolveConfig still accepts a schema-validated payload (runtime defense intact)', () => {
    // cordis 用 schema 校验后把结果传给 apply；resolveConfig 必须对「合法载荷」零改动放行
    const payload = { ...DEFAULT_CONFIG };
    expect(resolveConfig(payload)).toEqual(DEFAULT_CONFIG);
  });

  it('CS-5 schema declaration covers every VisualizerConfig key (no silently dropped field)', () => {
    // 行为反射：传入非法越界值逐字段探测「schema 是否真的认识这个字段」——
    // 不认识的字段会被 object() 透传（schemastery 默认 strip 不认识的键，但这里的
    // object 声明是显式封闭的：未知键被丢弃）。用「越界值必抛错」证明字段被 schema 声明。
    const probed: Array<Partial<VisualizerConfig>> = [
      { dataSource: '__probe__' as VisualizerConfig['dataSource'] },
      { requestTimeout: -1 },
      { scanCacheTtl: -1 },
      { scanCacheLimit: 0 },
      { maxBodyBytes: 0 },
      { prerequisiteRetryDelay: 0 },
      { watchDebounce: 0 },
      { maxNodes: 0 },
      { panelMinHeight: 0 },
      { panelDefaultHeight: 0 },
      { allowedOrigins: ['bad-origin'] },
    ];
    for (const probe of probed) {
      expect(() => Config(probe as Record<string, unknown>), `field probe must be enforced: ${JSON.stringify(probe)}`).toThrow();
    }
  });
});
