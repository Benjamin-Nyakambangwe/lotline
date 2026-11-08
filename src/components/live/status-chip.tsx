import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Eye,
  Flag,
  Hourglass,
  type LucideIcon,
  Trophy,
} from "lucide-react";
import { type MyStatus, STATUS_LABEL } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

const STYLE: Record<MyStatus, { icon: LucideIcon; cls: string }> = {
  watching: { icon: Eye, cls: "bg-muted text-muted-foreground" },
  winning: { icon: CircleCheck, cls: "bg-win-bg text-win" },
  outbid: { icon: CircleAlert, cls: "bg-outbid-bg text-outbid" },
  closing: { icon: Hourglass, cls: "bg-closing-bg text-closing" },
  won: { icon: Trophy, cls: "bg-win-bg text-win" },
  lost: { icon: CircleX, cls: "bg-muted text-muted-foreground" },
  passed: { icon: CircleMinus, cls: "bg-muted text-muted-foreground" },
  ended: { icon: Flag, cls: "bg-muted text-muted-foreground" },
};

/** My status on a lot: always an icon and a word, never colour alone. */
export function StatusChip({
  status,
  confidence,
  provisional = null,
  className,
}: {
  status: MyStatus;
  confidence: "exact" | "estimate";
  provisional?: "winning" | "outbid" | null;
  className?: string;
}) {
  const { icon: Icon, cls } = STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        cls,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {STATUS_LABEL[status]}
      {status === "closing" && provisional && (
        <span className="font-normal">
          ({provisional === "winning" ? "you lead" : "outbid"})
        </span>
      )}
      {confidence === "estimate" && status !== "watching" && (
        <span
          className="font-normal opacity-75"
          title="From the bid you entered; link your ABC bidder ID for exact status"
        >
          est.
        </span>
      )}
    </span>
  );
}

/** The colour of a row's status rail. */
export const railOf = (status: MyStatus) =>
  status === "winning" || status === "won"
    ? "bg-win"
    : status === "outbid"
      ? "bg-outbid"
      : status === "closing"
        ? "bg-closing"
        : "bg-border";
