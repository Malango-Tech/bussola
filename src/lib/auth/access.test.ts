import fs from "fs";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { mintToken } from "@/lib/sharing/tokens";
import { can, hasRole, toMemberRole } from "./roles";

/**
 * Losing access has to actually lose access.
 *
 * Against a real Postgres (PGlite) with the real migrations: an organization
 * with an owner, an admin and a member, then the member and admin are removed
 * and every way back in — their session, an API token they minted — is
 * checked to be closed.
 */
let dataDir: string;
let closeDb: () => Promise<void>;

type Seeded = { userId: string; memberId: string; sessionId: string };

let db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>;
let schema: typeof import("@/lib/db/schema");
let forTenant: typeof import("@/lib/db/tenant").forTenant;
let resolveSessionMembership: typeof import("./membership").resolveSessionMembership;
let resolveApiToken: typeof import("@/lib/mcp/auth").resolveApiToken;

let orgId: string;
let otherOrgId: string;
let owner: Seeded;

async function seedPerson(
  organizationId: string,
  role: string,
  name: string,
): Promise<Seeded> {
  const userId = createId("usr");
  const memberId = createId("mem");
  const sessionId = createId("ses");
  await db.insert(schema.user).values({
    id: userId,
    name,
    email: `${name}-${userId}@example.test`,
  });
  await db
    .insert(schema.member)
    .values({ id: memberId, organizationId, userId, role });
  await db.insert(schema.session).values({
    id: sessionId,
    token: createId("tok"),
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    activeOrganizationId: organizationId,
  });
  return { userId, memberId, sessionId };
}

async function mintApiToken(organizationId: string, userId: string) {
  const minted = mintToken("bsk");
  await forTenant({ organizationId, userId }).apiTokens.create({
    name: "agent",
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    scope: "write",
    expiresAt: null,
  });
  return minted.token;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-access-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.BUSSOLA_EDITION;

  const dbModule = await import("@/lib/db");
  await dbModule.runMigrations();
  closeDb = dbModule.closeDb;
  db = await dbModule.getDb();
  schema = await import("@/lib/db/schema");
  ({ forTenant } = await import("@/lib/db/tenant"));
  ({ resolveSessionMembership } = await import("./membership"));
  ({ resolveApiToken } = await import("@/lib/mcp/auth"));

  orgId = createId("org");
  otherOrgId = createId("org");
  await db.insert(schema.organization).values([
    { id: orgId, name: "Acme", slug: `acme-${orgId}` },
    { id: otherOrgId, name: "Other", slug: `other-${otherOrgId}` },
  ]);
  owner = await seedPerson(orgId, "owner", "owner");
}, 60_000);

