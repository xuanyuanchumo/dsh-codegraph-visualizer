/**
 * W StepTrace 四源投影（docs/anic/11 §W-1 的 M1 落地切片 · 纯函数，L5）。
 *
 * 四源 = 声明图（workflow-graph.yaml）× 节点状态（workflow-state.json）×
 * 账本裁决（gates/ledger.json）× 周期工件（cycles/cycle-N 元数据）。
 *
 * 纪律（本文件的承重约束）：
 * - INV-21/M0-④ 教训：**cycle 归属只用位置法** —— 本投影绝不从账本 detail
 *   自由文本解析 cycle；账本只按 gate 取"最近一次裁决"，不做 cycle 归属。
 * - INV-27 诚实标注：任何"推断"出来的状态必须 basis:'heuristic'；
 *   结构化来源给出的事实才是 basis:'structured'。
 * - 任一源缺失 → 该源标记 'absent'，不伪造空数据；整体仍可投影。
 * - 输入只接受 buildWorkflowSnapshot 的结构化输出 + 目录句柄，不自己读图。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type StepBasis = 'structured' | 'heuristic';

export interface TraceStep {
  nodeId: string;
  name: string;
  kind: string;
  status: StepStatus;
  basis: StepBasis;
  /** 该步状态的证据来源（四源中实际参与判定的） */
  sources: string[];
  /** 账本最近一次裁决（gate 命中时：{result,timestamp}；无则 null） */
  ledgerVerdict: { result: string; timestamp: string } | null;
  /** 已存在的周期目录（位置法枚举，不做归属推断） */
  cyclesSeen: string[];
  warnings: string[];
}

export interface StepTrace {
  generatedAt: string;
  steps: TraceStep[];
  sourceStatus: { graph: 'ok' | 'absent'; nodeState: 'ok' | 'absent'; ledger: 'ok' | 'absent' | 'unreadable'; cycleArtifacts: 'ok' | 'absent' };
  warnings: string[];
}

interface SnapshotNodeLike {
  id: string;
  label: string;
  type: string;
}

interface SnapshotLike {
  nodes: SnapshotNodeLike[];
}

/** 节点 id → 账本门键（G0..G3）：仅当 id 以 g0..g3 结尾时匹配（结构化后缀约定），
 *  其余节点返回 null —— 不做模糊猜测（M0-④ 教训：绝不从自由文本解析归属）。 */
function gateKeyOf(nodeId: string): string | null {
  const m = nodeId.match(/^(?:an-)?[a-z0-9-]*?g([0-3])$/i);
  return m?.[1] !== undefined ? `G${m[1]}` : null;
}

/** 读账本最近一次各门裁决（只按 gate 字段分组；不做 cycle 归属 —— INV-21） */
function readLatestVerdicts(cyclesDir: string, warnings: string[]): { map: Map<string, { result: string; timestamp: string }>; status: 'ok' | 'absent' | 'unreadable' } {
  const ledgerPath = join(cyclesDir, 'gates', 'ledger.json');
  if (!existsSync(ledgerPath)) return { map: new Map(), status: 'absent' };
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf-8')) as { entries?: Array<{ gate?: string; result?: string; timestamp?: string }> };
    const map = new Map<string, { result: string; timestamp: string }>();
    for (const e of parsed.entries ?? []) {
      if (typeof e.gate !== 'string') continue;
      const prev = map.get(e.gate);
      // "最近"按数组顺序（账本是只追加序列，末次出现即最近）
      map.set(e.gate, { result: String(e.result ?? 'UNKNOWN'), timestamp: String(e.timestamp ?? '') });
      if (prev) warnings.push(`ledger gate '${e.gate}' has multiple verdicts; using the last entry (append-only order)`);
    }
    return { map, status: 'ok' };
  } catch (e) {
    warnings.push(`ledger unreadable: ${e instanceof Error ? e.message : String(e)}`);
    return { map: new Map(), status: 'unreadable' };
  }
}

