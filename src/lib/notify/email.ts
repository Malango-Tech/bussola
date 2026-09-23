import { env } from "@/lib/env";

/**
 * Sending email, for alerts and invitations.
 *
 * Deliberately over HTTP rather than SMTP: SMTP would mean a dependency, a
 * connection pool and a class of failure (blocked port 25, STARTTLS
 * negotiation) that is miserable to debug on someone else's server. A single
 * `fetch` to a provider that already has to work for the app's own users is
 * less machinery and fails in ways the error message can explain.
 *
 * Nothing here is configured by default, and that is on purpose. A
 * self-hosted install that has not set a key gets `configured: false` and a
 * sentence saying which variables to set — never a silent no-op, because an
 * alert that quietly does not send is worse than one that was never offered.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text. Every message here is short enough not to need HTML. */
  text: string;
};

export type EmailResult =
  | { ok: true; provider: string }
  | { ok: false; error: string };

export type EmailConfig = {
  provider: "resend" | "postmark";
  apiKey: string;
  from: string;
};

/**
 * How to send, from the environment.
 *
 * `BUSSOLA_EMAIL_FROM` is required alongside the key rather than defaulted:
 * every provider rejects a From address on an unverified domain, and guessing
 * one produces a 4xx that reads as a bug in Bussola rather than as missing
 * configuration.
 */
export function emailConfig(): EmailConfig | null {
  const {
    BUSSOLA_EMAIL_FROM: from,
    BUSSOLA_RESEND_API_KEY: resend,
    BUSSOLA_POSTMARK_TOKEN: postmark,
  } = env();
  if (!from) return null;

  if (resend) return { provider: "resend", apiKey: resend, from };
  if (postmark) return { provider: "postmark", apiKey: postmark, from };

  return null;
}

export function emailConfigured(): boolean {
  return emailConfig() !== null;
}

/** The one sentence to show wherever email is offered but not set up. */
export const EMAIL_SETUP_HINT =
  "Email is not configured. Set BUSSOLA_EMAIL_FROM and BUSSOLA_RESEND_API_KEY (or BUSSOLA_POSTMARK_TOKEN).";

const TIMEOUT_MS = 10_000;

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const config = emailConfig();
  if (!config) return { ok: false, error: EMAIL_SETUP_HINT };

  try {
    const response =
      config.provider === "resend"
        ? await postJson(
            "https://api.resend.com/emails",
            { Authorization: `Bearer ${config.apiKey}` },
            {
              from: config.from,
              to: [message.to],
              subject: message.subject,
              text: message.text,
            },
          )
        : await postJson(
            "https://api.postmarkapp.com/email",
            { "X-Postmark-Server-Token": config.apiKey },
            {
              From: config.from,
              To: message.to,
              Subject: message.subject,
              TextBody: message.text,
              MessageStream: "outbound",
            },
          );

    if (!response.ok) {
      return {
        ok: false,
        error: `${config.provider} rejected the message (${response.status}). ${response.body}`.trim(),
      };
    }

    return { ok: true, provider: config.provider };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "The email provider did not respond in time."
          : `Could not reach the email provider: ${
              error instanceof Error ? error.message : String(error)
            }`,
    };
  }
}

/**
 * POST JSON with a timeout, returning the body as text.
 *
 * The body is read on failure and kept short: providers explain a rejected
 * From address or a revoked key in it, and dropping it turns a fixable
 * misconfiguration into "delivery failed".
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.ok) return { ok: true, status: response.status, body: "" };

  const text = await response.text().catch(() => "");
  return { ok: false, status: response.status, body: text.slice(0, 300) };
}
