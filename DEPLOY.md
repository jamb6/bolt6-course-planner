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

Deploy. You get `bolt6-course-planner.pages.dev`, and every push to `main`
rebuilds it.

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

Sign-in links bounce without this, and the failure looks like nothing
happening, so it is worth getting right first time.

## 5. Decide who can sign in

Right now anyone who can receive a magic link gets into the workspace and can
edit or delete anything. Before you share the URL, narrow it in Supabase — not
in the app:

- **Authentication → Providers → Email**: turn **off** "Enable sign-ups" once
  the team has accounts, and invite people from **Authentication → Users**.
- Or leave sign-ups on and restrict by email domain.

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

Delete the workflow if you use the git integration; running both just deploys
twice.

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
