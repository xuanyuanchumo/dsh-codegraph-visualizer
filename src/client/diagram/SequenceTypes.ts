
export type ParticipantType = 'class' | 'module' | 'external' | 'instance' | 'callback' | 'self';

export interface Participant {
  id: string;
  name: string;
  type: ParticipantType;
  className?: string;
  filePath?: string;
  lifelineStart: number;
  lifelineEnd: number;
  isCreated: boolean;
  isDestroyed: boolean;
}

export type MessageType = 'sync' | 'async' | 'return' | 'create' | 'self-call' | 'destroy';

export interface SequenceMessage {
  id: string;
  sequenceNumber: number;
  source: string;
  target: string;
  methodName: string;
  arguments: string[];
  returnType?: string;
  isAsync: boolean;
  isSelfCall: boolean;
  isReturn: boolean;
  isCreate: boolean;
  fragmentId?: string;
  lineNumber: number;
}

export type FragmentType = 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical' | 'neg' | 'assert' | 'ignore' | 'consider';

export interface FragmentOperand {
  guardCondition?: string;
  startMessage: number;
  endMessage: number;
}

export interface CombinedFragment {
  id: string;
  type: FragmentType;
  condition?: string;
  loopConstraint?: string;
  startMessage: number;
  endMessage: number;
  parentId?: string;
  operands: FragmentOperand[];
}

export interface SequenceData {
  participants: Participant[];
  messages: SequenceMessage[];
  fragments: CombinedFragment[];
  entryFunctionName: string;
}