afterAll(async () => {
  await closeDb?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("roles", () => {
  it("normalises stored roles, most privileged first", () => {
    expect(toMemberRole("owner")).toBe("owner");
    expect(toMemberRole("member,admin")).toBe("admin");
    expect(toMemberRole("something-else")).toBe("member");
    expect(toMemberRole(null)).toBe("member");
  });

  it("orders privileges", () => {
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole(undefined, "member")).toBe(false);
  });

  it("keeps billing to owners and management to admins", () => {
    expect(can("admin", "manageConnections")).toBe(true);
    expect(can("member", "manageConnections")).toBe(false);
    expect(can("member", "manageTokens")).toBe(false);
    expect(can("admin", "manageBilling")).toBe(false);
    expect(can("owner", "manageBilling")).toBe(true);
  });
});

describe("resolveSessionMembership", () => {
  it("resolves the active organization and the role in it", async () => {
    const admin = await seedPerson(orgId, "admin", "admin-a");
    await expect(
      resolveSessionMembership({
        userId: admin.userId,
        sessionId: admin.sessionId,
        activeOrganizationId: orgId,
      }),
    ).resolves.toEqual({ organizationId: orgId, role: "admin" });
  });

  it("refuses a session whose organization the user no longer belongs to", async () => {
    const leaver = await seedPerson(orgId, "member", "leaver");
    await db.delete(schema.member).where(eq(schema.member.id, leaver.memberId));

    await expect(
      resolveSessionMembership({
        userId: leaver.userId,
        sessionId: leaver.sessionId,
        activeOrganizationId: orgId,
      }),
    ).resolves.toBeNull();
  });

  it("falls back to a remaining membership and writes it back", async () => {
    const mover = await seedPerson(orgId, "member", "mover");
    await db.insert(schema.member).values({
      id: createId("mem"),
      organizationId: otherOrgId,
      userId: mover.userId,
      role: "owner",
    });
    await db.delete(schema.member).where(eq(schema.member.id, mover.memberId));

    await expect(
      resolveSessionMembership({
        userId: mover.userId,
        sessionId: mover.sessionId,
        activeOrganizationId: orgId,
      }),
    ).resolves.toEqual({ organizationId: otherOrgId, role: "owner" });

    const [row] = await db
      .select({ active: schema.session.activeOrganizationId })
      .from(schema.session)
      .where(eq(schema.session.id, mover.sessionId));
    expect(row?.active).toBe(otherOrgId);
  });

  it("resolves a session opened before its organization existed", async () => {
    const fresh = await seedPerson(orgId, "member", "fresh");
    await expect(
      resolveSessionMembership({
        userId: fresh.userId,
        sessionId: fresh.sessionId,
        activeOrganizationId: null,
      }),
    ).resolves.toEqual({ organizationId: orgId, role: "member" });
  });
});

describe("removing a member", () => {
  it("ends their sessions in this organization and revokes their API tokens", async () => {
    const leaving = await seedPerson(orgId, "member", "leaving");
    const token = await mintApiToken(orgId, leaving.userId);
    const ownersToken = await mintApiToken(orgId, owner.userId);
    expect(await resolveApiToken(token)).not.toBeNull();

    const repos = forTenant({
      organizationId: orgId,
      userId: owner.userId,
      role: "owner",
    });
    await expect(repos.members.removeMember(leaving.memberId)).resolves.toEqual({
      ok: true,
    });

    const sessions = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, leaving.userId));
    expect(sessions).toHaveLength(0);

    expect(await resolveApiToken(token)).toBeNull();
    // Nobody else's access is touched.
    expect(await resolveApiToken(ownersToken)).not.toBeNull();
  });

  it("stops an API token working once its minter is gone, even if revoking was missed", async () => {
    const minter = await seedPerson(orgId, "admin", "minter");
    const token = await mintApiToken(orgId, minter.userId);
    expect(await resolveApiToken(token)).not.toBeNull();

    // Removed behind the repository's back, so nothing revoked the token.
    await db.delete(schema.member).where(eq(schema.member.id, minter.memberId));
    expect(await resolveApiToken(token)).toBeNull();
  });

  it("does not let an admin remove an owner", async () => {
    const admin = await seedPerson(orgId, "admin", "admin-b");
    const coOwner = await seedPerson(orgId, "owner", "co-owner");

    const asAdmin = forTenant({
      organizationId: orgId,
      userId: admin.userId,
      role: "admin",
    });
    await expect(asAdmin.members.removeMember(coOwner.memberId)).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });

    const asOwner = forTenant({
      organizationId: orgId,
      userId: owner.userId,
      role: "owner",
    });
    await expect(asOwner.members.removeMember(coOwner.memberId)).resolves.toEqual({
      ok: true,
    });
  });

  it("still refuses to remove the last owner", async () => {
    const soloOrg = createId("org");
    await db
      .insert(schema.organization)
      .values({ id: soloOrg, name: "Solo", slug: `solo-${soloOrg}` });
    const solo = await seedPerson(soloOrg, "owner", "solo");
    const repos = forTenant({
      organizationId: soloOrg,
      userId: solo.userId,
      role: "owner",
    });
    await expect(repos.members.removeMember(solo.memberId)).resolves.toEqual({
      ok: false,
      reason: "last_owner",
    });
  });
});

describe("reencryptLegacySecrets", () => {
  it("moves secrets written with the old public fallback key onto the current key", async () => {
    const { createCipheriv, createHash, randomBytes } = await import("crypto");
    const { decryptSecretDetailed } = await import("@/lib/crypto/vault");
    const { reencryptLegacySecrets } = await import("@/lib/crypto/rotate");
    delete process.env.BUSSOLA_ENCRYPTION_KEY;

    const legacyKey = createHash("sha256").update("bussola-local-dev-key").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const data = Buffer.concat([cipher.update('{"apiKey":"old"}', "utf8"), cipher.final()]);
    const legacyPayload = [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString("base64"))
      .join(".");

    const repos = forTenant({ organizationId: orgId, userId: owner.userId });
    const connection = await repos.connections.create({
      provider: "stripe",
      label: "Legacy",
      credentialsEncrypted: legacyPayload,
    });

    const report = await reencryptLegacySecrets();
    expect(report.reencrypted).toBeGreaterThanOrEqual(1);

    const stored = await repos.connections.get(connection.id);
    expect(stored?.credentialsEncrypted).not.toBe(legacyPayload);
    expect(decryptSecretDetailed(stored!.credentialsEncrypted)).toEqual({
      plaintext: '{"apiKey":"old"}',
      legacy: false,
    });

    // Idempotent: nothing left to move.
    expect((await reencryptLegacySecrets()).reencrypted).toBe(0);
  });
});
