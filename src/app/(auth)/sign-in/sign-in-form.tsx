"use client";

import { MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, safeNext } from "@/lib/auth-client";

/**
 * Open a pasted Lotline sign-in or invite link here. The iPhone Home Screen app has no address
 * bar and its own cookies, so this is how it gets signed in. Only this site's own links.
 */
function PasteLink() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const u = new URL(value.trim(), window.location.origin);
          const ok =
            u.origin === window.location.origin &&
            (u.pathname === "/api/auth/magic-link/verify" ||
              u.pathname.startsWith("/invite/"));
          if (!ok) throw new Error("not ours");
          window.location.assign(u.pathname + u.search);
        } catch {
          setError("That isn't a Lotline sign-in or invite link.");
        }
      }}
      className="mt-6 grid gap-1.5 border-t pt-5"
    >
      <Label htmlFor="paste-link" className="text-muted-foreground">
        Have a sign-in or invite link? Paste it here
      </Label>
      <div className="flex gap-2">
        <Input
          id="paste-link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          autoComplete="off"
          className="h-11"
        />
        <Button
          type="submit"
          variant="outline"
          className="h-11"
          disabled={!value.trim()}
        >
          Open
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

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
          Check{" "}
          {mode === "console"
            ? "the server terminal"
            : mode === "link-copy"
              ? "the server logs"
              : "your email"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "console"
            ? "In development, the sign-in link is printed in the terminal running the app."
            : mode === "link-copy"
              ? "If this is the owner's email, the sign-in link is in the web service's logs. It works once and expires in 15 minutes."
              : "If this email has access to Lotline, a sign-in link is on its way. It works once and expires in 15 minutes."}
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => setSent(false)}>
          Use a different email
        </Button>
        <PasteLink />
      </div>
    );
  }

  return (
    <>
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "link-copy"
              ? "Lotline is invite-only: open the invite link you were sent, or ask the owner for a fresh one. Owner: enter your email and your sign-in link appears in the server logs."
              : "Lotline is invite-only. Enter the email you were invited with and we'll send you a sign-in link."}
          </p>
        </div>
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
      </form>
      <PasteLink />
    </>
  );
}
