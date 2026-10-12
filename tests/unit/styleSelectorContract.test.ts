import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import cytoscape from 'cytoscape';
import { buildStylesheet } from '../../src/client/renderer/styles/ThemeStylesheet.ts';

/**
 * 数据属性与样式选择器的类型契约（cycle-89）。
 *
 * 缺陷形态：写入侧一律写 JS 布尔字面量，样式侧却写成字符串比较 `[flag="true"]`。
 * cytoscape 的 `[flag="true"]` 只匹配**字符串** `"true"`，因此这 24 条规则从未命中任何真实元素
 * （实测：聚类节点拿到的是 module 配色而非 clusterBg，z-index 0 而非 5）。
 * 反向也成立：`[flag = true]` 不是合法语法，会抛 `The selector '[flag = true]' is invalid`。
 * 唯一可用的布尔形式是真值选择器 `[?flag]`。
 *
 * 本文件从两个方向守：
 *   1. 静态：样式文件里凡是「拿字符串 true/false 比数据属性」的写法，属性名必须落在
 *      `STRING_VALUED_PROPS` 白名单里（目前只有 `cfgEdgeType`，其写入值就是字符串 'true'/'false'）。
 *   2. 行为：用**真实** stylesheet + headless cytoscape 验证布尔属性真的命中了样式，
 *      并且数字属性（clusterHue / parentCount）用数字字面量比较才命中。
 *
 * 为什么行为层不能只用 `[?flag]`：真值选择器会连字符串 "false"、数字 1 一起命中。
 * 因此写入侧「这些属性只能是布尔」这一条也被钉住（第 4 组用例）。
 */

const ROOT = join(__dirname, '..', '..');
const STYLE_DIR = join(ROOT, 'src', 'client', 'renderer', 'styles');

/**
 * 写入侧被证实为 JS 布尔的属性（每一项都给出写入点，见 cycle-89 审计）。
 * 这些属性在样式里必须用 `[?flag]`，不得用 `[flag="true"]`。
 */
const BOOLEAN_DATA_PROPS = [
  'isCluster',   // src/client/renderer/DataController.ts:260,265 / store/cluster/progressiveCluster.ts:83,272,334,392
  'isRoot',      // src/client/diagram/ClassAssembler.ts:49 / InheritanceAssembler.ts:37 / HierarchicalAssembler.ts:145
  'isEntry',     // src/client/diagram/CallGraphAssembler.ts:32,42 / CFGAssembler.ts:116,127
  'isRecursive', // src/client/diagram/CallGraphAssembler.ts:46
  'isPackage',   // src/client/diagram/PackageAssembler.ts:20 (isDirProperty) / HierarchicalAssembler.ts:43
  'isPackageEdge', // src/client/diagram/PackageAssembler.ts:21 (isEdgeProperty) / HierarchicalAssembler.ts:98
  'isAbstract',  // src/client/diagram/ClassAssembler.ts:56 / InheritanceAssembler.ts:41
  'isFragment',  // src/client/diagram/SequenceAssembler.ts:612
  'isAsync',     // src/client/diagram/SequenceAssembler.ts:287,510,536,587
  'isReturn',    // src/client/diagram/SequenceAssembler.ts:289,512,538,589
  'isSelfCall',  // src/client/diagram/SequenceAssembler.ts:288,511,537,588
] as const;

/**
 * 写入侧**确实**是字符串的"true"/"false" 的属性。目前仅此一项：
 * src/client/diagram/CFGAssembler.ts:325/342/398 写入 `edgeType: 'true' | 'false'`，
 * src/client/diagram/CFGAssembler.ts:680 再以 `cfgEdgeType: edge.edgeType` 落到 cytoscape data。
 * 它用字符串比较是**正确**的，不得被本契约误判。
 */
const STRING_VALUED_PROPS = new Set(['cfgEdgeType']);

/** 写入侧是数字、却曾被当成字符串比较的属性。 */
const NUMERIC_DATA_PROPS = [
  'clusterHue',  // src/client/renderer/DataController.ts:404 -> Math.abs(hash) % 12
  'parentCount', // src/client/diagram/ClassAssembler.ts:50 / InheritanceAssembler.ts:38 -> parentEdges.length
] as const;

