import { getAuth } from "@/server/auth";
import { projectDetail } from "@/server/projects";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything that needs it; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const money = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

/** A project as a spreadsheet: one row per candidate lot, with your max and its all-in. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/projects/[id]/csv">,
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id))
    return new Response("not found", { status: 404 });
  const d = await projectDetail(session.user.id, id);
  if (!d) return new Response("not found", { status: 404 });
  const rows = [
    [
      "Need",
      "Quantity",
      "Rank",
      "Lot",
      "Title",
      "Auction",
      "Status",
      "Current bid",
      "Next bid",
      "Your max",
      "All-in at max",
      "Closes",
      "In worst case",
      "Link",
    ],
    ...d.view.needs.flatMap((n) =>
      n.candidates.map((c) => [
        n.title,
        n.quantity,
        c.rank,
        c.lotId,
        c.title,
        c.auction,
        c.state === "skipped" ? "skipped" : c.status,
        money(c.currentBid),
        money(c.nextBid),
        money(c.max),
        money(c.allInAtMax),
        c.endAt,
        c.planned ? "yes" : "",
        `https://app.abcauctions.co.zw/home(dialog:lot/${c.type}/${c.lotId})`,
      ]),
    ),
  ];
  const csv = `${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`;
  const name =
    d.project.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "project";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lotline-${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
