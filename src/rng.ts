export type RngSnapshot = { state: number };

export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SeededRng {
  private value: number;

  constructor(seedOrState: string | number) {
    const state = typeof seedOrState === "string" ? hashSeed(seedOrState) : seedOrState;
    this.value = state >>> 0;
  }

  next(): number {
    this.value = (this.value + 0x6d2b79f5) >>> 0;
    let t = this.value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      throw new Error(`Invalid integer range ${min}..${maxExclusive}`);
    }
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot pick from an empty list");
    return items[this.int(0, items.length)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  snapshot(): RngSnapshot {
    return { state: this.value >>> 0 };
  }
}

export function randomSeed(): string {
  const cryptoRef = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  const value = cryptoRef?.getRandomValues
    ? cryptoRef.getRandomValues(new Uint32Array(1))[0]
    : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return value.toString(36).toUpperCase().padStart(7, "0");
}
