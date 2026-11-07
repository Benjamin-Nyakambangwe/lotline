"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useState } from "react";
import { CatalogueProvider } from "./catalogue/catalogue-provider";

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
        <CatalogueProvider>{children}</CatalogueProvider>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
