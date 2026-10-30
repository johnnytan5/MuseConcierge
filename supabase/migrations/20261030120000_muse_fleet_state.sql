-- Muse Concierge: one saved fleet run per browser, so a reload resumes the
-- robots, the task queue, the brain log and the room notifications.
-- Only the server (service-role key) reads or writes it: RLS on, no policies.
create table if not exists public.muse_fleet_state (
  id text primary key,
  snapshot jsonb,
  brain_log jsonb not null default '[]'::jsonb,
  notifications jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.muse_fleet_state enable row level security;

-- One row per guest call, for the per-IP daily cap on the hosted demo.
create table if not exists public.muse_calls (
  id text primary key,
  ip text not null,
  visitor_id text,
  started_at timestamptz not null default now()
);
create index if not exists muse_calls_ip_started on public.muse_calls (ip, started_at desc);

alter table public.muse_calls enable row level security;
