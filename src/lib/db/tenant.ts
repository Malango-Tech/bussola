import { and, asc, count, desc, eq, isNull, lt } from "drizzle-orm";
import type { MemberRole } from "@/lib/auth/roles";
import { createId } from "@/lib/id";
import { getDb } from ".";
import {
  alertEvents,
  alertRules,
  apiTokens,
  connectionCache,
  connectionSnapshots,
  connections,
  dashboardShares,
  invitation,
  member,
  notificationChannels,
  dashboardWidgets,
  dashboards,
  session,
  user,
  type AlertComparator,
  type ApiTokenScope,
  type ConnectionStatus,
  type NotificationChannelKind,
  type Provider,
} from "./schema";

/**
 * Who the current request is acting as. Produced only by `lib/auth/tenant.ts`
 * from a verified session — never from user input.
 */
export type TenantContext = {
  organizationId: string;
  userId: string;
  /**
   * The caller's role in the organization, for a person acting through a
   * session. Absent for callers that are not a member (a share link, an MCP
   * token, the worker), which therefore pass no role check.
   */
  role?: MemberRole;
};

/**
 * Every query against tenant-owned data goes through here, and every one of
 * them is filtered by `organization_id` before it touches a row. Route handlers
 * are barred from importing `lib/db` or `lib/db/schema` directly (enforced by
 * `no-restricted-imports` in eslint.config.mjs), so this file is the only place
 * where forgetting the tenant filter is even possible.
 */
