<p align="center">
  <img src="public/git-header.png" alt="Bussola — finally a beautiful dashboard" width="100%" />
</p>

Local-first, plug-and-play dashboard for connecting infrastructure and finance sources into customizable canvases.

Alerts when a number crosses a line, read-only links for people without an
account, and an MCP server so an assistant can read it all.

**Connectors:** Railway · Vercel · Netlify · Supabase · Sentry · Stripe · Lemon Squeezy · Resend · Qonto  
**Stack:** Next.js · TypeScript · Tailwind v4 · shadcn/ui · Tremor Raw · Postgres

<p align="center">
  <img src="public/git-main.png" alt="Bussola — opensource, secure, fast. Beautiful & truly yours." width="100%" />
</p>

## Quick start

```bash
npm install
cp .env.example .env.local
# optional but recommended:
# openssl rand -hex 32  →  set as BUSSOLA_ENCRYPTION_KEY

npm run dev
```

The database migrates itself on first start, so there is nothing to run first.
(`npm run db:migrate` exists for hosted deployments, where migrating is an
explicit deploy step rather than something several instances race to do.)

Open [http://localhost:3000](http://localhost:3000), claim the instance with an
account only you hold, then:

1. **Connections** — paste API tokens for Railway / Netlify / Supabase / Qonto
2. **Dashboards** — create a canvas
3. **Edit** — drag, resize, and add Tremor trackers + KPI blocks
4. **Widget settings** — point a block at one account, narrow it to one
   project, trim a chart to a window
5. **Alerts** — say when a number counts as a problem, and where to be told
6. **Share** — hand someone a read-only link to a canvas

Until a source is connected, widgets render clearly-labelled sample data rather
than empty boxes, so you can see what each one does before pasting any token.

## Database

Bussola speaks Postgres, and only Postgres — one schema, one migration set, the
same queries whether you run it on a laptop or host it for others.

**No `DATABASE_URL`** (the default): the app runs on
[PGlite](https://pglite.dev), Postgres compiled to WASM, stored under
`./data/pgdata`. No server, no Docker, nothing to install. PGlite is
single-process by design — perfect for one person, not for a shared instance.

**With `DATABASE_URL`**: any Postgres server. Use this the moment more than one
person depends on the install.

```bash
docker compose up -d db
export DATABASE_URL=postgres://bussola:bussola@localhost:5432/bussola
npm run db:migrate
```

Schema changes go through Drizzle: edit `src/lib/db/schema.ts`, run
`npm run db:generate`, commit the SQL in `drizzle/`.

## Editions

The same codebase runs in two modes, selected by `BUSSOLA_EDITION`.

| | `self-hosted` (default) | `cloud` |
|---|---|---|
| Tenancy | one organization, created on first signup | one per customer |
| Sign-in | email + password, one account | email + password, open signup |
| Database | PGlite or your own Postgres | managed Postgres, required |
| Secrets | fall back to local dev values | `DATABASE_URL`, `BUSSOLA_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` required |
| Billing | none, everything unlocked | Stripe checkout, portal, webhook |

This is not two builds. Every query against tenant-owned data goes through the
organization-scoped repositories in `src/lib/db/tenant.ts`, in both editions —
so the self-hosted path exercises the very isolation code that keeps hosted
customers apart, and ESLint refuses to compile a route handler that reaches
around it.

## Configuration

Every environment variable is listed, with its default, in `.env.example`, and
declared with its type in `src/lib/env.ts` — the one module that reads them.
The server validates them all at startup: a value that is set but malformed,
or anything the cloud edition requires that is missing, stops it with a
message naming the variable rather than failing later on some request. Empty
values count as unset, so a copy of `.env.example` is a valid configuration.

Logs are structured: one JSON object per line in production, a readable line
in development (`BUSSOLA_LOG_FORMAT` overrides either), from `info` up unless
`BUSSOLA_LOG_LEVEL` says otherwise.

## Auth

Identity runs on [Better Auth](https://better-auth.com), inside the app and on
the same Postgres as everything else — no external identity provider, so the
hosted and self-hosted editions run the *same* auth code rather than two
implementations.

Self-hosted accepts exactly one account: the first person to reach `/signup`
claims the instance, and every later attempt is refused. Cloud leaves signup
open, and each account gets its own organization the moment it is created.

## How data gets fetched

Widgets never trigger a provider call. A background worker refreshes each
connection on its own schedule and writes a snapshot; every widget request is
then a single local query. Upstream traffic scales with the number of
**connections**, not with how many people are looking at a dashboard — which is
what keeps a shared deployment from being rate-limited (or banned) by Railway,
Netlify, Supabase and especially Qonto.

Each connection carries its own schedule. A failing one backs off exponentially
to at most hourly, and after ten consecutive failures it stops being synced
altogether and the widget asks its owner to reconnect — a revoked token stops
generating traffic instead of being retried forever. Pasting new credentials
clears the failure count and resumes immediately.

Where the worker runs depends on the deployment:

| Deployment | How |
|---|---|
| Self-hosted (one Next server) | Automatic, in-process via `instrumentation.ts` |
| Separate process / container | `npm run worker`, plus `BUSSOLA_DISABLE_INLINE_SYNC=1` |
| Serverless with cron | `POST /api/internal/sync` with `BUSSOLA_SYNC_SECRET` |

The last two rows require `DATABASE_URL`. PGlite serves exactly one process, so
a worker started next to the app server would open the same directory a second
time and act on a stale view of it — the worker refuses to start rather than do
that quietly. On PGlite, use the in-process scheduler.

Workers claim connections with `FOR UPDATE SKIP LOCKED` and a lease, so several
can run at once without fetching the same connection twice, and a worker that
dies mid-fetch just leaves its connections to become due again.

The one exception is the Qonto transactions list: it is cursor-paginated and
user-driven, so it reads through to the API behind a short per-tenant cache.

## Several accounts of the same source

A connection is not a provider slot. Connect two Stripe accounts, three
Railway workspaces or a client's Qonto alongside your own, and each widget
picks which one it reads in its settings.

A widget with no connection chosen reads the organization's oldest connection
for its provider — which is what every widget meant before this existed, so
adding a second account never changes what an existing canvas shows. A widget
whose connection is deleted says so rather than silently falling back: two
Stripe accounts answering for each other is worse than a widget admitting it
has lost its source.

Cross-source widgets (the status board) read every connection, capped per
connection so one large account cannot crowd out the rest.

## Widget settings

Each block can be narrowed without touching the data behind it:

| Option | What it does | Offered when |
|---|---|---|
| Title | Renames the block | Always |
| Source | Which connection feeds it | The provider has a connection |
| Show only | One project / service / site / account | The payload has named items |
| Rows | How many rows a list shows | The widget renders a list |
| Time range | Trims a chart to 7 / 14 / 30 / 90 days | The widget plots a series |

Every option is applied to the snapshot the widget already reads — none of
them triggers a different upstream call, because widgets never call a provider
at all. An option is offered only where the stored payload genuinely contains
what it takes to honour it, so nothing on the dialog is a control that quietly
does nothing. The scope list is read from the live payload, so a project
deleted upstream disappears from the options on the next sync.

## Alerts

A rule watches one metric on one connection and fires when it crosses a line.
Roughly thirty metrics across every live provider — crashed services, failed
deploys, unresolved issues, security advisors, MRR, cash balance, delivery
rate, build minutes — all read from the snapshot the worker already stored, so
an alert costs no extra upstream traffic.

Evaluation runs immediately after a successful sync rather than on a timer of
its own: a metric can only change when a snapshot does, so that is both the
earliest a rule could fire and the only moment there is anything new to read.

Three rules make it an alert rather than a cron job:

- **Notify on the transition, not the state.** A rule fires when something
  *becomes* broken and again when it stops being broken, not once per sync for
  as long as it stays broken.
- **Cooldown floors a repeat breach, never a recovery.** A flapping value will
  not send a message a minute; "it is fixed" always goes out immediately.
- **A metric the source did not report is not a zero.** A Railway token scoped
  to one project has no billing section; reading that as €0 would fire "spend
  dropped to zero" every hour forever.

Channels are email, Slack and Discord, and every alert is written to the
in-app feed whether or not a channel accepted it — a webhook that has been
deleted loses the message, never the record that the rule fired. A rule with
no channel at all is valid, and shows up on `/alerts`.

**Sending is queued, not inline.** Evaluation is database work and stays on the
sync path, because it needs the snapshot that was just written. Delivery is
someone else's latency, so it goes to an outbox table and is drained by the
scheduler: a webhook hanging for its full ten-second timeout delays the next
tick, never a connection's schedule. Failures retry with backoff — 30s, 2m,
8m, 32m — and are abandoned after five attempts, with the row kept either way.

Every channel has a **Send test** button. A channel is otherwise only proven
the first time something breaks, which is the worst moment to discover a typo
in a webhook URL or an unset mail provider.

Webhook URLs are host-locked at save time (`hooks.slack.com`,
`discord.com`) and encrypted at rest with the same vault as connector
credentials: a webhook URL is a bearer credential, and these fields would
otherwise make the alert engine a request forwarder pointed wherever a tenant
likes.

Email needs `BUSSOLA_EMAIL_FROM` plus a provider key — see `.env.example`.
Unset, the UI says so where email is offered; it never silently fails.

## Sharing

A read-only link to one dashboard, for a client or a co-founder who should not
have an account.

Only the SHA-256 of the token is stored. The link is shown once, at creation,
and is unrecoverable afterwards — a leaked database backup hands out no working
links, which is the property that makes a link safe to paste into a chat
window. A lost link is revoked and replaced rather than looked up.

The shared page renders the same components the owner sees, with edit mode off,
and every request it makes is checked against the token again — on three axes:

- **Which widgets.** The requested type must match a widget on the shared
  dashboard, so a link to a deploy board cannot also answer for the
  organization's Qonto balance.
- **Which connections.** Cross-source widgets are capped to the connections the
  dashboard binds, so a status board cannot enumerate every source connected.
- **Which rows.** The dashboard's own scope, limit and range are applied
  server-side, not in the browser. Filtering client-side is a display
  preference rather than a limit: it ships the hidden rows to the recipient
  and trusts them not to open the network tab.

The boundary is the *union* of what the dashboard's widgets display — an
unfiltered widget widens it to everything, because that widget genuinely
renders everything. Nothing inside the envelope is hidden on the page, so
nothing inside it is a disclosure.

A status board created before this existed carries no connection set, which
used to mean "all". On a share link it now shows only what the dashboard's
other widgets bind, which may be nothing; opening its settings and saving
writes the set out explicitly.

Links carry an optional expiry, count views, and revoke to a timestamp rather
than a delete, so the record of what was shared survives. White-label removes
the Bussola mark for client reporting.

## Rate limits

The two endpoints that answer without a session are metered: share links (by
token, so a link passed around an office is one bucket) and the MCP server (by
API token, with a tighter separate limit on unauthenticated attempts, keyed by
address, since those are credential guessing).

In memory, deliberately. A self-hosted install is one process, so the limit is
exact there — and that is the deployment with no CDN or WAF in front of it. A
replicated cloud deployment gets one window per instance, so the ceiling is
`limit × instances`: weaker than a shared counter, still the difference between
a bounded endpoint and an unbounded one. Swap in Redis behind `rateLimit()` if
you run many instances.

A limiter that writes a row per request would turn "too many requests" into
"too many writes", which is the failure it exists to prevent.

## MCP server

Point an assistant at Bussola and it can read every connector and rearrange
dashboards. The endpoint is `POST /api/mcp`, authenticated with a bearer token
minted under Settings → MCP.

What it cannot do is written into the server rather than into a prompt:

- **No credential ever leaves.** No tool returns one and none accepts one.
  Connecting a source stays something a person does in the web UI.
- **No write reaches a third party.** Everything writable is Bussola's own
  furniture — dashboards and the widgets on them. Nothing restarts a service,
  resolves an issue or moves money, because no such tool exists.
- **Read tokens cannot write.** Enforced at dispatch on the token's scope.
- **Plan limits apply to agents too**, through the same entitlement check the
  web routes use.

Tokens are hashed like share tokens, carry an optional expiry, and are resolved
on every single call — revoking one takes effect on the agent's next request.

```json
{
  "mcpServers": {
    "bussola": {
      "type": "http",
      "url": "https://your-instance/api/mcp",
      "headers": { "Authorization": "Bearer bsk_…" }
    }
  }
}
```

## Team

Cloud and self-hosted both run Better Auth's organization plugin, so members,
roles and invitations are one implementation rather than two.

Inviting sends a link; the invitation is refused before it is sent if it would
take the organization past its seat allowance — far better than letting someone
accept and then bounce off a limit. Accepting checks that the signed-in
account's email matches the address the invitation was addressed to, so a
forwarded link cannot be redeemed by whoever it was forwarded to.

With no mail provider configured, invitations are still created and the link is
shown to copy — a self-hosted install without SMTP is a normal case, not a
broken one.

## Plans

Hosted only. Self-hosted never constructs a Stripe client, never creates a
subscription row, and has no limits — `entitlementsFor()` returns unlimited
before it touches the database, so the billing code is inert rather than
merely unused.

| | Trial | Solo | Team |
|---|---|---|---|
| Price | — | €12/mo · €108/yr | €39/mo · €384/yr |
| Dashboards | 1 | 5 | 20 |
| Widgets per dashboard | 4 | 8 | 12 |
| Connectors | Unlimited | Unlimited | Unlimited |
| Seats | 1 | 1 | 5, then €8/seat |
| History | 7 days | 30 days | 12 months |
| Share links | — | — | Unlimited, white-label |
| Alerts | — | Email | Email · Slack · Discord |
| MCP server | — | Yes | Yes, org-wide config |

Connectors are never rationed: they are the reason to buy Bussola, so the
plans differ on dashboards, widgets, seats and history instead. The trial is
deliberately usable rather than a paywall — enough to connect a source and see
a real dashboard, not enough to run a business on.

Limits are enforced when creating a dashboard, widget or invitation, and
nowhere else: a downgrade never deletes anything a customer already has, it
only stops them adding more. Counts are taken at the moment of the check, so
there is no counter to drift. Over-limit answers 402.

Plans live in `src/lib/billing/plans.ts`. Stripe is the source of truth for
*which* plan is active; that file says what the plan means. Entitlements are
read from a local subscription table the webhook keeps current, never from
Stripe in the request path — so Stripe being down slows nobody's dashboard.

- `POST /api/billing/checkout` — Stripe Checkout for a plan and interval
- `POST /api/billing/portal` — Stripe's own portal for cards, invoices, cancellation
- `POST /api/billing/webhook` — signature-verified, idempotent on Stripe's event
  id so a redelivery cannot apply a plan change twice

A price id we do not recognise resolves to the trial, so a mis-configured
price cannot quietly grant the top tier.

## History

The worker appends one sample per connection per hour, alongside the latest
snapshot it serves reads from. Hourly rather than per-sync: a 60-second
interval would write ~43k rows per connection per month at a resolution nobody
plots. Retention is pruned hourly against each organization's plan, which is
what makes "30 days" and "12 months" true rather than marketing copy.
Self-hosted keeps everything.

## Local private use

- Data lives in `./data/pgdata` (or your `DATABASE_URL` server)
- API secrets are encrypted with AES-256-GCM
- Auth is [Better Auth](https://better-auth.com): email + password, sessions in
  your own database, CSRF-checked, no third-party identity service
- Light / dark theme with the Bussola palette and **Elms Sans**

## Widget catalog

| Widget | Source |
|---|---|
| Service Status | Railway latest deploy status per service |
| Deploy Health | Railway live status + failed deploys since |
| Fleet Health | Railway healthy/total services |
| CPU & Memory | Railway avg resources (last hour) |
| Usage This Cycle | Railway estimated billing-cycle usage |
| Recent Deploys | Railway deployment feed |
| Deploy Health | Vercel deploy trail per project |
| Projects Board | Vercel latest deploy state per project |
| Recent Deploys | Vercel deployment feed |
| Deploy Health | Netlify recent deploy trail |
| Sites Board | Netlify site publish status |
| Sites Health | Netlify ready/total sites |
| Recent Deploys | Netlify deployment feed |
| Build Minutes | Netlify build minutes this period |
| Form Submissions | Netlify Forms submission counts |
| Project Health | Supabase healthy/total projects |
| Projects Board | Supabase project status list |
| Service Health | DB / Auth / Storage / Realtime / Functions |
| API Traffic | Supabase request mix (7 days) |
| Request Volume | Total Supabase API requests (7 days) |
| Security Advisors | Open Supabase security findings |
| Unresolved Issues | Sentry open issues + events in 24h |
| Recent Errors | Sentry newest unresolved issues |
| Projects Board | Sentry projects and whether they report |
| MRR | Stripe monthly recurring revenue |
| Revenue (30d) | Stripe gross volume, last 30 days |
| Recent Payments | Stripe charges and their outcome |
| MRR | Lemon Squeezy recurring revenue |
| Revenue (30d) | Lemon Squeezy store revenue, last 30 days |
| Recent Orders | Lemon Squeezy order feed |
| Sending Domains | Resend domain verification status |
| Recent Emails | Resend sent-email feed |
| Cash Balance | Total cash across Qonto accounts |
| Available Liquidity | Spendable balance after pending |
| 30-Day Net Cashflow | In − out over the last 30 days |
| In vs Out | 30-day inflow / outflow bars |
| Accounts Overview | Pie split of cash by Qonto account |
| Account History | 30-day cash trail (from settled txs) |
| Recent Transactions | Latest bank movements |
| Status Board | Cross-source status list |

Coming soon: GitHub, GitLab, Linear and Notion (OAuth apps), then Polar,
Attio and web traffic.

## Notes

- Qonto accepts `login:secret` as one API key field, or separate login + secret key
- Widget responses come from worker snapshots; see “How data gets fetched”
- Storage is multi-tenant already: every row is owned by an organization, so
  the hosted edition adds accounts and billing rather than a new data model
- Share links, MCP tokens and session cookies are three doors into the same
  tenant-scoped repositories — the credential decides *which* organization, and
  never widens what is visible inside it
