"use client";

import { MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, safeNext } from "@/lib/auth-client";

export function SignInForm({
  mode,
}: {
  mode: "console" | "link-copy" | "resend";
}) {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: next,
      });
      if (res.error)
        setError(
          res.error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "Something went wrong. Try again.",
        );
      else setSent(true);
    });
  };

  if (sent) {
    return (
      <div className="text-center" aria-live="polite">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <MailCheck className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">
          Check {mode === "console" ? "the server terminal" : "your email"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "console"
            ? "In development, the sign-in link is printed in the terminal running the app."
            : "If this email has access to Lotline, a sign-in link is on its way. It works once and expires in 15 minutes."}
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "link-copy"
            ? "Lotline is invite-only. Open the invite link you were sent, or ask the owner for a fresh one."
            : "Lotline is invite-only. Enter the email you were invited with and we'll send you a sign-in link."}
        </p>
      </div>
      {mode !== "link-copy" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="go"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="h-11"
            disabled={pending || !email}
          >
            {pending ? "Sending…" : "Send sign-in link"}
          </Button>
        </>
      )}
    </form>
  );
}
