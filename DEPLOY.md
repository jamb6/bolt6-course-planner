# Putting it online

The planner is a static bundle — `npm run build` produces `dist/`, which is
HTML, JS and CSS and nothing else. No server, no container, no Node process to
keep alive. The only backend is Supabase.

That means Cloudflare Pages, which serves it from an edge network. Worth having
for you specifically: the people using this are planning events from Thailand,
Korea, Singapore and Malaysia as often as Florida, and a single-region host is
noticeably slower from that side of the world.

Twenty minutes, most of it waiting for DNS.

---

## 1. Get the code on GitHub

```bash
git init && git add . && git commit -m "Bolt6 course planner"
gh repo create bolt6-course-planner --private --source=. --push
```

Private is fine — Cloudflare reads it with your permission. Check that `.env`
is not in the commit; `.gitignore` already excludes it.

## 2. Connect Cloudflare Pages

dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect
to Git**. Pick the repo, then:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 |

Under **Environment variables**, add all three for **Production** *and*
**Preview**, or preview builds will come up without a map:

```
VITE_MAPBOX_TOKEN       pk.…
VITE_SUPABASE_URL       https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY  sb_publishable_… (or the legacy eyJ… anon key)
```

Leave **Deploy command** empty. Pages builds and publishes by itself; anything
in that field replaces the build step and the deploy fails.

Deploy. You get `bolt6-course-planner.pages.dev`, and every push to `main`
rebuilds it.

A healthy build log runs `npm clean-install`, then `npm run build`, then lists
the `dist/assets/...` files and finishes with "Success: Assets published". If
`wrangler` appears anywhere in it, the build settings did not take.

## 3. Lock the Mapbox token to that domain

The token ends up readable in the JS bundle. That is normal and fine for a
public `pk.` token — but only once it is restricted, or anyone can lift it and
spend your quota.

account.mapbox.com → **Tokens** → your token → **URL restrictions**. Add:

```
https://bolt6-course-planner.pages.dev/*
https://*.bolt6-course-planner.pages.dev/*     ← preview deploys
https://planner.bolt6.com/*                    ← if you add a custom domain
http://localhost:5173/*                        ← local development
```

Scopes should be `styles:read`, `fonts:read`, `tiles:read` and
`geocoding` — nothing else. It never needs a write scope.

## 4. Tell Supabase about the new URL

**Authentication → URL Configuration**:

- **Site URL**: `https://bolt6-course-planner.pages.dev`
- **Redirect URLs**: add that, the `*.pages.dev` preview wildcard, your custom
  domain, and `http://localhost:5173`

Sign-in is email and password, so this matters less than it used to, but
Supabase still uses the Site URL in a few places and it costs nothing to set.

## 5. Decide who can sign in

Accounts are created by you in **Authentication → Users → Add user** (tick Auto
Confirm User). Keep **Enable sign-ups** off, or anyone who reaches the URL can
give themselves an account and delete plans.

## 6. Custom domain, optional

Pages → your project → **Custom domains** → add `planner.bolt6.com`. Cloudflare
gives you a CNAME; the certificate is automatic. Then add it to the Mapbox
restrictions and the Supabase redirect list from steps 3 and 4.

---

## Deploying from GitHub Actions instead

If you would rather not connect the repo to Cloudflare, `.github/workflows/deploy.yml`
does the same thing and runs the test suites first — nothing reaches production
without 122 assertions passing.

It needs five repository secrets: the three `VITE_*` values above plus
`CLOUDFLARE_API_TOKEN` (Pages → Edit permission) and `CLOUDFLARE_ACCOUNT_ID`.

**Use one or the other.** If you connect the repo to Cloudflare, delete the
workflow — otherwise every push deploys twice, and the workflow fails and
emails you until its secrets exist.

## Pages project or Worker?

Cloudflare's current wizard usually creates a **Worker**, not a Pages project,
even though the section is still called "Workers & Pages". The two need
different settings, and the error you get from mixing them up is
*"Missing entry-point to Worker script or to assets directory"*.

Tell them apart by the URL on the Overview tab: `*.workers.dev` is a Worker,
`*.pages.dev` is Pages. Or by the Settings page — a Worker has **Deploy
command** and no **Build output directory**.

**If it is a Worker** (the likely case), `wrangler.jsonc` in this repo tells it
where the built files are. Settings → Build:

| Field | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

The `name` in `wrangler.jsonc` must match the Cloudflare project name.

Workers **does** read `public/_headers`, so the cache rules in it still apply.

It also reads `public/_redirects`, which is why this project no longer has one.
A catch-all `/* /index.html 200` rule is rejected at deploy time with
*"Infinite loop detected in this rule"* — `/index.html` would match its own
rule. `not_found_handling` above does the same job correctly, so the file is
both redundant and fatal. Do not add one back.

**If it is a Pages project**, delete `wrangler.jsonc` — its presence pushes the
wizard down the Workers path. Settings → Build:

| Field | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Deploy command | *(empty)* |

---

## After the first deploy

1. Open the URL in a private window. You should get the sign-in screen, not the
   Mapbox token prompt — the token is baked in now.
2. Sign in. The map should draw. If it does not, the token restriction in step
   3 is usually the cause; the browser console will say so plainly.
3. Have someone else sign in on their own machine and open the same plan. That
   is the thing you have been missing, and it is the only real proof it works.

## What ships

Two JS files and a stylesheet, about 2.3 MB uncompressed and roughly 600 KB
over the wire. Most of that is Mapbox GL itself, which is unavoidable. The
Supabase client is code-split into its own chunk and only downloads when a
shared workspace is configured.

`_headers` caches the fingerprinted assets for a year and keeps `index.html`
uncached, so people get new builds immediately without re-downloading the map
library. `_redirects` serves the app for any path, so a stale bookmark or a
mistyped URL does not 404.

Not set: a Content-Security-Policy. Mapbox GL needs `worker-src blob:` and a
handful of `connect-src` entries, and shipping an untested policy is a good way
to break the map in production. Worth adding once you can verify it against the
real thing.
