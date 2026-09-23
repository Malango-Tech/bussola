import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, type TestDb } from "@/test/db";
import { params, read, request } from "@/test/http";
import {
  actAs,
  reposFor,
  seedConnection,
  seedTenants,
  type Tenants,
} from "@/test/tenant";

vi.mock("@/lib/auth/tenant", async (importOriginal) =>
  (await import("@/test/tenant")).mockTenantModule(await importOriginal()),
);

type Widget = {
  id: string;
  widgetType: string;
  title: string;
  connectionId: string | null;
  config: { connectionIds?: string[] };
};

let route: typeof import("./route");
let testDb: TestDb;
let t: Tenants;
let ours: string;
let theirs: string;
let ourStripe: string;
let ourVercel: string;
let theirStripe: string;
let theirWidget: string;

const url = (id: string, query = "") => `/api/dashboards/${id}/widgets${query}`;

const add = (id: string, body: unknown) =>
  read<{ widget: Widget }>(
    route.POST(request(url(id), { method: "POST", body }), params({ id })),
  );
const patch = (id: string, body: unknown) =>
  read<{ widget: Widget }>(
    route.PATCH(request(url(id), { method: "PATCH", body }), params({ id })),
  );
const layout = (id: string, body: unknown) =>
  read<{ updated: number }>(
    route.PUT(request(url(id), { method: "PUT", body }), params({ id })),
  );
const remove = (id: string, widgetId?: string) =>
  read(
    route.DELETE(
      request(url(id, widgetId ? `?widgetId=${widgetId}` : ""), { method: "DELETE" }),
      params({ id }),
    ),
  );

beforeAll(async () => {
  testDb = await startTestDb("widgets-route");
  t = await seedTenants(testDb);

  ours = (await (await reposFor(t.acme.owner)).dashboards.create("Ours")).id;
  ourStripe = (await seedConnection(t.acme.owner, "stripe")).id;
  ourVercel = (await seedConnection(t.acme.owner, "vercel")).id;

  const other = await reposFor(t.other.owner);
  theirs = (await other.dashboards.create("Theirs")).id;
  theirStripe = (await seedConnection(t.other.owner, "stripe")).id;
  theirWidget = (
    await other.widgets.add({
      dashboardId: theirs,
      widgetType: "stripe-mrr",
      title: "Their MRR",
      configJson: "{}",
      connectionId: theirStripe,
      layoutY: 0,
      layoutW: 4,
      layoutH: 3,
    })
  ).id;

  route = await import("./route");
});

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => actAs(t.acme.member));

describe("POST /api/dashboards/[id]/widgets", () => {
  it("answers 401 without a tenant", async () => {
    actAs(null);
    expect((await add(ours, { widgetType: "stripe-mrr" })).status).toBe(401);
  });

  it("adds a widget bound to one of this organization's connections", async () => {
    const { status, body } = await add(ours, {
      widgetType: "stripe-mrr",
      connectionId: ourStripe,
    });
    expect(status).toBe(201);
    expect(body.widget).toMatchObject({
      widgetType: "stripe-mrr",
      title: "MRR",
      connectionId: ourStripe,
    });
  });

  it("writes out only this organization's connections for a cross-source widget", async () => {
    const { status, body } = await add(ours, { widgetType: "status-board" });
    expect(status).toBe(201);
    expect(body.widget.config.connectionIds?.sort()).toEqual(
      [ourStripe, ourVercel].sort(),
    );
    expect(body.widget.config.connectionIds).not.toContain(theirStripe);
  });

  it("rejects an invalid payload and an unknown widget type", async () => {
    expect((await add(ours, {})).status).toBe(400);
    expect((await add(ours, { widgetType: "stripe-mrr", title: 5 })).status).toBe(400);
    const unknown = await add(ours, { widgetType: "not-a-widget" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("Unknown widget type");
  });

  it("refuses a connection of the wrong provider", async () => {
    const { status, body } = await add(ours, {
      widgetType: "stripe-mrr",
      connectionId: ourVercel,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/reads stripe, not vercel/);
  });

  it("cannot bind a widget to another organization's connection", async () => {
    const { status } = await add(ours, {
      widgetType: "stripe-mrr",
      connectionId: theirStripe,
    });
    expect(status).toBe(404);
  });

  it("cannot add to another organization's dashboard", async () => {
    expect((await add(theirs, { widgetType: "stripe-mrr" })).status).toBe(404);
  });
});

describe("PUT /api/dashboards/[id]/widgets", () => {
  it("saves a layout", async () => {
    const created = await add(ours, { widgetType: "stripe-mrr" });
    const { status, body } = await layout(ours, {
      layouts: [{ i: created.body.widget.id, x: 2, y: 3, w: 5, h: 4 }],
    });
    expect(status).toBe(200);
    expect(body.updated).toBe(1);
  });

  it("rejects a malformed layout", async () => {
    expect((await layout(ours, { layouts: [{ i: "x", x: -1, y: 0, w: 1, h: 1 }] })).status).toBe(400);
  });

  it("does not move another organization's widgets", async () => {
    expect(
      (await layout(theirs, { layouts: [{ i: theirWidget, x: 9, y: 9, w: 1, h: 1 }] })).status,
    ).toBe(404);
    // Nor through our own dashboard's id.
    const { body } = await layout(ours, {
      layouts: [{ i: theirWidget, x: 9, y: 9, w: 1, h: 1 }],
    });
    expect(body.updated).toBe(0);
  });
});

describe("PATCH /api/dashboards/[id]/widgets", () => {
  it("retitles, and an empty title falls back to the widget's name", async () => {
    const { body: created } = await add(ours, { widgetType: "stripe-mrr" });
    const renamed = await patch(ours, { widgetId: created.widget.id, title: "Revenue" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.widget.title).toBe("Revenue");

    const cleared = await patch(ours, { widgetId: created.widget.id, title: "" });
    expect(cleared.body.widget.title).toBe("MRR");
  });

  it("rejects an invalid payload", async () => {
    expect((await patch(ours, { title: "no widget id" })).status).toBe(400);
  });

  it("cannot rebind a widget to another organization's connection", async () => {
    const { body: created } = await add(ours, { widgetType: "stripe-mrr" });
    const { status } = await patch(ours, {
      widgetId: created.widget.id,
      connectionId: theirStripe,
    });
    expect(status).toBe(404);
  });

  it("cannot reach another organization's widget", async () => {
    expect((await patch(ours, { widgetId: theirWidget, title: "Mine" })).status).toBe(404);
    expect((await patch(theirs, { widgetId: theirWidget, title: "Mine" })).status).toBe(404);
  });
});

describe("DELETE /api/dashboards/[id]/widgets", () => {
  it("requires a widget id", async () => {
    expect((await remove(ours)).status).toBe(400);
  });

  it("removes its own widget", async () => {
    const { body: created } = await add(ours, { widgetType: "stripe-mrr" });
    expect((await remove(ours, created.widget.id)).status).toBe(200);
    expect((await remove(ours, created.widget.id)).status).toBe(404);
  });

  it("cannot remove another organization's widget", async () => {
    expect((await remove(theirs, theirWidget)).status).toBe(404);
    expect((await remove(ours, theirWidget)).status).toBe(404);
    const other = await reposFor(t.other.owner);
    expect(await other.widgets.get(theirs, theirWidget)).toBeTruthy();
  });
});
