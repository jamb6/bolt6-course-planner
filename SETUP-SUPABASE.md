# Sharing the workspace

Out of the box the planner keeps everything in `localStorage` — one browser,
one machine, nothing shared. Pointing it at Supabase puts courses, plans and
kits in one Postgres database that the whole team reads and writes.

Roughly fifteen minutes.

---

## 1. Make a project

supabase.com → New project. Pick a region near the people using it, not near
the events. Note the database password somewhere safe; you will not need it for
this, but you will eventually.

## 2. Run the schema

Open **SQL Editor**, paste all of `supabase/schema.sql`, run it.

It creates four tables (`kit`, `course`, `plan`, `plan_entity`), the indexes,
an `updated_at`/`updated_by` trigger on each, row-level security, and one
starter kit. It is safe to run again — every statement is create-if-not-exists
or drop-then-create, and re-running it will not touch your data.

I ran this against a real Postgres 16 before shipping it, twice, and exercised
it with rows. It is not theoretical SQL.

## 3. Wire up the app

You need two values: the **Project URL** and the **public API key**.

The quickest way to both is the **Connect** button at the top of the project
dashboard — it shows them together, ready to paste. Otherwise they are under
**Settings → API Keys** (this page used to be called "API"):

```
https://supabase.com/dashboard/project/_/settings/api-keys
```

**Two key formats exist**, and which you are shown depends on when the project
was created:

| | Public — belongs in the browser | Secret — never in the browser |
|---|---|---|
| Current | `sb_publishable_...` | `sb_secret_...` |
| Legacy | `anon`, a long `eyJ...` JWT | `service_role` |

Either public key works; `createClient` accepts both. A project made today will
most likely offer the publishable one, and Supabase is retiring the legacy
`anon`/`service_role` pair by the end of 2026, so prefer publishable if you are
given the choice.

```powershell
Copy-Item .env.example .env      # PowerShell;  cp .env.example .env  elsewhere
```

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...        # or eyJhbGciOi... on a legacy project
```

The public key in the browser is fine — that is what it is for, and row-level
security is what actually protects the data. **Never put `sb_secret_...` or
`service_role` here.** Those bypass every policy, and anyone who opened the page
could read or delete the whole database.

The legacy JWT is long enough to truncate when copying. Check the last few
characters match what the dashboard shows.

Vite reads `.env` only at startup, so stop `npm run dev` with Ctrl+C and start
it again — a hot reload will not pick it up. The app will then ask you to sign
in.

## 4. Let people in

Sign-in is **email and password**, and accounts are created by you rather than
signed up for in the app. That is deliberate: it keeps email out of the
critical path. Supabase's built-in email service sends only 2 messages an hour
and will only deliver to your own project team, so magic links cannot work for
a team without paying for an SMTP provider — and waiting for an email over
course wifi is a poor way to start an event day anyway.

**Authentication → Providers → Email** — on. Turn **Confirm email off**, so an
account you create works immediately instead of waiting on a confirmation
message nobody will receive.

**Authentication → Users → Add user** for each person:

- their email
- a password — anything reasonable; they can change it in the app under Kits
- tick **Auto Confirm User**

That is the whole flow. There is no sign-up screen and no password reset by
email; if someone is locked out you reset their password in this same panel.

Leave **Enable sign-ups** off. With it on, anyone who reaches the URL could
create themselves an account and edit or delete plans.

## 5. Bring your existing work across

Whatever you built before this lives in your browser. **Kits → Import this
browser's old data** pushes your courses, plans and kits into the shared
workspace. Do it once, from the browser that has the work — running it again
is harmless but pointless.

Everyone else can skip it.

---

## Smoke test

Worth ten minutes before anyone relies on it, because I could not run this end
to end myself — see the note at the bottom.

1. Sign in with an account you created. You should land on the course list,
   seeded with the 2027 schedule.
2. **Table Editor → course** — 32 rows. If it is empty, the seed did not run;
   check the browser console for a policy error.
3. Make a plan, place three cameras, draw a cable.
4. **Table Editor → plan_entity** — four rows, `kind` and `hole` filled in by
   the generated columns. The `data` column holds the whole entity.
5. Move one camera. Watch that row's `updated_at` change and **nobody else's**.
   That is the per-entity write working.
6. Sign in on a second machine or a private window. The plan should be there.
7. Have both people add a camera to different holes, then hit **Refresh** on
   the plan list. Both cameras should survive. Neither should lose work.

If step 7 loses something, stop and tell me.

---

## What this does and does not give you

**Does:** one shared set of courses, plans and kits; writes that do not clobber
each other, because each camera, cable, switch and marker is its own row; an
audit trail of sorts, since every row carries `updated_at` and `updated_by`;
and free backups on Supabase's paid tiers.

**Does not:**

- **Live updates.** You see other people's changes when you reopen a plan or
  press Refresh, not as they happen. That was the deliberate choice — realtime
  is a websocket subscription away if it starts to bite.
- **Roles.** Anyone signed in can edit anything, including deleting plans.
  There is no viewer/editor split yet.
- **Offline.** If the network is down, writes fail. The app tells you and keeps
  the work queued in memory to retry, but close the tab and it is gone. This
  matters on a golf course, and it is the next thing worth building.
- **Conflict resolution.** Two people editing *the same camera* within a second
  of each other still means last-write-wins on that one row. Different
  entities, different holes, different plans are all safe.

---

## A note on what I verified

I ran the schema against a real Postgres 16 and exercised it with data. The
driver code, the per-entity write batching and the fallback to localStorage are
covered by the test suites — 122 assertions, all passing.

What I could **not** do is run the app against an actual Supabase project:
there is no project to point at from here, and no credentials. So the network
path — auth, the REST calls, the redirect flow — is written carefully and
reviewed, but unproven. The smoke test above is how you close that gap, and it
is worth doing before an event rather than during one.
