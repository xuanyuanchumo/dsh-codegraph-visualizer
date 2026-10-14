/**
 * Self-bootstrap state machine.
 * dsh-anic evaluates itself using the skill's scripts.
 * Constraint: never self-modify code — only produce tech-debt proposals (R-31).
 */

import { join } from 'node:path';
import { atomicWriteFileSync, safeReadFileSync } from '../shared/fs-safe.ts';

export type BootstrapStatus =
  | 'IDLE'
  | 'EVALUATING'
  | 'GATE_CHECKING'
  | 'FIXING'
  | 'VERIFYING'
  | 'CONVERGED'
  | 'EXHAUSTED';

export interface BootstrapHistoryEntry {
  round: number;
  evalScore: number;
  gateVerdict: string;
  fixApplied: string | null;
  timestamp: string;
}

export interface BootstrapState {
  status: BootstrapStatus;
  round: number;
  maxRounds: number;
  lastEvalScore: number | null;
  lastGateVerdict: string | null;
  history: BootstrapHistoryEntry[];
}

const STATE_FILE = 'self-bootstrap.json';

export function initialBootstrapState(maxRounds = 3): BootstrapState {
  return {
    status: 'IDLE',
    round: 0,
    maxRounds,
    lastEvalScore: null,
    lastGateVerdict: null,
    history: [],
  };
}

export function loadBootstrapState(cyclesDir: string): BootstrapState {
  const file = join(cyclesDir, STATE_FILE);
  const raw = safeReadFileSync(file);
  if (!raw) return initialBootstrapState();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.status === 'string' && typeof parsed.round === 'number') {
      return parsed as BootstrapState;
    }
  } catch { /* corrupt → reset */ }
  return initialBootstrapState();
}

export function saveBootstrapState(cyclesDir: string, state: BootstrapState): void {
  const file = join(cyclesDir, STATE_FILE);
  atomicWriteFileSync(file, JSON.stringify(state, null, 2));
}

export function advanceBootstrap(
  state: BootstrapState,
  evalScore: number,
  gateVerdict: string,
  fixApplied: string | null,
): BootstrapState {
  const entry: BootstrapHistoryEntry = {
    round: state.round + 1,
    evalScore,
    gateVerdict,
    fixApplied,
    timestamp: new Date().toISOString(),
  };

  const newRound = state.round + 1;
  let newStatus: BootstrapStatus;

  if (gateVerdict === 'PASS' || gateVerdict === 'approve') {
    newStatus = 'CONVERGED';
  } else if (newRound >= state.maxRounds) {
    newStatus = 'EXHAUSTED';
  } else {
    newStatus = 'FIXING';
  }

  return {
    status: newStatus,
    round: newRound,
    maxRounds: state.maxRounds,
    lastEvalScore: evalScore,
    lastGateVerdict: gateVerdict,
    history: [...state.history, entry],
  };
}
