import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isCloud, isSelfHosted } from "@/lib/edition";
import { dataDir as configuredDataDir, env } from "@/lib/env";
import { createId } from "@/lib/id";
import { logger } from "@/lib/log";
import { emailConfigured } from "@/lib/notify/email";

const log = logger("auth");

/**
 * Identity, in one place, for both editions.
 *
 * Self-hosted accepts exactly one account — the first person to reach /signup
 * claims the instance and every later attempt is refused. Cloud leaves signup
 * open. Everything else (password rules, sessions, organizations) is identical,
 * so there is one auth implementation to reason about rather than two.
 */
let authPromise: Promise<Auth> | undefined;

/**
 * The session signing key.
 *
 * Set BETTER_AUTH_SECRET and it is used as-is; cloud refuses to start without
 * it. A self-hosted install with nothing configured gets a random 32-byte
 * secret generated once and kept in the data directory — not a constant baked
 * into the repository, which every install would share and anyone could use to
 * forge a session cookie for any of them. Persisting it keeps local sessions
 * alive across restarts.
 */
function secret(): string {
  const configured = env().BETTER_AUTH_SECRET;
  if (configured) return configured;

  if (isCloud) {
    throw new Error(
      "BETTER_AUTH_SECRET is required when BUSSOLA_EDITION=cloud.",
    );
  }

  const dataDir = configuredDataDir();
  const secretFile = path.join(dataDir, "auth-secret");

  try {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    // Not created yet — fall through and write one. Anything other than a
    // missing file (a permissions problem, say) is worth knowing about,
    // because the write below is about to fail the same way.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("could not read the session secret", { file: secretFile }, error);
    }
  }

  const generated = randomBytes(32).toString("base64url");
  fs.mkdirSync(dataDir, { recursive: true });
  // Owner-only: this key is equivalent to every session on the instance.
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  log.info("generated a session secret", { file: secretFile });

  return generated;
}

/**
 * Where an invitation link points.
 *
 * `BETTER_AUTH_URL` is required in cloud and is the right answer there. A
 * self-hosted install may have neither it nor any way to know its own public
 * hostname from inside a request-less callback, so it falls back to localhost
 * — wrong for a server on a domain, but a wrong link someone can see and fix
 * beats a crash inside the invite flow.
 */
