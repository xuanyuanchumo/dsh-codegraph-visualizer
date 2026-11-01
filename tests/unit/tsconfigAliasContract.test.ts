/**
 * cycle-130：tsconfig 别名解析（AL）+ 数据来源徽章（GL）契约。
 *
 * AL：`@/utils/helper` 形态 import 依赖 tsconfig paths——cycle-129 登记的头号
 * 缺口。解析器是纯函数（parseTsconfigPaths / resolveAliasModule），JSONC 容错。
 *
 * GL：metadata.graphLayer（cycle-127 host 侧产出）此前客户端全链不透传——
 * 「数据来自上游还是原生」用户不可见（XJ-11 家族）。本轮 host /bootstrap 响应
 * → BootstrapData 类型 → WorkspaceBootstrap → store → StatusBar 全链接通。
 */
import { describe, it, expect } from 'vitest';
import { parseTsconfigPaths, resolveAliasModule } from '../../src/adapters/treeSitterExtractors.ts';

describe('tsconfig paths 别名解析（cycle-130 T1）', () => {
  it('AL-1 标准别名表解析：@/* → ./src/*（baseUrl 缺省同目录）', () => {
    const mapping = parseTsconfigPaths(`{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@/*": ["./src/*"] }
      }
    }`);
    expect(mapping).not.toBeNull();
    expect(resolveAliasModule(mapping!, '@/utils/helper')).toBe('src/utils/helper');
    expect(resolveAliasModule(mapping!, '@/components/Button')).toBe('src/components/Button');
  });

  it('AL-2 JSONC 容错：注释 + 尾逗号 + 非 tsconfig 输入', () => {
    const mapping = parseTsconfigPaths(`{
      // 项目配置
      "compilerOptions": {
        "baseUrl": "./", /* 根目录 */
        "paths": {
          "@app/*": ["./application/*", "./core/*"], // 多候选取首个
        },
      },
    }`);
    expect(mapping).not.toBeNull();
    // baseUrl `./` 归一为 `.`（同目录语义，等价）。
    expect(mapping!.baseUrl).toBe('.');
    expect(resolveAliasModule(mapping!, '@app/services/auth')).toBe('application/services/auth');
    // 非 tsconfig / 无 paths ⇒ null（诚实降级）。
    expect(parseTsconfigPaths('{"compilerOptions": {"target": "es2020"}}')).toBeNull();
    expect(parseTsconfigPaths('not json at all')).toBeNull();
  });

  it('AL-3 不匹配别名模式的模块名返回 null（调用方走相对/bare 逻辑）', () => {
    const mapping = parseTsconfigPaths('{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}');
    expect(mapping).not.toBeNull();
    // 相对路径 / 无关包名不归别名管。
    expect(resolveAliasModule(mapping!, './sibling')).toBeNull();
    expect(resolveAliasModule(mapping!, 'lodash')).toBeNull();
  });
});
