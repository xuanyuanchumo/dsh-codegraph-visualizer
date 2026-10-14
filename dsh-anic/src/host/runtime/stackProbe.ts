/**
 * 多栈项目探测（F3，M2-a）。
 *
 * 检测工作区技术栈并生成合适的 .cycles/config.yml 骨架。
 * 支持：Node.js / Rust(Cargo) / Python / Go / 通用。
 * 全代码库禁 Node/npm 假设：探测失败不报错，回退 generic。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type StackType = 'node' | 'cargo' | 'python' | 'go' | 'generic';

export interface StackProbeResult {
  type: StackType;
  config: {
    build_cmd: string;
    test_cmd: string;
    lint_cmd: string;
    autonomy_level: string;
  };
  detected: string[];
}

/** 探测工作区技术栈。 */
export function probeStack(workspaceRoot: string): StackProbeResult {
  const detected: string[] = [];

  // Node.js
  if (existsSync(join(workspaceRoot, 'package.json'))) {
    detected.push('package.json');
    return { type: 'node', config: makeNodeConfig(workspaceRoot), detected };
  }

  // Rust / Cargo
  if (existsSync(join(workspaceRoot, 'Cargo.toml'))) {
    detected.push('Cargo.toml');
    return { type: 'cargo', config: makeCargoConfig(), detected };
  }

  // Python
  for (const f of ['pyproject.toml', 'setup.py', 'requirements.txt']) {
    if (existsSync(join(workspaceRoot, f))) {
      detected.push(f);
      return { type: 'python', config: makePythonConfig(), detected };
    }
  }

  // Go
  if (existsSync(join(workspaceRoot, 'go.mod'))) {
    detected.push('go.mod');
    return { type: 'go', config: makeGoConfig(), detected };
  }

  return { type: 'generic', config: makeGenericConfig(), detected };
}

function makeNodeConfig(root: string): StackProbeResult['config'] {
  // 读 package.json scripts 推断命令
  let buildCmd = 'npm run build';
  let testCmd = 'npm test';
  let lintCmd = 'npm run lint';
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    const scripts = pkg?.scripts ?? {};
    if (scripts.build) buildCmd = `npm run build`;
    if (scripts.test) testCmd = `npm test`;
    if (scripts.lint) lintCmd = `npm run lint`;
    if (scripts.typecheck && !scripts.lint) lintCmd = `npm run typecheck`;
  } catch { /* 回退默认 */ }
  return { build_cmd: buildCmd, test_cmd: testCmd, lint_cmd: lintCmd, autonomy_level: 'L2' };
}

function makeCargoConfig(): StackProbeResult['config'] {
  return { build_cmd: 'cargo build', test_cmd: 'cargo test', lint_cmd: 'cargo clippy', autonomy_level: 'L2' };
}

function makePythonConfig(): StackProbeResult['config'] {
  return { build_cmd: 'pip install -e .', test_cmd: 'pytest', lint_cmd: 'ruff check .', autonomy_level: 'L2' };
}

function makeGoConfig(): StackProbeResult['config'] {
  return { build_cmd: 'go build ./...', test_cmd: 'go test ./...', lint_cmd: 'golangci-lint run', autonomy_level: 'L2' };
}

function makeGenericConfig(): StackProbeResult['config'] {
  return { build_cmd: 'echo no build', test_cmd: 'echo no test', lint_cmd: 'echo no lint', autonomy_level: 'L1' };
}

/** 生成 config.yml 文本。 */
export function configToYaml(config: StackProbeResult['config']): string {
  return [
    `build_cmd: "${config.build_cmd}"`,
    `test_cmd: "${config.test_cmd}"`,
    `lint_cmd: "${config.lint_cmd}"`,
    `autonomy_level: ${config.autonomy_level}`,
  ].join('\n');
}
