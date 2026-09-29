import type { Rng } from "./types";

/** mulberry32: small, fast, and fully reproducible from a 32-bit seed. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [low, high], inclusive. */
export function int(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick() needs a non-empty list");
  return item;
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** `count` distinct integers from [low, high]. */
export function distinctInts(rng: Rng, count: number, low: number, high: number): number[] {
  const values = new Set<number>();
  while (values.size < count) values.add(int(rng, low, high));
  return [...values];
}

export function freshSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}
