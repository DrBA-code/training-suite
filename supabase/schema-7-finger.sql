-- Training Suite — database, step 4 of the roadmap: finger vote (the webcam counts raised fingers).
-- Run after schema-6-ai.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('poll','words','finger','scale','feedback','quiz','short','buzz','battle','order','match','spot','case','exit','test'));

-- The room's count for each finger-vote question, saved when the facilitator locks it.
create table if not exists public.tallies (
  activity_id  uuid not null references public.activities(id) on delete cascade,
  run          text not null,
  step         int  not null,
  session_id   uuid not null references public.sessions(id) on delete cascade,
  counts       jsonb not null default '[]',
  saved_at     timestamptz not null default now(),
  primary key (activity_id, run, step)
);
alter table public.tallies enable row level security;
drop policy if exists "owner reads tallies" on public.tallies;
create policy "owner reads tallies" on public.tallies for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active());

create or replace function public.save_tally(p_activity uuid, p_run text, p_step int, p_counts jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.activities;
begin
  select * into a from public.activities where id = p_activity;
  if a.id is null or not public.ts_owns_session(a.session_id) then raise exception 'Not your session'; end if;
  if jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) > 10 then raise exception 'Counts must be a short list'; end if;
  insert into public.tallies (activity_id, run, step, session_id, counts) values (a.id, p_run, p_step, a.session_id, p_counts)
  on conflict (activity_id, run, step) do update set counts = excluded.counts, saved_at = now();
end $$;
grant execute on function public.save_tally(uuid, text, int, jsonb) to authenticated;

-- Phones never answer a finger vote themselves.
create or replace function public.ts_no_finger_answers() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.activities where id = new.activity_id and kind = 'finger') then raise exception 'Raise your hand instead'; end if;
  return new;
end $$;
drop trigger if exists responses_no_finger on public.responses;
create trigger responses_no_finger before insert on public.responses for each row execute function public.ts_no_finger_answers();
