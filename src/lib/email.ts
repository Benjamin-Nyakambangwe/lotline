/** Minimal Resend sender (no SDK). Only used when AUTH_EMAIL_MODE=resend. */
export async function sendEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}`);
}
