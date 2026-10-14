/**
 * Adapter 层 — 外部服务隔离（Q5 架构约束）。
 *
 * 所有外部依赖（文件系统、子进程、网络 fetch）经此层抽象，
 * 便于测试注入 mock，且防止业务逻辑直接耦合宿主 API。
 *
 * INV-25：配置单入口；INV-26：诊断域隔离。
 */

// ── 文件系统适配 ──────────────────────────────────────────────

export interface FsAdapter {
  readText(path: string): string | null;
  readDir(path: string): string[];
  exists(path: string): boolean;
  writeText(path: string, content: string): void;
}

// ── 子进程适配 ──────────────────────────────────────────────

export interface ExecAdapter {
  run(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }): {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

// ── 网络/HTTP 适配 ──────────────────────────────────────────

export interface HttpAdapter {
  fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json: <T>() => Promise<T>;
    text: () => Promise<string>;
  }>;
}

// ── 适配器集合 ──────────────────────────────────────────────

export interface Adapters {
  fs: FsAdapter;
  exec: ExecAdapter;
  http: HttpAdapter;
}

/**
 * 创建 Node.js 原生适配器（生产用）。
 * 测试时可注入 mock 实现。
 */
export function createNodeAdapters(): Adapters {
  return {
    fs: {
      readText: (p) => {
        try {
          return nodeFs.readFileSync(p, 'utf-8');
        } catch {
          return null;
        }
      },
      readDir: (p) => {
        try {
          return nodeFs.readdirSync(p);
        } catch {
          return [];
        }
      },
      exists: (p) => {
        try {
          nodeFs.accessSync(p);
          return true;
        } catch {
          return false;
        }
      },
      writeText: (p, c) => {
        nodeFs.writeFileSync(p, c, 'utf-8');
      },
    },
    exec: (cmd, args, opts) => {
      const result = nodeChild.spawnSync(cmd, args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        encoding: 'utf-8',
      });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.status ?? -1,
      };
    },
    http: async (url, opts) => {
      const res = await nodeFetch(url, {
        method: opts?.method ?? 'GET',
        headers: opts?.headers,
        body: opts?.body,
      });
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
        text: () => res.text(),
      };
    },
  };
}

// ── Node 内部导入（延迟绑定，便于测试 mock） ────────────────

import * as nodeFs from 'node:fs';
import * as nodeChild from 'node:child_process';
// fetch is global in Node 22+
const nodeFetch = globalThis.fetch;
