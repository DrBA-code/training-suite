-- Training Suite — database, step 3 of the roadmap: AI on the Training Suite server key.
-- Trainers never see the key. Each account has a monthly number of AI requests (set by the Super Admin).
-- Run after schema-5-participation.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- Monthly AI requests per account: -1 = no limit, 0 = AI switched off.
alter table public.profiles add column if not exists ai_limit int not null default 50;

-- One row per AI request (written by the ts-ai server function).
create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  task           text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_owner_idx on public.ai_usage (owner_id, created_at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "own ai usage" on public.ai_usage;
create policy "own ai usage" on public.ai_usage for select to authenticated using (owner_id = auth.uid());

-- Saved AI reviews of case studies and exit tickets, so the facilitator can read them later.
create table if not exists public.ai_reviews (
  activity_id  uuid not null references public.activities(id) on delete cascade,
  run          text not null,
  step         int  not null default 0,
  session_id   uuid not null references public.sessions(id) on delete cascade,
  result       jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  primary key (activity_id, run, step)
);
alter table public.ai_reviews enable row level security;
drop policy if exists "owner reads ai reviews" on public.ai_reviews;
create policy "owner reads ai reviews" on public.ai_reviews for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active());

-- This month's use, for the trainer's Settings page and before each request.
create or replace function public.my_ai_usage()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('used', (select count(*) from public.ai_usage where owner_id = auth.uid() and created_at >= date_trunc('month', now())),
                            'limit', (select ai_limit from public.profiles where id = auth.uid()));
$$;

-- Super Admin: set an account's monthly AI requests, and see everyone's use this month.
create or replace function public.admin_set_ai_limit(p_user uuid, p_limit int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the Super Admin can do this'; end if;
  if p_limit < -1 or p_limit > 100000 then raise exception 'Use -1 for no limit, 0 to switch AI off, or a number up to 100000'; end if;
  update public.profiles set ai_limit = p_limit where id = p_user and not is_admin;
end $$;

create or replace function public.admin_ai_usage()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(owner_id, n), '{}'::jsonb)
    from (select owner_id, count(*) n from public.ai_usage where created_at >= date_trunc('month', now()) group by owner_id) t
   where public.is_admin();
$$;

grant execute on function public.my_ai_usage() to authenticated;
grant execute on function public.admin_set_ai_limit(uuid, int) to authenticated;
grant execute on function public.admin_ai_usage() to authenticated;
