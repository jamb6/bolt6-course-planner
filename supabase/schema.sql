-- =============================================================================
-- Bolt6 Course Planner — Supabase schema
--
-- Paste this into the Supabase SQL editor once, on a new project.
-- Safe to re-run: everything is created if-not-exists or replaced.
--
-- Model: one shared Bolt6 workspace. Anyone signed in can read and write
-- everything — that is the point, the whole team plans the same events. If you
-- later need separate orgs, add an org_id column and narrow the policies; the
-- app only ever talks to this file through src/lib/db/supabase.js.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------- kits --
create table if not exists kit (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  size        integer     not null default 60 check (size between 1 and 500),
  unavailable integer[]   not null default '{}',   -- broken or missing cameras
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

-- ---------------------------------------------------------------- courses --
create table if not exists course (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  event      text,
  place      text,
  dates      text,
  major      boolean not null default false,
  tbc        boolean not null default false,
  lng        double precision,
  lat        double precision,
  -- The hole layout, exactly as the app shapes it: number, par, tee, green,
  -- line, bounds, playBearing. Kept as one document because it is always read
  -- and written whole, and it keeps the client and the database identical.
  holes      jsonb,
  seeded     boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);

-- ------------------------------------------------------------------ plans --
create table if not exists plan (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references course(id) on delete cascade,
  kit_id     uuid references kit(id) on delete set null,
  name       text not null,
  owner      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);
create index if not exists plan_course_idx on plan (course_id);

-- --------------------------------------------------------------- entities --
-- One row per camera, cable, switch or marker. Writing per entity is what
-- lets two people work the same plan without overwriting each other: each
-- saves only what they touched.
create table if not exists plan_entity (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plan(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users,

  -- Pulled out of the document so the interesting questions are queryable
  -- without unpacking every row.
  kind     text    generated always as (data->>'kind') stored,
  hole     integer generated always as (nullif(data->>'hole','')::integer) stored,
  position integer generated always as (nullif(data->>'position','')::integer) stored,
  number   integer generated always as (nullif(data->>'number','')::integer) stored
);
create index if not exists plan_entity_plan_idx on plan_entity (plan_id);
create index if not exists plan_entity_kind_idx on plan_entity (plan_id, kind);
create index if not exists plan_entity_hole_idx on plan_entity (plan_id, hole, position);

-- --------------------------------------------------------- touch on write --
create or replace function touch_row() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['kit','course','plan','plan_entity'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before insert or update on %I
       for each row execute function touch_row()', t, t);
  end loop;
end $$;

-- -------------------------------------------------------------------- RLS --
-- Signed in means full access. Signed out means nothing.
alter table kit         enable row level security;
alter table course      enable row level security;
alter table plan        enable row level security;
alter table plan_entity enable row level security;

do $$
declare t text;
begin
  foreach t in array array['kit','course','plan','plan_entity'] loop
    execute format('drop policy if exists %I_team on %I', t, t);
    execute format(
      'create policy %I_team on %I for all
       to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- --------------------------------------------------------------- one kit ---
insert into kit (name, size)
select 'Kit 1', 60
where not exists (select 1 from kit);
