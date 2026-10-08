/**
 * Random UUIDs without assuming a browser. React Native's Hermes engine has no global `crypto.randomUUID()`, so calling it would
 * crash every write. The app wires the platform's secure random source once at start-up (`configureRandomBytes`); tests and Node
 * use `globalThis.crypto`. It never falls back to Math.random: if no secure source exists it throws loudly instead of making guessable ids.
 */
export type RandomBytes = (array: Uint8Array) => Uint8Array;
let source: RandomBytes | null = null;
export function configureRandomBytes(fn: RandomBytes | null) { source = fn; }

function fill(arr: Uint8Array): Uint8Array {
  if (source) { source(arr); return arr; }
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) { c.getRandomValues(arr); return arr; }
  throw new Error('No secure random source configured (call configureRandomBytes at app start)');
}
const hex = (n: number) => n.toString(16).padStart(2, '0');
/** RFC 4122 version 4 UUID. */
export function newId(): string {
  const b = fill(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
