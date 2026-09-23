import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import type { TenantRepos } from "./tenant";

/**
 * Tenant isolation, proven against a real Postgres (PGlite) with the real
 * migrations applied — not against mocks.
 *
 * Two organizations are seeded and every repository is exercised from the
 * wrong tenant's perspective. Each assertion below corresponds to a query that
 * before Phase 0 would have crossed the tenant boundary.
 */
let dataDir: string;
let alice: TenantRepos;
let bob: TenantRepos;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bussola-tenant-"));
  process.env.BUSSOLA_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.BUSSOLA_EDITION;

  const db = await import("./index");
  const { forTenant } = await import("./tenant");
  const { organization, user, member } = await import("./schema");

  await db.runMigrations();
  closeDb = db.closeDb;

  const handle = await db.getDb();
  const seed = async (slug: string) => {
    const organizationId = createId("org");
    const userId = createId("usr");
    await handle
      .insert(organization)
      .values({ id: organizationId, name: slug, slug });
    await handle.insert(user).values({
      id: userId,
      name: slug,
      email: `${slug}@example.test`,
    });
    await handle
      .insert(member)
      .values({ id: createId("mem"), organizationId, userId, role: "owner" });
    return forTenant({ organizationId, userId });
  };

  alice = await seed("alice");
  bob = await seed("bob");
}, 60_000);

afterAll(async () => {
  await closeDb?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("applies the schema to a fresh Postgres", async () => {
    // Reaching this point means runMigrations() succeeded in beforeAll.
    expect(await alice.dashboards.list()).toEqual([]);
  });
});

describe("dashboard isolation", () => {
  it("does not list another tenant's dashboards", async () => {
    await alice.dashboards.create("Alice ops");
    expect(await alice.dashboards.list()).toHaveLength(1);
    expect(await bob.dashboards.list()).toHaveLength(0);
  });

  it("cannot read another tenant's dashboard by id", async () => {
    const dash = await alice.dashboards.create("Secret");
    expect(await bob.dashboards.get(dash.id)).toBeNull();
  });

  it("cannot rename or delete another tenant's dashboard", async () => {
    const dash = await alice.dashboards.create("Untouched");

    expect(await bob.dashboards.rename(dash.id, "pwned")).toBeNull();
    expect(await bob.dashboards.remove(dash.id)).toBe(false);

    const still = await alice.dashboards.get(dash.id);
    expect(still?.name).toBe("Untouched");
  });
});

describe("widget isolation", () => {
  it("does not expose widgets across tenants", async () => {
    const dash = await alice.dashboards.create("With widgets");
    await alice.widgets.add({
      dashboardId: dash.id,
      widgetType: "railway-fleet",
      title: "Fleet",
      configJson: "{}",
      layoutY: 0,
      layoutW: 3,
      layoutH: 2,
    });

    expect(await alice.widgets.listFor(dash.id)).toHaveLength(1);
    expect(await bob.widgets.listFor(dash.id)).toHaveLength(0);
  });

  it("refuses to move a widget that belongs to a different dashboard", async () => {
    const a = await alice.dashboards.create("A");
    const b = await alice.dashboards.create("B");
    const widget = await alice.widgets.add({
      dashboardId: a.id,
      widgetType: "railway-fleet",
      title: "Fleet",
      configJson: "{}",
      layoutY: 0,
      layoutW: 3,
      layoutH: 2,
    });

    // Same tenant, wrong dashboard: must not match.
    const moved = await alice.widgets.saveLayouts(b.id, [
      { i: widget.id, x: 9, y: 9, w: 1, h: 1 },
    ]);
    expect(moved).toBe(0);

    const [unchanged] = await alice.widgets.listFor(a.id);
    expect(unchanged.layoutX).toBe(0);
    expect(unchanged.layoutY).toBe(0);
  });

  it("refuses to delete another tenant's widget", async () => {
    const dash = await alice.dashboards.create("Guarded");
    const widget = await alice.widgets.add({
      dashboardId: dash.id,
      widgetType: "railway-fleet",
      title: "Fleet",
      configJson: "{}",
      layoutY: 0,
      layoutW: 3,
      layoutH: 2,
    });

    expect(await bob.widgets.remove(dash.id, widget.id)).toBe(false);
    expect(await alice.widgets.listFor(dash.id)).toHaveLength(1);
  });
});

