/**
 * 官方技能注册（cycle-97：结合 DSH 规范暴露技能插件能力）。
 *
 * 把 ai-native-iteration-cycle 经 `ctx.skills.register()` 注册为 runtime skill：
 *   - 模型在会话目录（<available_skills>，dsh-tool-skill 首个 pre-step 注入）中
 *     发现本技能，经官方 `skill({name})` 工具加载正文；
 *   - 调用进 DSH 轨迹（tool/call + tool/result 会话事件）——
 *     「DSH大模型使用时 dsh 的轨迹要有本技能插件的调用」的官方通道；
 *   - 与工作区 .dsh/skills/ 安装态共存：同层内 project 条目胜过 runtime 条目
 *     （skills.md「本地发现优先级」），重名不冲突。
 *
 * 契约（dsh-plugin-dev-kb 参考实现 + kb/site/reference/subsystems/skills.md）：
 *   ctx.skills.register({ name, description, whenToUse?, source: 'runtime',
 *                          content, resourceBase? }) — 定义校验要求
 *   name/description/source/content 四个字符串；provider 缺省 'runtime'。
 *
 * 多代防御：宿主无 skills 服务（旧代/stub）时记日志跳过，绝不让插件挂载失败；
 * 接线用 ctx.inject(['skills'], cb)（存在性+时序都交给宿主；服务永不出现则
 * 回调永不触发——对"旧宿主少一个能力"是正确行为）。技能注册是**加性**贡献面，
 * 不参与互斥优先链，符合「async-inject 只接加性面」的既有纪律。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createScoped } from './logger.ts';

const log = createScoped('anic:skill-registration');

/** 注册输入：解析后的 frontmatter + 正文。 */
export interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
  whenToUse?: string;
  body: string;
}

/**
 * 解析 SKILL.md frontmatter（name/description/whenToUse）。
 *
 * 只支持实际用到的两种 YAML 形态：单行 `key: value` 与 `>` 折叠块
 * （缩进续行拼接为单空格——SKILL.md 的多行 description 用的是折叠块）。
 * 其他形态（| 字面块、引号、锚点）不支持：解析不出 name/description 时
 * 调用方跳过注册（fail-closed），不猜。
 */
export function parseSkillFrontmatter(md: string): ParsedSkillFrontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m || typeof m[1] !== 'string') return { body: md };
  const raw = m[1];
  const out: ParsedSkillFrontmatter = { body: md.slice(m[0].length) };
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[i] as string);
    if (!kv) { i += 1; continue; }
    const key = kv[1] as string;
    const inline = (kv[2] as string).trim();
    if (inline === '>' || inline === '|') {
      // 块标量：收集后续更缩进行（或空行），折叠为单空格拼接。
      const parts: string[] = [];
      i += 1;
      while (i < lines.length && (/^\s+\S/.test(lines[i] as string) || (lines[i] as string).trim() === '')) {
        const t = (lines[i] as string).trim();
        if (t) parts.push(t);
        i += 1;
      }
      const value = parts.join(' ').trim();
      if (key === 'name' || key === 'description' || key === 'whenToUse') out[key] = value;
      continue;
    }
    if (inline) {
      const value = inline.replace(/^["']|["']$/g, '');
      if (key === 'name' || key === 'description' || key === 'whenToUse') out[key] = value;
    }
    i += 1;
  }
  return out;
}

/** 技能目录（dist 相对推导：dist/host.js → ../assets/skill/，与 agents.ts 同形态）。 */
function defaultSkillDir(): string {
  try { return fileURLToPath(new URL('../assets/skill/', import.meta.url)); } catch { return ''; }
}

/** 最小 skills 槽位类型（宿主 ctx unknown 的房屋风格：本地窄化）。 */
interface SkillsCapableCtx {
  skills?: { register?: (skill: Record<string, unknown>) => () => void };
  effect?: (fn: () => unknown, label?: string) => unknown;
}

/**
 * 注册 runtime skill。返回 disposer（宿主提供时）或 null（跳过）。
 *
 * @param ctx 宿主上下文（需已具备 skills 服务——由 ctx.inject 保证时序）
 * @param skillDir 技能目录（默认 dist 相对推导；测试可注入）
 */
export function registerRuntimeSkill(ctx: unknown, skillDir = defaultSkillDir()): (() => void) | null {
  const c = ctx as SkillsCapableCtx;
  if (!c.skills || typeof c.skills.register !== 'function') {
    log.info('宿主无 skills 服务，runtime 技能注册跳过（多代防御）');
    return null;
  }
  let md = '';
  try {
    md = readFileSync(`${skillDir.replace(/[\\/]+$/, '')}/SKILL.md`, 'utf-8');
  } catch (e) {
    log.warn(`SKILL.md 读取失败，runtime 技能注册跳过：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const parsed = parseSkillFrontmatter(md);
  if (!parsed.name || !parsed.description) {
    log.warn('SKILL.md frontmatter 缺 name/description，runtime 技能注册跳过（fail-closed）');
    return null;
  }
  const disposer = c.skills.register({
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
    source: 'runtime',
    content: parsed.body,
    // resourceBase：让官方 skill 工具渲染相对资源引导（scripts/references/）。
    resourceBase: { kind: 'directory', path: skillDir },
  });
  log.info(`runtime 技能已注册：${parsed.name}`);
  return typeof disposer === 'function' ? disposer : null;
}

/*
 * 历史注记（cycle-97，删除即失忆故留档）：曾用 ctx.inject(['skills'], cb) 动态挂载，
 * 真实宿主（cordis 4.0.4）里嵌套插件纤维从未激活（服务在场、回调不跑、无错误）；
 * 官方消费方 dsh-skill-badge 一律用静态 `const inject = ["skills"]`。接线已改为
 * 入口静态 inject + apply 内直接注册（见 src/index.ts 文件头）。不再保留
 * wireRuntimeSkillRegistration —— 死防御层与"永不执行的分支"同罪。
 */
