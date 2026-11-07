import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

function emailMode(): "console" | "link-copy" | "resend" {
  const m = process.env.AUTH_EMAIL_MODE;
  return m === "link-copy" || m === "resend" ? m : "console";
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" />}>
      <SignInForm mode={emailMode()} />
    </Suspense>
  );
}
