import { localDate } from "../domain/time";
import { processTerm, tokenize } from "./text";

/**
 * Runs: identical or near-identical lots closing one after another in the same sale.
 * Prices move along a run. On Fri 6 Nov the early OptiPlex 7060s went for ~$50 and the late
 * ones for $70–80, as people who lost early lots moved to the few that were left. Knowing a
 * lot's position in its run is the first step to pricing it well.
 */

/** Words that describe a form factor or packaging rather than which model it is. */
const GENERIC = new Set([
  "desktop",
  "computer",
  "pc",
  "unit",
  "series",
  "model",
  "form",
  "factor",
  "tower",
  "compact",
  "used",
  "new",
  "pair",
  "set",
  "lot",
  "assorted",
]);

/**
 * A key identifying "the same kind of thing": the model number and the word before it
 * ("optiplex 7060", "catalyst 2960", "thinkcentre m73"), or the first three meaningful words
 * when there is no model number ("tp link omada").
 */
export function runKey(title: string): string {
  const words = tokenize(title)
    .map(processTerm)
    .filter((t): t is string => !!t && !GENERIC.has(t));
  const i = words.findIndex((w) => /\d/.test(w) && /[a-z]?\d{2,}/.test(w));
  if (i >= 0) return [words[i - 1], words[i]].filter(Boolean).join(" ");
  return words.slice(0, 3).join(" ");
}

export interface RunInfo {
  key: string;
  /** 1-based position by closing time */
  position: number;
  size: number;
  /** how many in the run close after this one */
  after: number;
}

/** Group lots into runs (same key, closing the same day in Harare) and give each its position. */
export function computeRuns<
  T extends { id: number; title: string; endAt: string | null },
>(docs: T[], tz?: string): Map<number, RunInfo> {
  const groups = new Map<string, T[]>();
  for (const d of docs) {
    if (!d.endAt) continue;
    const k = `${runKey(d.title)}|${localDate(new Date(d.endAt), tz)}`;
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  const out = new Map<number, RunInfo>();
  for (const [k, g] of groups) {
    if (g.length < 3) continue;
    g.sort(
      (a, b) =>
        Date.parse(a.endAt as string) - Date.parse(b.endAt as string) ||
        a.id - b.id,
    );
    const key = k.split("|")[0];
    g.forEach((d, i) => {
      out.set(d.id, {
        key,
        position: i + 1,
        size: g.length,
        after: g.length - i - 1,
      });
    });
  }
  return out;
}