export function forTenant(ctx: TenantContext) {
  const org = ctx.organizationId;

  /** Reused by every dashboard query so the scope cannot be omitted. */
  const ownDashboard = (id: string) =>
    and(eq(dashboards.id, id), eq(dashboards.organizationId, org));

  const ownWidget = (dashboardId: string, widgetId: string) =>
    and(
      eq(dashboardWidgets.id, widgetId),
      eq(dashboardWidgets.dashboardId, dashboardId),
      eq(dashboardWidgets.organizationId, org),
    );

  const ownConnection = (id: string) =>
    and(eq(connections.id, id), eq(connections.organizationId, org));

  return {
    ctx,

    dashboards: {
      async list() {
        const db = await getDb();
        return db
          .select()
          .from(dashboards)
          .where(eq(dashboards.organizationId, org))
          .orderBy(desc(dashboards.updatedAt));
      },

      async get(id: string) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(dashboards)
          .where(ownDashboard(id))
          .limit(1);
        return row ?? null;
      },

      async count() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(dashboards)
          .where(eq(dashboards.organizationId, org));
        return row?.value ?? 0;
      },

      /** For the sidebar's persistent shortcuts. */
      async listStarred() {
        const db = await getDb();
        return db
          .select()
          .from(dashboards)
          .where(and(eq(dashboards.organizationId, org), eq(dashboards.starred, true)))
          .orderBy(desc(dashboards.updatedAt));
      },

      async create(name: string) {
        const db = await getDb();
        const [row] = await db
          .insert(dashboards)
          .values({ id: createId("dash"), organizationId: org, name })
          .returning();
        return row;
      },

      async rename(id: string, name: string) {
        const db = await getDb();
        const [row] = await db
          .update(dashboards)
          .set({ name, updatedAt: new Date() })
          .where(ownDashboard(id))
          .returning();
        return row ?? null;
      },

      async star(id: string, starred: boolean) {
        const db = await getDb();
        const [row] = await db
          .update(dashboards)
          .set({ starred })
          .where(ownDashboard(id))
          .returning();
        return row ?? null;
      },

      async remove(id: string) {
        const db = await getDb();
        const rows = await db
          .delete(dashboards)
          .where(ownDashboard(id))
          .returning({ id: dashboards.id });
        return rows.length > 0;
      },
    },

    widgets: {
      async listFor(dashboardId: string) {
        const db = await getDb();
        return db
          .select()
          .from(dashboardWidgets)
          .where(
            and(
              eq(dashboardWidgets.dashboardId, dashboardId),
              eq(dashboardWidgets.organizationId, org),
            ),
          )
          .orderBy(
            asc(dashboardWidgets.layoutY),
            asc(dashboardWidgets.layoutX),
          );
      },

      /** Widget types in use, for showing what a connection feeds. */
      async listTypes() {
        const db = await getDb();
        const rows = await db
          .select({ widgetType: dashboardWidgets.widgetType })
          .from(dashboardWidgets)
          .where(eq(dashboardWidgets.organizationId, org));
        return rows.map((row) => row.widgetType);
      },

      /** Widget types per dashboard, in layout order, for gallery thumbnails. */
      async listTypesByDashboard() {
        const db = await getDb();
        return db
          .select({
            dashboardId: dashboardWidgets.dashboardId,
            widgetType: dashboardWidgets.widgetType,
          })
          .from(dashboardWidgets)
          .where(eq(dashboardWidgets.organizationId, org))
          .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));
      },

      /** Widgets across every dashboard, for the setup checklist. */
      async countAll() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(dashboardWidgets)
          .where(eq(dashboardWidgets.organizationId, org));
        return row?.value ?? 0;
      },

      async countFor(dashboardId: string) {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(dashboardWidgets)
          .where(
            and(
              eq(dashboardWidgets.dashboardId, dashboardId),
              eq(dashboardWidgets.organizationId, org),
            ),
          );
        return row?.value ?? 0;
      },

      /** Next free row on the canvas, so a new widget never lands on top. */
      async nextY(dashboardId: string) {
        const rows = await this.listFor(dashboardId);
        return rows.reduce(
          (acc, w) => Math.max(acc, w.layoutY + w.layoutH),
          0,
        );
      },

      async get(dashboardId: string, widgetId: string) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(dashboardWidgets)
          .where(ownWidget(dashboardId, widgetId))
          .limit(1);
        return row ?? null;
      },

      async add(input: {
        dashboardId: string;
        widgetType: string;
        title: string;
        configJson: string;
        connectionId?: string | null;
        layoutY: number;
        layoutW: number;
        layoutH: number;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(dashboardWidgets)
          .values({
            id: createId("wdg"),
            organizationId: org,
            dashboardId: input.dashboardId,
            widgetType: input.widgetType,
            title: input.title,
            configJson: input.configJson,
            connectionId: input.connectionId ?? null,
            layoutX: 0,
            layoutY: input.layoutY,
            layoutW: input.layoutW,
            layoutH: input.layoutH,
          })
          .returning();
        return row;
      },

      /**
       * Change what a widget shows: its heading, which connection feeds it, and
       * its own options.
       *
       * Every field is optional and only the ones present are written, so the
       * settings dialog can save one control without having to send back the
       * rest of the widget's state.
       */
      async update(
        dashboardId: string,
        widgetId: string,
        input: {
          title?: string | null;
          connectionId?: string | null;
          configJson?: string;
        },
      ) {
        const db = await getDb();
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ("title" in input) patch.title = input.title;
        if ("connectionId" in input) patch.connectionId = input.connectionId;
        if ("configJson" in input) patch.configJson = input.configJson;

        const [row] = await db
          .update(dashboardWidgets)
          .set(patch)
          .where(ownWidget(dashboardId, widgetId))
          .returning();
        return row ?? null;
      },

      /**
       * Layout writes are filtered by dashboard *and* organization, so a widget
       * id belonging to another dashboard (or another tenant) silently matches
       * nothing instead of being moved.
       */
      async saveLayouts(
        dashboardId: string,
        layouts: Array<{ i: string; x: number; y: number; w: number; h: number }>,
      ) {
        const db = await getDb();
        const now = new Date();
        let updated = 0;
        for (const item of layouts) {
          const rows = await db
            .update(dashboardWidgets)
            .set({
              layoutX: item.x,
              layoutY: item.y,
              layoutW: item.w,
              layoutH: item.h,
              updatedAt: now,
            })
            .where(ownWidget(dashboardId, item.i))
            .returning({ id: dashboardWidgets.id });
          updated += rows.length;
        }
        return updated;
      },

      async remove(dashboardId: string, widgetId: string) {
        const db = await getDb();
        const rows = await db
          .delete(dashboardWidgets)
          .where(ownWidget(dashboardId, widgetId))
          .returning({ id: dashboardWidgets.id });
        return rows.length > 0;
      },
    },

    connections: {
      async list() {
        const db = await getDb();
        return db
          .select()
          .from(connections)
          .where(eq(connections.organizationId, org))
          .orderBy(desc(connections.updatedAt));
      },

      async get(id: string) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(connections)
          .where(ownConnection(id))
          .limit(1);
        return row ?? null;
      },

      async count() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(connections)
          .where(eq(connections.organizationId, org));
        return row?.value ?? 0;
      },

      /**
       * The connection this tenant uses for a provider. Previously this read
       * the first matching row in the entire database, which in a multi-tenant
       * deployment would hand one customer another customer's credentials.
       */
      async byProvider(provider: Provider) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.provider, provider),
              eq(connections.organizationId, org),
            ),
          )
          .orderBy(asc(connections.createdAt))
          .limit(1);
        return row ?? null;
      },

      /**
       * Every connection this tenant has for a provider, oldest first.
       *
       * The oldest is the default a widget with no explicit connection reads,
       * which is what keeps a canvas built before a second account was added
       * pointing at the same numbers it always did.
       */
      async listByProvider(provider: Provider) {
        const db = await getDb();
        return db
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.provider, provider),
              eq(connections.organizationId, org),
            ),
          )
          .orderBy(asc(connections.createdAt));
      },

      async create(input: {
        provider: Provider;
        label: string;
        credentialsEncrypted: string;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(connections)
          .values({
            id: createId("con"),
            organizationId: org,
            provider: input.provider,
            label: input.label,
            credentialsEncrypted: input.credentialsEncrypted,
            status: "unknown",
          })
          .returning();
        return row;
      },

      /**
       * Replacing credentials revives a connection whose sync had been
       * disabled after repeated failures: the whole point of pasting a new
       * token is that the old one was the problem.
       */
      async update(
        id: string,
        input: { label: string; credentialsEncrypted: string },
      ) {
        const db = await getDb();
        const [row] = await db
          .update(connections)
          .set({
            label: input.label,
            credentialsEncrypted: input.credentialsEncrypted,
            status: "unknown",
            lastError: null,
            syncEnabled: true,
            consecutiveFailures: 0,
            nextSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(ownConnection(id))
          .returning();
        return row ?? null;
      },

      async recordTest(
        id: string,
        result: { status: ConnectionStatus; error: string | null },
      ) {
        const db = await getDb();
        await db
          .update(connections)
          .set({
            status: result.status,
            lastError: result.error,
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(ownConnection(id));
      },

      async remove(id: string) {
        const db = await getDb();
        const rows = await db
          .delete(connections)
          .where(ownConnection(id))
          .returning({ id: connections.id });
        return rows.length > 0;
      },
    },

    members: {
      /** The people in this organization, with the account behind each seat. */
      async list() {
        const db = await getDb();
        return db
          .select({
            id: member.id,
            userId: member.userId,
            role: member.role,
            createdAt: member.createdAt,
            name: user.name,
            email: user.email,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.organizationId, org))
          .orderBy(asc(member.createdAt));
      },

      /** Invitations still awaiting an answer, newest first. */
      async listPendingInvitations() {
        const db = await getDb();
        return db
          .select({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            createdAt: invitation.createdAt,
          })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, org),
              eq(invitation.status, "pending"),
            ),
          )
          .orderBy(desc(invitation.createdAt));
      },

      /**
       * Remove someone from the organization.
       *
       * Refuses to remove the last owner: an organization with no owner has
       * nobody who can invite, bill or delete it, and there is no support desk
       * behind a self-hosted install to undo it.
       */
      async removeMember(memberId: string) {
        const db = await getDb();
        const [target] = await db
          .select({ id: member.id, role: member.role, userId: member.userId })
          .from(member)
          .where(and(eq(member.id, memberId), eq(member.organizationId, org)))
          .limit(1);
        if (!target) return { ok: false as const, reason: "not_found" as const };

        if (target.role === "owner") {
          // An admin may manage the team, not take it over from its owners.
          if (ctx.role !== "owner") {
            return { ok: false as const, reason: "forbidden" as const };
          }
          const [owners] = await db
            .select({ value: count() })
            .from(member)
            .where(
              and(eq(member.organizationId, org), eq(member.role, "owner")),
            );
          if ((owners?.value ?? 0) <= 1) {
            return { ok: false as const, reason: "last_owner" as const };
          }
        }

        /*
         * Removing the membership row is not enough on its own. The person's
         * sessions still name this organization, and API tokens they minted
         * act for it with no person behind them at all — so both go with
         * them, in the same transaction, or neither does.
         */
        await db.transaction(async (tx) => {
          await tx
            .delete(member)
            .where(and(eq(member.id, memberId), eq(member.organizationId, org)));
          await tx
            .delete(session)
            .where(
              and(
                eq(session.userId, target.userId),
                eq(session.activeOrganizationId, org),
              ),
            );
          await tx
            .update(apiTokens)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(apiTokens.organizationId, org),
                eq(apiTokens.userId, target.userId),
                isNull(apiTokens.revokedAt),
              ),
            );
        });
        return { ok: true as const };
      },

      /** The caller's own role, for hiding controls they cannot use. */
      async roleOf(userId: string) {
        const db = await getDb();
        const [row] = await db
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.organizationId, org), eq(member.userId, userId)))
          .limit(1);
        return row?.role ?? null;
      },

      /** Seats in use: members plus invitations still awaiting acceptance. */
      async countSeats() {
        const db = await getDb();
        const [members] = await db
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, org));
        const [pending] = await db
          .select({ value: count() })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, org),
              eq(invitation.status, "pending"),
            ),
          );
        return (members?.value ?? 0) + (pending?.value ?? 0);
      },
    },

    snapshots: snapshotRepo(org),

    shares: {
      async listFor(dashboardId: string) {
        const db = await getDb();
        return db
          .select()
          .from(dashboardShares)
          .where(
            and(
              eq(dashboardShares.dashboardId, dashboardId),
              eq(dashboardShares.organizationId, org),
            ),
          )
          .orderBy(desc(dashboardShares.createdAt));
      },

      /** Live links across every dashboard, for the count in settings. */
      async countActive() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(dashboardShares)
          .where(
            and(
              eq(dashboardShares.organizationId, org),
              isNull(dashboardShares.revokedAt),
            ),
          );
        return row?.value ?? 0;
      },

      async create(input: {
        dashboardId: string;
        tokenHash: string;
        tokenPrefix: string;
        label: string | null;
        whiteLabel: boolean;
        expiresAt: Date | null;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(dashboardShares)
          .values({
            id: createId("shr"),
            organizationId: org,
            dashboardId: input.dashboardId,
            tokenHash: input.tokenHash,
            tokenPrefix: input.tokenPrefix,
            label: input.label,
            whiteLabel: input.whiteLabel,
            expiresAt: input.expiresAt,
            createdBy: ctx.userId,
          })
          .returning();
        return row;
      },

      /**
       * Revoking is a timestamp, not a delete: the row is what says a link
       * *was* live and how often it was opened, which is exactly what someone
       * wants to know at the moment they revoke it.
       */
      async revoke(id: string) {
        const db = await getDb();
        const [row] = await db
          .update(dashboardShares)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(dashboardShares.id, id),
              eq(dashboardShares.organizationId, org),
              isNull(dashboardShares.revokedAt),
            ),
          )
          .returning();
        return row ?? null;
      },
    },

    channels: {
      async list() {
        const db = await getDb();
        return db
          .select()
          .from(notificationChannels)
          .where(eq(notificationChannels.organizationId, org))
          .orderBy(asc(notificationChannels.createdAt));
      },

      async get(id: string) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(notificationChannels)
          .where(
            and(
              eq(notificationChannels.id, id),
              eq(notificationChannels.organizationId, org),
            ),
          )
          .limit(1);
        return row ?? null;
      },

      async create(input: {
        kind: NotificationChannelKind;
        label: string;
        targetEncrypted: string;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(notificationChannels)
          .values({
            id: createId("nch"),
            organizationId: org,
            kind: input.kind,
            label: input.label,
            targetEncrypted: input.targetEncrypted,
          })
          .returning();
        return row;
      },

      async update(
        id: string,
        input: {
          label?: string;
          targetEncrypted?: string;
          enabled?: boolean;
        },
      ) {
        const db = await getDb();
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (input.label !== undefined) patch.label = input.label;
        if (input.targetEncrypted !== undefined) {
          patch.targetEncrypted = input.targetEncrypted;
          // New target, clean slate: the stored error described the old one.
          patch.lastError = null;
        }
        if (input.enabled !== undefined) patch.enabled = input.enabled;

        const [row] = await db
          .update(notificationChannels)
          .set(patch)
          .where(
            and(
              eq(notificationChannels.id, id),
              eq(notificationChannels.organizationId, org),
            ),
          )
          .returning();
        return row ?? null;
      },

      /**
       * Stamp the outcome of a delivery attempt on the channel.
       *
       * Shared by the drainer and the test-send button, so a channel's status
       * means the same thing however it was last exercised.
       */
      async recordTest(
        id: string,
        result: { ok: boolean; error?: string },
      ) {
        const db = await getDb();
        await db
          .update(notificationChannels)
          .set(
            result.ok
              ? { lastDeliveredAt: new Date(), lastError: null }
              : { lastError: result.error ?? "Delivery failed" },
          )
          .where(
            and(
              eq(notificationChannels.id, id),
              eq(notificationChannels.organizationId, org),
            ),
          );
      },

      async remove(id: string) {
        const db = await getDb();
        const rows = await db
          .delete(notificationChannels)
          .where(
            and(
              eq(notificationChannels.id, id),
              eq(notificationChannels.organizationId, org),
            ),
          )
          .returning({ id: notificationChannels.id });
        return rows.length > 0;
      },
    },

    alertRules: {
      /** Rules with the connection they watch, for the management screen. */
      async list() {
        const db = await getDb();
        return db
          .select({
            id: alertRules.id,
            connectionId: alertRules.connectionId,
            metric: alertRules.metric,
            comparator: alertRules.comparator,
            threshold: alertRules.threshold,
            channelIdsJson: alertRules.channelIdsJson,
            enabled: alertRules.enabled,
            cooldownMinutes: alertRules.cooldownMinutes,
            lastState: alertRules.lastState,
            lastValue: alertRules.lastValue,
            lastEvaluatedAt: alertRules.lastEvaluatedAt,
            lastNotifiedAt: alertRules.lastNotifiedAt,
            mutedUntil: alertRules.mutedUntil,
            createdAt: alertRules.createdAt,
            provider: connections.provider,
            connectionLabel: connections.label,
          })
          .from(alertRules)
          .innerJoin(connections, eq(alertRules.connectionId, connections.id))
          .where(eq(alertRules.organizationId, org))
          .orderBy(desc(alertRules.createdAt));
      },

      async count() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(alertRules)
          .where(eq(alertRules.organizationId, org));
        return row?.value ?? 0;
      },

      async get(id: string) {
        const db = await getDb();
        const [row] = await db
          .select()
          .from(alertRules)
          .where(
            and(eq(alertRules.id, id), eq(alertRules.organizationId, org)),
          )
          .limit(1);
        return row ?? null;
      },

      async create(input: {
        connectionId: string;
        metric: string;
        comparator: AlertComparator;
        threshold: string;
        channelIds: string[];
        cooldownMinutes: number;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(alertRules)
          .values({
            id: createId("alr"),
            organizationId: org,
            connectionId: input.connectionId,
            metric: input.metric,
            comparator: input.comparator,
            threshold: input.threshold,
            channelIdsJson: JSON.stringify(input.channelIds),
            cooldownMinutes: input.cooldownMinutes,
            createdBy: ctx.userId,
          })
          .returning();
        return row;
      },

      async update(
        id: string,
        input: {
          comparator?: AlertComparator;
          threshold?: string;
          channelIds?: string[];
          enabled?: boolean;
          cooldownMinutes?: number;
          mutedUntil?: Date | null;
        },
      ) {
        const db = await getDb();
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (input.comparator !== undefined) patch.comparator = input.comparator;
        if (input.threshold !== undefined) {
          patch.threshold = input.threshold;
          // A new threshold describes a different question, so the old verdict
          // must not suppress the first notification under the new one.
          patch.lastState = null;
        }
        if (input.channelIds !== undefined) {
          patch.channelIdsJson = JSON.stringify(input.channelIds);
        }
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (input.cooldownMinutes !== undefined) {
          patch.cooldownMinutes = input.cooldownMinutes;
        }
        if ("mutedUntil" in input) patch.mutedUntil = input.mutedUntil;

        const [row] = await db
          .update(alertRules)
          .set(patch)
          .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, org)))
          .returning();
        return row ?? null;
      },

      async remove(id: string) {
        const db = await getDb();
        const rows = await db
          .delete(alertRules)
          .where(and(eq(alertRules.id, id), eq(alertRules.organizationId, org)))
          .returning({ id: alertRules.id });
        return rows.length > 0;
      },
    },

    alertEvents: {
      async list(limit = 50) {
        const db = await getDb();
        return db
          .select({
            id: alertEvents.id,
            ruleId: alertEvents.ruleId,
            state: alertEvents.state,
            value: alertEvents.value,
            message: alertEvents.message,
            deliveriesJson: alertEvents.deliveriesJson,
            acknowledgedAt: alertEvents.acknowledgedAt,
            createdAt: alertEvents.createdAt,
            metric: alertRules.metric,
            provider: connections.provider,
            connectionLabel: connections.label,
          })
          .from(alertEvents)
          .innerJoin(alertRules, eq(alertEvents.ruleId, alertRules.id))
          .innerJoin(connections, eq(alertRules.connectionId, connections.id))
          .where(eq(alertEvents.organizationId, org))
          .orderBy(desc(alertEvents.createdAt))
          .limit(limit);
      },

      /** Unacknowledged breaches — the number on the sidebar's Alerts item. */
      async unacknowledgedCount() {
        const db = await getDb();
        const [row] = await db
          .select({ value: count() })
          .from(alertEvents)
          .where(
            and(
              eq(alertEvents.organizationId, org),
              eq(alertEvents.state, "breached"),
              isNull(alertEvents.acknowledgedAt),
            ),
          );
        return row?.value ?? 0;
      },

      async acknowledge(id: string) {
        const db = await getDb();
        const [row] = await db
          .update(alertEvents)
          .set({ acknowledgedAt: new Date() })
          .where(
            and(eq(alertEvents.id, id), eq(alertEvents.organizationId, org)),
          )
          .returning();
        return row ?? null;
      },

      async acknowledgeAll() {
        const db = await getDb();
        const rows = await db
          .update(alertEvents)
          .set({ acknowledgedAt: new Date() })
          .where(
            and(
              eq(alertEvents.organizationId, org),
              isNull(alertEvents.acknowledgedAt),
            ),
          )
          .returning({ id: alertEvents.id });
        return rows.length;
      },
    },

    apiTokens: {
      /** Never returns the hash: nothing in the UI has a use for it. */
      async list() {
        const db = await getDb();
        return db
          .select({
            id: apiTokens.id,
            name: apiTokens.name,
            tokenPrefix: apiTokens.tokenPrefix,
            scope: apiTokens.scope,
            expiresAt: apiTokens.expiresAt,
            revokedAt: apiTokens.revokedAt,
            lastUsedAt: apiTokens.lastUsedAt,
            createdAt: apiTokens.createdAt,
          })
          .from(apiTokens)
          .where(eq(apiTokens.organizationId, org))
          .orderBy(desc(apiTokens.createdAt));
      },

      async create(input: {
        name: string;
        tokenHash: string;
        tokenPrefix: string;
        scope: ApiTokenScope;
        expiresAt: Date | null;
      }) {
        const db = await getDb();
        const [row] = await db
          .insert(apiTokens)
          .values({
            id: createId("tok"),
            organizationId: org,
            userId: ctx.userId,
            name: input.name,
            tokenHash: input.tokenHash,
            tokenPrefix: input.tokenPrefix,
            scope: input.scope,
            expiresAt: input.expiresAt,
          })
          .returning();
        return row;
      },

      async revoke(id: string) {
        const db = await getDb();
        const [row] = await db
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(apiTokens.id, id),
              eq(apiTokens.organizationId, org),
              isNull(apiTokens.revokedAt),
            ),
          )
          .returning();
        return row ?? null;
      },
    },

    cache: cacheRepo(org),
  };
}

