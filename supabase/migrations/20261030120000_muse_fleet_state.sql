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