function styleFiles(): string[] {
  return readdirSync(STYLE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

/** 抓 `[prop="true"]` / `[prop="false"]`，豁免 `node:` 之类的非选择器上下文由调用方决定。 */
const STRING_BOOL_SELECTOR = /\[([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(true|false)"\]/g;

interface Offender {
  file: string;
  line: number;
  prop: string;
  text: string;
}

function scanStringBoolSelectors(source: string, file: string): Offender[] {
  const found: Offender[] = [];
  const lines = source.split('\n');
  lines.forEach((text, index) => {
    for (const match of text.matchAll(STRING_BOOL_SELECTOR)) {
      found.push({ file, line: index + 1, prop: match[1] ?? '', text: text.trim() });
    }
  });
  return found;
}

describe('样式选择器与数据属性的类型契约', () => {
  describe('静态扫描：布尔属性不得用字符串比较', () => {
    it('每个文件的字符串 true/false 选择器都只出现在白名单属性上', () => {
      const offenders: Offender[] = [];
      for (const file of styleFiles()) {
        const source = readFileSync(join(STYLE_DIR, file), 'utf8');
        for (const hit of scanStringBoolSelectors(source, file)) {
          if (!STRING_VALUED_PROPS.has(hit.prop)) offenders.push(hit);
        }
      }
      expect(
        offenders,
        `布尔数据属性被当成字符串比较——cytoscape 的 [flag="true"] 只匹配字符串 "true"，` +
          `这些规则永远不会命中真实元素。请改用 [?flag]：\n` +
          offenders.map((o) => `  ${o.file}:${o.line} [${o.prop}] >> ${o.text}`).join('\n'),
      ).toEqual([]);
    });

    it('反向自检：扫描器确实能识别出字符串比较，且白名单项被保留', () => {
      // 正向样本必须命中
      const sample = "selector: 'edge[cfgEdgeType=\"true\"]',";
      const hits = scanStringBoolSelectors(sample, 'sample.ts');
      expect(hits).toHaveLength(1);
      expect(hits[0]?.prop).toBe('cfgEdgeType');
      expect(STRING_VALUED_PROPS.has(hits[0]?.prop ?? '')).toBe(true);

      // 必须能在真实文件里找到白名单项，否则"白名单"是无意义的空集
      const all = styleFiles().flatMap((file) =>
        scanStringBoolSelectors(readFileSync(join(STYLE_DIR, file), 'utf8'), file),
      );
      expect(all.length, '样式文件里应当仍有字符串取值的选择器（cfgEdgeType）').toBeGreaterThan(0);
      expect(all.every((hit) => STRING_VALUED_PROPS.has(hit.prop))).toBe(true);

      // 不得再有布尔属性被字符串比较
      const boolPropsInStyles = all.filter((hit) =>
        (BOOLEAN_DATA_PROPS as readonly string[]).includes(hit.prop),
      );
      expect(boolPropsInStyles).toEqual([]);
    });

    it('样式文件里出现的布尔属性选择器都使用 [?flag] 真值形式', () => {
      const used = new Set<string>();
      for (const file of styleFiles()) {
        const source = readFileSync(join(STYLE_DIR, file), 'utf8');
        for (const match of source.matchAll(/\[\?([A-Za-z_][A-Za-z0-9_]*)\]/g)) {
          used.add(match[1] ?? '');
        }
      }
      // 至少要覆盖聚类/入口/递归/抽象/包这几个语义高价值属性
      for (const prop of ['isCluster', 'isEntry', 'isRecursive', 'isAbstract', 'isPackage']) {
        expect(used.has(prop), `样式里应当用 [?${prop}] 选择该布尔属性`).toBe(true);
      }
    });

    it('数字属性用数字字面量比较，不用字符串', () => {
      for (const file of styleFiles()) {
        const source = readFileSync(join(STYLE_DIR, file), 'utf8');
        for (const prop of NUMERIC_DATA_PROPS) {
          const asString = new RegExp(`\\[${prop}\\s*=\\s*"`);
          expect(asString.test(source), `${file} 不应把数字属性 ${prop} 当字符串比较`).toBe(false);
        }
      }
    });
  });

  describe('行为验证：真实 stylesheet + headless cytoscape', () => {
    const sheet = buildStylesheet('dark', 10);

    it('布尔 true 的聚类节点命中聚类样式（修复前 bg 落到 module 色、z-index 0）', () => {
      const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        style: sheet,
        elements: [
          { data: { id: 'cluster', isCluster: true, childCount: 5, label: 'C', type: 'module' } },
          { data: { id: 'plain', label: 'P', type: 'module' } },
        ] as never[],
      });
      const cluster = cy.getElementById('cluster');
      const plain = cy.getElementById('plain');

      // 聚类规则给了 z-index 5 与 bold；module 规则没有这两项
      expect(cluster.style('z-index')).toBe('5');
      expect(cluster.style('font-weight')).toBe('bold');
      expect(plain.style('z-index')).not.toBe('5');
    });

    it('未设置布尔属性的节点不受该规则影响', () => {
      const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        style: sheet,
        elements: [{ data: { id: 'n', label: 'N', type: 'function' } }] as never[],
      });
      expect(cy.getElementById('n').style('z-index')).not.toBe('5');
    });

    it('数字 clusterHue 用数字字面量命中（字符串比较命中 0 个）', () => {
      const cy = cytoscape({
        headless: true,
        elements: [
          { data: { id: 'numHue', isCluster: true, clusterHue: 3 } },
          { data: { id: 'strHue', isCluster: true, clusterHue: '3' } },
        ] as never[],
      });
      expect(cy.nodes('[?isCluster][clusterHue = 3]').map((n) => n.id())).toEqual(['numHue']);
      expect(cy.nodes('[?isCluster][clusterHue = "3"]').map((n) => n.id())).toEqual(['strHue']);
    });

    it('数字 parentCount 用数字字面量命中', () => {
      const cy = cytoscape({
        headless: true,
        elements: [
          { data: { id: 'zero', isRoot: true, parentCount: 0 } },
          { data: { id: 'one', isRoot: true, parentCount: 1 } },
        ] as never[],
      });
      expect(cy.nodes('[?isRoot][parentCount = 0]').map((n) => n.id())).toEqual(['zero']);
    });
  });

  describe('写入侧：布尔属性不得被写成字符串', () => {
    it('src/ 里没有任何布尔属性被赋字符串字面量', () => {
      const srcRoot = join(ROOT, 'src');
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules') continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.tsx?$/.test(entry.name)) files.push(full);
        }
      };
      walk(srcRoot);
      expect(files.length, 'src 文件遍历不应为空').toBeGreaterThan(100);

      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const prop of BOOLEAN_DATA_PROPS) {
          const re = new RegExp(`${prop}\\s*:\\s*['"\`]`);
          if (re.test(source)) {
            offenders.push(`${file.replace(ROOT, '').replace(/\\/g, '/')} 把 ${prop} 写成字符串`);
          }
        }
      }
      expect(
        offenders,
        `[?flag] 是"真值"而非"严格等于 true"，会连字符串 "false" 一起命中；` +
          `因此写入侧必须保持布尔：\n${offenders.join('\n')}`,
      ).toEqual([]);
    });
  });
});
