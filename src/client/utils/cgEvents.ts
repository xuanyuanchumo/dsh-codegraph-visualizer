import { DOM_EVENTS } from '../../shared/domEvents.ts';

export { DOM_EVENTS };

export function dispatchCgEvent(eventName: string, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}