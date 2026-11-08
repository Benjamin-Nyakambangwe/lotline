import "server-only";
import { nextCookies } from "better-auth/next-js";
import { type Auth, createAuth } from "@/lib/auth/config";
import { sendEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env";
import { getDb } from "./db";

let instance: Auth | undefined;

export function getAuth(): Auth {
  if (instance) return instance;
  const env = serverEnv();
  const production = process.env.NODE_ENV === "production";
  instance = createAuth({
    db: getDb(),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? env.APP_URL,
    ownerEmail: env.OWNER_EMAIL,
    extraPlugins: [nextCookies()],
    log: (m) => console.log(`[auth] ${m}`),
    deliver: async ({ email, url }) => {
      if (
        env.AUTH_EMAIL_MODE === "resend" &&
        env.RESEND_API_KEY &&
        env.EMAIL_FROM
      ) {
        await sendEmail({
          apiKey: env.RESEND_API_KEY,
          from: env.EMAIL_FROM,
          to: email,
          subject: "Your Lotline sign-in link",
          text: `Sign in to Lotline:\n\n${url}\n\nThis link works once and expires in 15 minutes.`,
        });
        return;
      }
      if (
        env.AUTH_EMAIL_MODE === "link-copy" &&
        email.toLowerCase() === env.OWNER_EMAIL?.toLowerCase()
      ) {
        // No email service: the owner's own sign-in link goes to the server logs, which only
        // the people running the app can read. Everyone else joins through invite links.
        console.log(
          `[auth] owner sign-in link (works once, expires in 15 minutes): ${url}`,
        );
        return;
      }
      if (env.AUTH_EMAIL_MODE === "console" && !production) {
        // Development only: the link appears in the terminal running `npm run dev`.
        console.log(`\n  Lotline sign-in link for ${email}:\n  ${url}\n`);
        return;
      }
      console.log(
        "[auth] sign-in link requested but email delivery is off; use an invite link from /admin/invites",
      );
    },
  });
  return instance;
}