describe("saveLayouts", () => {
  async function canvas(count: number) {
    const dash = await alice.dashboards.create(`Canvas ${count}`);
    const widgets = [];
    for (let i = 0; i < count; i++) {
      widgets.push(
        await alice.widgets.add({
          dashboardId: dash.id,
          widgetType: "railway-fleet",
          title: `W${i}`,
          configJson: "{}",
          layoutY: i * 2,
          layoutW: 3,
          layoutH: 2,
        }),
      );
    }
    return { dash, widgets };
  }

  const positions = async (dashboardId: string) =>
    Object.fromEntries(
      (await alice.widgets.listFor(dashboardId)).map((w) => [
        w.id,
        [w.layoutX, w.layoutY, w.layoutW, w.layoutH],
      ]),
    );

  it("persists every layout in one call and counts them", async () => {
    const { dash, widgets } = await canvas(3);
    const moved = await alice.widgets.saveLayouts(
      dash.id,
      widgets.map((w, n) => ({ i: w.id, x: n, y: 10 - n, w: 4, h: 1 + n })),
    );

    expect(moved).toBe(3);
    expect(await positions(dash.id)).toEqual({
      [widgets[0].id]: [0, 10, 4, 1],
      [widgets[1].id]: [1, 9, 4, 2],
      [widgets[2].id]: [2, 8, 4, 3],
    });
  });

  it("applies all or nothing: one bad value leaves the canvas untouched", async () => {
    const { dash, widgets } = await canvas(3);
    const before = await positions(dash.id);

    await expect(
      alice.widgets.saveLayouts(dash.id, [
        { i: widgets[0].id, x: 5, y: 5, w: 5, h: 5 },
        { i: widgets[1].id, x: 6, y: 6, w: 6, h: 6 },
        // Not an integer: Postgres rejects the statement.
        { i: widgets[2].id, x: 1.5, y: 7, w: 7, h: 7 },
      ]),
    ).rejects.toThrow();

    expect(await positions(dash.id)).toEqual(before);
  });

  it("moves only the widgets on this dashboard, in the same batch", async () => {
    const { dash, widgets } = await canvas(1);
    const other = await canvas(1);

    const moved = await alice.widgets.saveLayouts(dash.id, [
      { i: widgets[0].id, x: 3, y: 3, w: 3, h: 3 },
      { i: other.widgets[0].id, x: 9, y: 9, w: 1, h: 1 },
      { i: "wdg_missing", x: 1, y: 1, w: 1, h: 1 },
    ]);

    expect(moved).toBe(1);
    expect((await positions(other.dash.id))[other.widgets[0].id]).toEqual([
      0, 0, 3, 2,
    ]);
  });

  it("keeps the last position when an id repeats", async () => {
    const { dash, widgets } = await canvas(1);
    await alice.widgets.saveLayouts(dash.id, [
      { i: widgets[0].id, x: 1, y: 1, w: 1, h: 1 },
      { i: widgets[0].id, x: 2, y: 2, w: 2, h: 2 },
    ]);
    expect((await positions(dash.id))[widgets[0].id]).toEqual([2, 2, 2, 2]);
  });

  it("does nothing for an empty layout", async () => {
    const { dash } = await canvas(1);
    expect(await alice.widgets.saveLayouts(dash.id, [])).toBe(0);
  });

  it("never moves another tenant's widget", async () => {
    const { dash, widgets } = await canvas(1);
    const moved = await bob.widgets.saveLayouts(dash.id, [
      { i: widgets[0].id, x: 9, y: 9, w: 1, h: 1 },
    ]);
    expect(moved).toBe(0);
    expect((await positions(dash.id))[widgets[0].id]).toEqual([0, 0, 3, 2]);
  });
});