/** 读 workflow-state.json 的 nodeStatus（结构化字段 only） */
function readNodeStatus(cyclesDir: string, warnings: string[]): { map: Map<string, string>; status: 'ok' | 'absent' } {
  const p = join(cyclesDir, 'workflow-state.json');
  if (!existsSync(p)) return { map: new Map(), status: 'absent' };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { nodeStatus?: Record<string, string> };
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed.nodeStatus ?? {})) map.set(k, String(v));
    return { map, status: 'ok' };
  } catch (e) {
    warnings.push(`workflow-state.json unreadable: ${e instanceof Error ? e.message : String(e)}`);
    return { map: new Map(), status: 'ok' };
  }
}

/** 周期目录枚举（位置法；数值序） */
function listCycleDirs(cyclesDir: string): string[] {
  const root = join(cyclesDir, 'cycles');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => /^cycle-\d+$/.test(n))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}

const STATUS_ALIASES: Record<string, StepStatus> = {
  pending: 'pending', todo: 'pending', blocked: 'pending',
  active: 'active', in_progress: 'active', running: 'active',
  done: 'done', complete: 'done', completed: 'done',
  failed: 'failed', error: 'failed',
  skipped: 'skipped', skip: 'skipped', na: 'skipped',
};

/**
 * 构建 StepTrace（纯函数：同输入同输出；INV-18/INV-13 的投影侧兑现）。
 * @param snapshot buildWorkflowSnapshot 的结构化输出（声明图来源）
 */
export function buildStepTrace(snapshot: SnapshotLike, opts: { cyclesDir: string; now?: Date }): StepTrace {
  const { cyclesDir, now } = opts;
  const warnings: string[] = [];
  const ledger = readLatestVerdicts(cyclesDir, warnings);
  const nodeState = readNodeStatus(cyclesDir, warnings);
  const cyclesSeen = listCycleDirs(cyclesDir);

  const graphStatus: 'ok' | 'absent' = snapshot.nodes.length > 0 ? 'ok' : 'absent';
  const steps: TraceStep[] = snapshot.nodes.map((n) => {
    const sources: string[] = ['graph'];
    let status: StepStatus;
    let basis: StepBasis;

    const structured = nodeState.map.get(n.id);
    if (structured !== undefined) {
      const alias = STATUS_ALIASES[String(structured).toLowerCase()] ?? 'pending';
      status = alias;
      basis = 'structured';
      sources.push('nodeState');
      if (STATUS_ALIASES[String(structured).toLowerCase()] === undefined) {
        warnings.push(`node '${n.id}': unknown status value '${structured}' treated as pending (heuristic fallback is labeled)`);
      }
    } else {
      // 结构化状态缺失：门节点以账本裁决启发（PASS→done/FAIL→failed），并如实标注；
      // 非门节点无从推断 → pending（heuristic 标注）
      const gateKey = gateKeyOf(n.id);
      const verdict = gateKey ? ledger.map.get(gateKey) : undefined;
      if (verdict) {
        status = verdict.result === 'PASS' ? 'done' : verdict.result === 'FAIL' ? 'failed' : 'pending';
        basis = 'heuristic';
        sources.push('ledger');
        warnings.push(`node '${n.id}': status inferred from ledger verdict (heuristic:true, INV-27)`);
      } else {
        status = 'pending';
        basis = 'heuristic';
        warnings.push(`node '${n.id}': no structured status and no ledger verdict — rendered pending (heuristic:true, INV-27)`);
      }
    }

    return {
      nodeId: n.id,
      name: n.label,
      kind: n.type,
      status,
      basis,
      sources,
      ledgerVerdict: verdictOf(ledger.map, n),
      cyclesSeen,
      warnings: [],
    };
  });

  return {
    generatedAt: (now ?? new Date()).toISOString(),
    steps,
    sourceStatus: {
      graph: graphStatus,
      nodeState: nodeState.status === 'absent' ? 'absent' : 'ok',
      ledger: ledger.status,
      cycleArtifacts: cyclesSeen.length > 0 ? 'ok' : 'absent',
    },
    warnings,
  };
}

function verdictOf(map: Map<string, { result: string; timestamp: string }>, n: SnapshotNodeLike): { result: string; timestamp: string } | null {
  const gateKey = gateKeyOf(n.id);
  return gateKey ? map.get(gateKey) ?? null : null;
}