/**
 * Snapshot reads, by provider or by connection.
 *
 * Split into its own factory because the alert evaluator needs it outside a
 * request — there is no session behind a worker tick — while still going
 * through the same organization filter as everything else.
 */
export function snapshotRepo(org: string) {
  const shape = {
    payloadJson: connectionSnapshots.payloadJson,
    fetchedAt: connectionSnapshots.fetchedAt,
    connectionId: connections.id,
    connectionLabel: connections.label,
    provider: connections.provider,
    syncEnabled: connections.syncEnabled,
    lastError: connections.lastError,
    consecutiveFailures: connections.consecutiveFailures,
  };

  type Row = {
    payloadJson: string | null;
    fetchedAt: Date | null;
    connectionId: string;
    connectionLabel: string;
    provider: Provider;
    syncEnabled: boolean;
    lastError: string | null;
    consecutiveFailures: number;
  };

  const hydrate = (row: Row) => ({
    connectionId: row.connectionId,
    connectionLabel: row.connectionLabel,
    provider: row.provider,
    payload: row.payloadJson
      ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
      : null,
    fetchedAt: row.fetchedAt,
    syncEnabled: row.syncEnabled,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
  });

  /**
   * Snapshots are left-joined so a connection with no payload yet still
   * resolves — a source connected seconds ago must read as "connected, no data
   * yet" rather than as not connected at all.
   *
   * Boxed in an object because `await` unwraps thenables recursively, and a
   * Drizzle query builder is thenable: returning one straight out of an async
   * function would run the query at the `await` instead of handing back
   * something still open to `.where()`.
   */
  const base = async () => {
    const db = await getDb();
    return {
      query: db
        .select(shape)
        .from(connections)
        .leftJoin(
          connectionSnapshots,
          and(
            eq(connectionSnapshots.connectionId, connections.id),
            eq(connectionSnapshots.kind, "dashboard"),
          ),
        ),
    };
  };

  return {
    /**
     * The default connection's snapshot for a provider: the oldest one, which
     * is what a widget with no explicit connection has always read.
     */
    async forProvider(provider: Provider) {
      const { query } = await base();
      const [row] = await query
        .where(
          and(
            eq(connections.provider, provider),
            eq(connections.organizationId, org),
          ),
        )
        .orderBy(asc(connections.createdAt))
        .limit(1);
      return row ? hydrate(row) : null;
    },

    /** One specific connection, when a widget names it. */
    async forConnection(connectionId: string) {
      const { query } = await base();
      const [row] = await query
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.organizationId, org),
          ),
        )
        .limit(1);
      return row ? hydrate(row) : null;
    },

    /** Every connection's snapshot, for cross-source widgets. */
    async listAll() {
      const { query } = await base();
      const rows = await query
        .where(eq(connections.organizationId, org))
        .orderBy(asc(connections.createdAt));
      return rows.map(hydrate);
    },
  };
}