function inviteBaseUrl(): string {
  const { BETTER_AUTH_URL, BUSSOLA_PUBLIC_URL } = env();
  return (
    BETTER_AUTH_URL ??
    BUSSOLA_PUBLIC_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/** A URL-safe organization slug derived from the account's email. */
function slugFor(email: string): string {
  const base =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "workspace";
  return `${base}-${createId().slice(0, 6)}`;
}

async function build() {
  const db = await getDb();
  const verifyEmail = isCloud && emailConfigured();

  return betterAuth({
    secret: secret(),
    /*
     * Only pinned when configured. Better Auth checks request origins against
     * this, so hardcoding a localhost:3000 default makes every auth request
     * fail with 403 on a self-hosted install running on any other port or
     * domain — with nothing in the response to explain why. Left undefined it
     * infers the origin from the request, which is what self-hosting needs.
     * Cloud sets BETTER_AUTH_URL, so it stays explicit where it matters.
     */
    baseURL: env().BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "pg", schema }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: verifyEmail,
    },

    /*
     * Cloud with a mail provider proves an address before it can sign in.
     * Without that, anyone can register someone else's email — squatting the
     * address, and accepting any invitation sent to it. Self-hosted has one
     * account whose owner is at the keyboard, and a cloud deployment with no
     * mail provider cannot send the link, so both keep verification off
     * rather than lock everyone out.
     */
    emailVerification: verifyEmail
      ? {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          expiresIn: 60 * 60 * 24,
          async sendVerificationEmail({
            user,
            url,
          }: {
            user: { email: string; name: string };
            url: string;
          }) {
            const { sendEmail } = await import("@/lib/notify/email");
            const result = await sendEmail({
              to: user.email,
              subject: "Confirm your email for Bussola",
              text: [
                `Hi ${user.name || "there"},`,
                "",
                `Confirm your email address to finish creating your Bussola account: ${url}`,
                "",
                "The link is valid for 24 hours. If you did not sign up, you can ignore this email.",
              ].join("\n"),
            });
            if (!result.ok) {
              // The address stays out of the log: the reason is what an
              // operator can act on, and it is not worth a copy of PII.
              log.warn("verification email not sent", { reason: result.error });
            }
          },
        }
      : undefined,

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },

    databaseHooks: {
      user: {
        create: {
          async before(data) {
            if (isSelfHosted) {
              const existing = await db
                .select({ id: schema.user.id })
                .from(schema.user)
                .limit(1);
              if (existing.length > 0) {
                throw new APIError("FORBIDDEN", {
                  message:
                    "This Bussola instance already has an account. Self-hosted installs are single-user; run the hosted edition for teams.",
                });
              }
            }
            return { data };
          },

          /**
           * Every account gets an organization immediately, so there is no
           * window in which a signed-in user has no tenant to act in.
           */
          async after(created) {
            const organizationId = createId("org");
            await db.insert(schema.organization).values({
              id: organizationId,
              name: created.name?.trim() || "Personal",
              slug: slugFor(created.email),
            });
            await db.insert(schema.member).values({
              id: createId("mem"),
              organizationId,
              userId: created.id,
              role: "owner",
            });
          },
        },
      },

      session: {
        create: {
          /** Bind each new session to the user's organization. */
          async before(data) {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, data.userId))
              .limit(1);

            return {
              data: {
                ...data,
                activeOrganizationId: membership?.organizationId ?? null,
              },
            };
          },
        },
      },
    },

    plugins: [
      organization({
        /**
         * How an invitation actually reaches somebody.
         *
         * Without this, Better Auth creates the row and returns — the invite
         * exists but nobody is ever told about it, which is indistinguishable
         * from the feature not working. Delivery failures are logged rather
         * than thrown: the invitation is valid either way, and the inviter can
         * always copy the link from the members list.
         */
        async sendInvitationEmail(data: {
          id: string;
          email: string;
          organization: { name: string };
          inviter: { user: { name: string; email: string } };
        }) {
          const { sendEmail } = await import("@/lib/notify/email");
          const url = `${inviteBaseUrl()}/invite/${data.id}`;
          const inviterName =
            data.inviter.user.name || data.inviter.user.email;

          const result = await sendEmail({
            to: data.email,
            subject: `${inviterName} invited you to ${data.organization.name} on Bussola`,
            text: [
              `${inviterName} has invited you to join ${data.organization.name} on Bussola.`,
              "",
              `Accept the invitation: ${url}`,
              "",
              "If you were not expecting this, you can ignore this email.",
            ].join("\n"),
          });

          if (!result.ok) {
            log.warn("invitation email not sent", {
              invitationId: data.id,
              reason: result.error,
            });
          }
        },

        /**
         * Seats are what the Team plan sells, so an invitation that would take
         * an organization past its allowance is refused before it is sent —
         * far better than letting someone accept and then bounce off a limit.
         */
        async beforeCreateInvitation({
          organization: org,
        }: {
          organization: { id: string };
        }) {
          const { entitlementsFor } = await import(
            "@/lib/billing/entitlements"
          );
          const entitlements = await entitlementsFor(org.id);
          if (!Number.isFinite(entitlements.limits.seats)) return;

          const [members] = await db
            .select({ value: count() })
            .from(schema.member)
            .where(eq(schema.member.organizationId, org.id));
          const [pending] = await db
            .select({ value: count() })
            .from(schema.invitation)
            .where(
              and(
                eq(schema.invitation.organizationId, org.id),
                eq(schema.invitation.status, "pending"),
              ),
            );

          const used = (members?.value ?? 0) + (pending?.value ?? 0);
          if (used >= entitlements.limits.seats) {
            throw new APIError("PAYMENT_REQUIRED", {
              message: `Your ${entitlements.planName} plan includes ${entitlements.limits.seats} seats. Add a seat to invite more people.`,
            });
          }
        },
        // Self-hosted has exactly one organization; cloud lets an owner run
        // several (agency with multiple clients, say).
        allowUserToCreateOrganization: isCloud,
        // An invitation is addressed to an email; only someone who has proven
        // they hold it may accept.
        requireEmailVerificationOnInvitation: verifyEmail,
      }),
      // Must stay last: it lets Better Auth set cookies from server actions.
      nextCookies(),
    ],
  });
}

/** Inferred from the concrete configuration so plugin routes stay typed. */
type Auth = Awaited<ReturnType<typeof build>>;

export function getAuth(): Promise<Auth> {
  authPromise ??= build();
  return authPromise;
}
