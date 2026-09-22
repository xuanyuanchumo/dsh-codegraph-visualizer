export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unreachable: unexpected value ${JSON.stringify(value)}`);
}