export type SnapshotRepo = ReturnType<typeof snapshotRepo>;
export type ConnectionSnapshotView = NonNullable<
  Awaited<ReturnType<SnapshotRepo["forProvider"]>>
>;

export type TenantRepos = ReturnType<typeof forTenant>;

const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

/** Drop expired rows at most once per minute, off the read hot path. */
async function sweepExpired() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const db = await getDb();
  await db
    .delete(connectionCache)
    .where(lt(connectionCache.expiresAt, new Date(now)));
}

function cacheRepo(org: string) {
  async function readRow<T>(cacheKey: string) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(connectionCache)
      .where(
        and(
          eq(connectionCache.cacheKey, cacheKey),
          eq(connectionCache.organizationId, org),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      payload: JSON.parse(row.payloadJson) as T,
      expired: row.expiresAt < new Date(),
    };
  }

  async function set(cacheKey: string, payload: unknown, ttlSeconds: number) {
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const payloadJson = JSON.stringify(payload);

    await db
      .insert(connectionCache)
      .values({
        id: createId("cch"),
        organizationId: org,
        cacheKey,
        payloadJson,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [connectionCache.organizationId, connectionCache.cacheKey],
        set: { payloadJson, expiresAt },
      });
  }

  return {
    set,

    async get<T>(cacheKey: string): Promise<T | null> {
      await sweepExpired();
      const row = await readRow<T>(cacheKey);
      return row && !row.expired ? row.payload : null;
    },

    /**
     * Read-through cache. A fresh hit is returned as-is; a miss awaits the
     * fetch.
     *
     * Note the deliberate absence of stale-while-revalidate: the previous
     * implementation kicked off an un-awaited background refresh, which a
     * serverless runtime is free to freeze the moment the response is sent, so
     * the refresh silently never landed. Phase 2 replaces this with a
     * background sync worker; until then a stale entry is refreshed inline.
     */
    async fetch<T>(
      cacheKey: string,
      ttlSeconds: number,
      fetcher: () => Promise<T>,
    ): Promise<{ data: T; cached: boolean }> {
      await sweepExpired();
      const row = await readRow<T>(cacheKey);
      if (row && !row.expired) {
        return { data: row.payload, cached: true };
      }

      try {
        const data = await fetcher();
        await set(cacheKey, data, ttlSeconds);
        return { data, cached: false };
      } catch (error) {
        // Serving a stale payload beats showing an error for a transient blip.
        if (row) return { data: row.payload, cached: true };
        throw error;
      }
    },
  };
}
