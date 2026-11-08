"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useState } from "react";
import { AssistantChatProvider } from "./assistant/chat-provider";
import { CatalogueProvider } from "./catalogue/catalogue-provider";
import { LiveProvider } from "./live/live-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 2 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <NuqsAdapter>
        <CatalogueProvider>
          <LiveProvider>
            <AssistantChatProvider>{children}</AssistantChatProvider>
          </LiveProvider>
        </CatalogueProvider>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
