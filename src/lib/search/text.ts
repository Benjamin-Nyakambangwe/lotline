/**
 * Text processing shared by indexing and querying, so both sides agree on what a word is.
 * Lowercase, accents stripped, light plural stemming, a tiny stop list, and synonyms that
 * fit what ABC sells.
 */

const STOP = new Set([
  "and",
  "with",
  "of",
  "the",
  "for",
  "a",
  "an",
  "in",
  "on",
  "to",
  "x",
  "&",
]);

/** Split on anything that isn't a letter or digit ("899G-LTE" → "899g", "lte"). */
export function tokenize(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Light English plural stemming: "computers" → "computer", "batteries" → "battery". */
export function stem(t: string): string {
  if (t.length <= 3 || /\d/.test(t)) return t;
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Normalise one token; returns null for stop words. */
export function processTerm(term: string): string | null {
  const t = term.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t || STOP.has(t)) return null;
  return stem(t);
}

/** Groups of interchangeable words (after processTerm). Each word expands to its group. */
const SYNONYM_GROUPS: string[][] = [
  ["pc", "computer", "desktop"],
  ["laptop", "notebook"],
  ["tv", "television"],
  ["fridge", "refrigerator"],
  ["couch", "sofa", "lounge"],
  ["phone", "cellphone", "smartphone", "mobile"],
  ["car", "vehicle", "sedan"],
  ["bakkie", "pickup"],
  ["truck", "lorry"],
  ["generator", "genset"],
  ["cctv", "surveillance", "dvr", "nvr"],
  ["mic", "microphone"],
  ["wifi", "wireless"],
  ["monitor", "screen", "display"],
  ["tyre", "tire"],
  ["spanner", "wrench"],
  ["hoover", "vacuum"],
  ["aircon", "airconditioner"],
];

const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const g = group.map((w) => processTerm(w) ?? w);
  for (const w of g)
    SYNONYMS.set(
      w,
      g.filter((x) => x !== w),
    );
}

export const synonymsOf = (term: string): string[] => SYNONYMS.get(term) ?? [];

/** Processed query terms, in order. */
export function queryTerms(q: string): string[] {
  return tokenize(q)
    .map(processTerm)
    .filter((t): t is string => !!t);
}
