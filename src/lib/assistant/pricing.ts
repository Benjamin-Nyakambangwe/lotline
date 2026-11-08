/**
 * What a Claude call costs, in millionths of a US dollar (micros), from its usage. Each
 * iteration is priced at the rates of the model that ran it (a refusal fallback can run on a
 * different model). Unknown models are priced at the highest Opus rates, so caps err on the
 * safe side.
 */

export const ASSISTANT_MODEL = "claude-opus-5-5";

/** USD per million tokens. */
interface Rates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const RATES: Record<string, Rates> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};
const FALLBACK_RATES: Rates = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
};

export interface TokenCounts {
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

/** Usage as the API reports it; `iterations` lists each model run when there was more than one. */
export interface UsageLike extends TokenCounts {
  iterations?: (Partial<TokenCounts> & { type?: string })[] | null;
}

const ratesFor = (model: string | null) =>
  (model && RATES[model]) || FALLBACK_RATES;

/** Tokens × rate ($/MTok) = micros, since 1 token at $1/MTok is exactly 1 micro. */
function priceOne(u: Partial<TokenCounts>, model: string | null): number {
  const r = ratesFor(u.model ?? model);
  return Math.ceil(
    (u.input_tokens ?? 0) * r.input +
      (u.output_tokens ?? 0) * r.output +
      (u.cache_creation_input_tokens ?? 0) * r.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * r.cacheRead,
  );
}

export function costMicros(usage: UsageLike): number {
  const its = (usage.iterations ?? []).filter(
    (i) => i.type === undefined || /message/.test(i.type),
  );
  if (its.length) return its.reduce((s, i) => s + priceOne(i, usage.model), 0);
  return priceOne(usage, usage.model);
}

export const microsToCents = (m: number) => m / 10_000;