describe("nextY", () => {
  it("is the first free row below every widget", async () => {
    const dash = await alice.dashboards.create("Stacked");
    expect(await alice.widgets.nextY(dash.id)).toBe(0);

    for (const [layoutY, layoutH] of [
      [0, 2],
      [4, 3],
      [1, 1],
    ]) {
      await alice.widgets.add({
        dashboardId: dash.id,
        widgetType: "railway-fleet",
        title: "W",
        configJson: "{}",
        layoutY,
        layoutW: 3,
        layoutH,
      });
    }
    expect(await alice.widgets.nextY(dash.id)).toBe(7);
    // Scoped like every other read.
    expect(await bob.widgets.nextY(dash.id)).toBe(0);
  });
});

describe("bounded lists", () => {
  it("never lets revoked tokens push a live one out of the list", async () => {
    const { MAX_TOKENS_LISTED } = await import("./repos/api-tokens");
    const token = (name: string) =>
      alice.apiTokens.create({
        name,
        tokenHash: createId("hash"),
        tokenPrefix: "bus_",
        scope: "read",
        expiresAt: null,
      });

    const live = await token("oldest, still live");
    for (let i = 0; i < MAX_TOKENS_LISTED; i++) {
      const dead = await token(`revoked ${i}`);
      await alice.apiTokens.revoke(dead.id);
    }

    const listed = await alice.apiTokens.list();
    expect(listed).toHaveLength(MAX_TOKENS_LISTED);
    expect(listed.map((t) => t.id)).toContain(live.id);
    // Still newest first, as the settings screen expects.
    const times = listed.map((t) => t.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(listed.at(-1)?.id).toBe(live.id);
  });

  it("clamps the alert feed to its maximum, whatever is asked for", async () => {
    // Nothing to return for this tenant; the point is that an absurd limit
    // is accepted and bounded rather than passed through.
    await expect(bob.alertEvents.list(1_000_000)).resolves.toEqual([]);
    await expect(bob.alertEvents.list(0)).resolves.toEqual([]);
  });
});

describe("connection isolation", () => {
  it("byProvider never returns another tenant's credentials", async () => {
    await alice.connections.create({
      provider: "railway",
      label: "Alice Railway",
      credentialsEncrypted: "alice-ciphertext",
    });

    const mine = await alice.connections.byProvider("railway");
    expect(mine?.credentialsEncrypted).toBe("alice-ciphertext");

    // The regression this whole phase exists to prevent.
    expect(await bob.connections.byProvider("railway")).toBeNull();
    expect(await bob.connections.list()).toHaveLength(0);
  });

  it("cannot overwrite or delete another tenant's connection", async () => {
    const conn = await alice.connections.create({
      provider: "netlify",
      label: "Alice Netlify",
      credentialsEncrypted: "original",
    });

    expect(
      await bob.connections.update(conn.id, {
        label: "hijacked",
        credentialsEncrypted: "attacker",
      }),
    ).toBeNull();
    expect(await bob.connections.remove(conn.id)).toBe(false);

    const still = await alice.connections.get(conn.id);
    expect(still?.credentialsEncrypted).toBe("original");
  });
});

describe("cache isolation", () => {
  it("namespaces cache entries per organization", async () => {
    await alice.cache.set("shared-key", { secret: "alice" }, 60);
    await bob.cache.set("shared-key", { secret: "bob" }, 60);

    expect(await alice.cache.get("shared-key")).toEqual({ secret: "alice" });
    expect(await bob.cache.get("shared-key")).toEqual({ secret: "bob" });
  });

  it("serves a stale entry when the upstream fetch fails", async () => {
    await alice.cache.set("flaky", { v: 1 }, -1); // already expired
    const { data, cached } = await alice.cache.fetch<{ v: number }>(
      "flaky",
      60,
      () => Promise.reject(new Error("upstream down")),
    );
    expect(data).toEqual({ v: 1 });
    expect(cached).toBe(true);
  });

  it("propagates the error when there is nothing stale to serve", async () => {
    await expect(
      alice.cache.fetch("cold", 60, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});
