import { describe, expect, it } from "vitest";
import {
  type CandidateInput,
  type NeedInput,
  needBudget,
  projectBudget,
} from "@/lib/domain/budget";
import { DEFAULT_RATES } from "@/lib/domain/fees";

let nextId = 1;
const cand = (o: Partial<CandidateInput>): CandidateInput => ({
  lotId: nextId++,
  rank: 1,
  state: "active",
  status: "watching",
  maxHammer: null,
  nextBid: 900,
  currentBid: 800,
  myBid: null,
  open: true,
  rates: DEFAULT_RATES,
  ...o,
});
const need = (
  o: Partial<NeedInput> & Pick<NeedInput, "candidates">,
): NeedInput => ({
  id: `n${nextId++}`,
  quantity: 1,
  slotMaxHammer: null,
  countsTowardBudget: true,
  ...o,
});

/** Friday's final homelab bid sheet (no UPS): switch, two nodes, APs, LTE router, NAS. */
function homelab(opts: { lose2960X?: boolean } = {}) {
  return [
    need({
      candidates: [
        cand({
          rank: 1,
          maxHammer: 2000,
          nextBid: 900,
          state: opts.lose2960X ? "lost" : "active",
        }), // 2960-X
        cand({ rank: 2, maxHammer: 3000, nextBid: 3000 }), // 3× 2960-L
      ],
    }),
    need({
      quantity: 2,
      slotMaxHammer: 5000,
      candidates: [
        cand({ rank: 1, nextBid: 4000 }),
        cand({ rank: 2, nextBid: 4500 }),
        cand({ rank: 3, nextBid: 3500 }),
      ],
    }),
    need({ candidates: [cand({ maxHammer: 1400, nextBid: 1000 })] }), // APs
    need({ candidates: [cand({ maxHammer: 1600, nextBid: 900 })] }), // 899G-LTE
    need({ candidates: [cand({ maxHammer: 8000, nextBid: 4500 })] }), // NAS
  ];
}

describe("project budget", () => {
  it("reproduces the Friday homelab plan: $276.49 worst case", () => {
    const b = projectBudget(30000, homelab());
    expect(b.worst).toBe(27649);
    expect(b.left).toBe(30000 - 27649);
    expect(b.flags.overBudget).toBe(false);
  });

  it("rolls forward to the 2960-L when the 2960-X is lost: $288.51", () => {
    expect(projectBudget(30000, homelab({ lose2960X: true })).worst).toBe(
      28851,
    );
  });

  it("counts winning lots at my bid and flags overcommit", () => {
    const n = need({
      quantity: 2,
      slotMaxHammer: 5000,
      candidates: [
        cand({ status: "winning", myBid: 5000, currentBid: 4500 }),
        cand({ status: "winning", myBid: 5000, currentBid: 5000 }),
        cand({ status: "winning", myBid: 6000, currentBid: 5000 }),
      ],
    });
    const b = needBudget(n);
    expect(b.leadingCount).toBe(3);
    expect(b.leading).toBe(6011 + 6011 + 7213);
    expect(b.leadingNow).toBe(5410 + 6011 + 6011);
    expect(b.flags.overcommit).toBe(true);
    expect(b.remaining).toBe(0);
  });

  it("skips backups whose next bid is over the max, and flags a shortfall", () => {
    const n = need({
      quantity: 2,
      slotMaxHammer: 5000,
      candidates: [
        cand({ rank: 1, nextBid: 6000 }),
        cand({ rank: 2, nextBid: 4000 }),
      ],
    });
    const b = needBudget(n);
    expect(b.plannedBackups).toEqual([n.candidates[1].lotId]);
    expect(b.flags.shortfall).toBe(true);
    expect(b.unfilled).toBe(6011 * 2); // one viable backup at the $50 max, plus one missing slot at the max
  });

  it("counts every win, even past the quantity", () => {
    const n = need({
      candidates: [
        cand({ status: "won", currentBid: 5000 }),
        cand({ status: "won", currentBid: 6000 }),
      ],
    });
    const b = needBudget(n);
    expect(b.won).toBe(6011 + 7213);
    expect(b.flags.overfill).toBe(true);
  });

  it("leaves optional needs out of the project total", () => {
    const optional = need({
      countsTowardBudget: false,
      candidates: [cand({ maxHammer: 1000 })],
    });
    const b = projectBudget(30000, [...homelab(), optional]);
    expect(b.worst).toBe(27649);
    expect(b.needs).toHaveLength(6);
  });

  it("flags going over budget", () => {
    expect(projectBudget(20000, homelab()).flags.overBudget).toBe(true);
  });
});
