"use client";

import {
  ArrowRight,
  FolderKanban,
  LayoutDashboard,
  LineChart,
  Radio,
  Search,
  Trophy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { formatMoney } from "@/lib/domain/money";
import { useCatalogue } from "../catalogue/catalogue-provider";
import { Countdown, Highlight, LotThumb } from "../lot/bits";

/** Open the palette from anywhere: ⌘K / Ctrl+K, or any element that dispatches this event. */
export const openCommandMenu = () =>
  window.dispatchEvent(new Event("lotline:command"));

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("lotline:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lotline:command", onOpen);
    };
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Lotline"
      description="Search lots or jump to a page"
      className="sm:max-w-2xl"
    >
      {open && <Body onDone={() => setOpen(false)} />}
    </CommandDialog>
  );
}

const PAGES = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/watchlist", label: "Watchlist", icon: Radio },
  { href: "/browse", label: "Browse all lots", icon: Search },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/won", label: "Won", icon: Trophy },
  { href: "/insights", label: "Insights", icon: LineChart },
];

function Body({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { engine, loading } = useCatalogue();
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const res = useMemo(
    () =>
      engine && query.trim() ? engine.search({ q: query, limit: 8 }) : null,
    [engine, query],
  );
  // cmdk doesn't move its highlight when we filter ourselves: keep the top result selected.
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!res) setSelected("");
    else if (res.jump) setSelected(`jump-${res.jump.id}`);
    else if (res.hits[0]) setSelected(`lot-${res.hits[0].doc.id}`);
  }, [res]);

  const openLot = (id: number) => {
    onDone();
    void setLot(id);
  };
  const go = (href: string) => {
    onDone();
    router.push(href);
  };

  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
    >
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder="Search lots, paste an ABC link or lot number…"
      />
      <CommandList className="max-h-[min(60dvh,480px)]">
        {query.trim() && !res && (
          <div className="p-4 text-sm text-muted-foreground">
            {loading ? "Loading the catalogue…" : "…"}
          </div>
        )}
        {res && res.total === 0 && (
          <CommandEmpty>No lots match “{query}”.</CommandEmpty>
        )}
        {res?.jump && (
          <CommandGroup heading="Go to lot">
            <CommandItem
              value={`jump-${res.jump.id}`}
              onSelect={() => openLot(res.jump?.id ?? 0)}
            >
              <ArrowRight className="text-primary" />
              <span className="truncate">{res.jump.title}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {res.jump.id}
              </span>
            </CommandItem>
          </CommandGroup>
        )}
        {res && res.hits.length > 0 && (
          <CommandGroup
            heading={`Lots · ${res.total.toLocaleString()} match${res.total === 1 ? "" : "es"}`}
          >
            {res.hits.map((h) => (
              <CommandItem
                key={h.doc.id}
                value={`lot-${h.doc.id}`}
                onSelect={() => openLot(h.doc.id)}
                className="gap-3 py-2"
              >
                <LotThumb src={h.doc.thumbUrl} alt="" size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    <Highlight title={h.doc.title} matched={h.matched} />
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(h.doc.currentBid ?? h.doc.startingBid)} ·{" "}
                    {h.doc.location}
                  </span>
                </span>
                <Countdown endAt={h.doc.endAt} className="text-xs" />
              </CommandItem>
            ))}
            {res.total > res.hits.length && (
              <CommandItem
                value="see-all"
                onSelect={() => go(`/browse?q=${encodeURIComponent(query)}`)}
              >
                <Search />
                See all {res.total.toLocaleString()} results
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {!query.trim() && (
          <CommandGroup heading="Go to">
            {PAGES.map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={href} onSelect={() => go(href)}>
                <Icon />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
