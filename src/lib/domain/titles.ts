/**
 * Title normalisation and attribute extraction for search and market comparables.
 * The CPU rules are ported from the homelab poller (serve.py `cpu_of`).
 */

/** Lowercase, strip HTML and punctuation noise, collapse whitespace. Keeps part numbers. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^\p{L}\p{N}\s\-./+#]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LotAttrs {
  cpu?: string;
  cpuTier?: string;
  cpuGen?: string;
  ramGb?: number;
  storage?: string;
  models: string[];
}

/** "i5 · 9th gen" style CPU description from listing text (title + description). */
export function cpuOf(text: string): string {
  const chips = new Set<string>();
  for (const m of text.matchAll(/\b(i[3579])\b|core\s*i?([3579])\b/gi)) {
    chips.add((m[1] ?? `i${m[2]}`).toLowerCase());
  }
  const gens = [
    ...new Set(
      [...text.matchAll(/(\d{1,2}(?:st|nd|rd|th))\s*gen/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  let out = [...chips].sort().join("/");
  if (gens.length) out += `${out ? " · " : ""}${gens.join("/")} gen`;
  return out;
}

export function extractAttrs(title: string, description = ""): LotAttrs {
  const text = `${title} ${description.replace(/<[^>]+>/g, " ")}`;
  const attrs: LotAttrs = { models: [] };
  const cpu = cpuOf(text);
  if (cpu) {
    attrs.cpu = cpu;
    attrs.cpuTier = cpu.split(" · ")[0] || undefined;
    attrs.cpuGen = /(\d{1,2})(?:st|nd|rd|th) gen/.exec(cpu)?.[1];
  }
  const ram = /(\d{1,3})\s*gb\s*(?:ddr\d\s*)?(?:ram|memory)/i.exec(text);
  if (ram) attrs.ramGb = Number(ram[1]);
  const storage = /(\d{1,4})\s*(gb|tb)\s*(ssd|hdd|nvme|m\.2)/i.exec(text);
  if (storage)
    attrs.storage = `${storage[1]} ${storage[2].toUpperCase()} ${storage[3].toUpperCase()}`;
  // Model tokens: 3–5 digit numbers with an optional letter suffix (7070, 2960, 899G, 4221).
  attrs.models = [
    ...new Set(
      [...title.matchAll(/\b(\d{3,5}[a-z]?)\b/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ].filter(
    (t) =>
      !/^(19|20)\d\d$/.test(t) || title.toLowerCase().includes(`optiplex ${t}`),
  );
  return attrs;
}

/** Parse "3 units", "Set of 8", "2" → a number of units (default 1). */
export function quantityOf(q: string | null | undefined): number {
  if (!q) return 1;
  const m = /(\d+)/.exec(q);
  const n = m ? Number(m[1]) : 1;
  return n > 0 && n < 10_000 ? n : 1;
}
