"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant answers as Markdown. Links are the only active content and are allow-listed: lots
 * open in the lot sheet, auctions in Browse, ABC links in a new tab. Anything else renders as
 * plain text (model output is untrusted). No raw HTML.
 */
export function AssistantMarkdown({
  text,
  onLotOpen,
}: {
  text: string;
  /** a lot link was tapped */
  onLotOpen?: () => void;
}) {
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const components: Components = {
    a: ({ href, children }) => {
      const lot = href?.match(/^\/lots\/(\d+)$/);
      if (lot)
        return (
          <a
            href={href}
            onClick={(e) => {
              // A plain tap opens the lot sheet here; modified clicks open the full page.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                return;
              e.preventDefault();
              void setLot(Number(lot[1]));
              onLotOpen?.();
            }}
            className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {children}
          </a>
        );
      if (href && /^\/browse\?auction=[^&]+$/.test(href))
        return (
          <Link
            href={href}
            className="font-medium text-primary underline decoration-primary/40 underline-offset-2"
          >
            {children}
          </Link>
        );
      if (href && /^https:\/\/app\.abcauctions\.co\.zw\//.test(href))
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2"
          >
            {children}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        );
      return <span>{children}</span>;
    },
    img: () => null,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b bg-muted/60 px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b px-2.5 py-1.5 align-top tabular-nums">
        {children}
      </td>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    p: ({ children }) => (
      <p className="my-2 first:mt-0 last:mb-0">{children}</p>
    ),
    h1: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
    h2: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
    h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
    code: ({ children }) => (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
        {children}
      </code>
    ),
  };
  return (
    <div className="text-[0.95rem] leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
