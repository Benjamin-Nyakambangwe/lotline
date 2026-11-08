import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { BidderSettings } from "@/components/push/bidder-settings";
import { PushSettings } from "@/components/push/push-settings";
import { requireUser } from "@/server/dal";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-20 rounded-2xl border bg-card p-5"
    >
      <h2 id={`${id}-h`} className="mb-3 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

async function Settings() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Settings"
        description="Alerts on your devices and your ABC bidder link."
      />
      <div className="flex flex-col gap-4">
        <Section id="alerts" title="Alerts on this device">
          <PushSettings />
        </Section>
        <Section id="bidder" title="Your ABC bidder number">
          <BidderSettings />
        </Section>
        <Section id="install" title="Install Lotline">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">iPhone:</strong> in Safari,
              Share → Add to Home Screen. Needed for alerts on iPhone.
            </li>
            <li>
              <strong className="text-foreground">Android:</strong> in Chrome, ⋮
              menu → Add to Home screen (or Install app).
            </li>
            <li>
              <strong className="text-foreground">Computer:</strong> Chrome or
              Edge show an install icon in the address bar.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
