import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon-page";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ComingSoonPage
      title="Settings"
      description="Your ABC bidder link, alerts, theme and display preferences."
      icon={<Settings />}
      emptyTitle="Settings are coming"
      emptyBody={
        <>
          Linking your ABC bidder ID makes your status exact: after you bid on a
          lot, tap “That&apos;s me” on it in Lotline. Your ID is never shown to
          anyone else.
        </>
      }
    />
  );
}
