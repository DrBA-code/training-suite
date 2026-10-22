-- Training Suite — database, step 2 of the roadmap: participation ranking.
-- Each time an activity is launched on the live screen it is logged as a run. A person's participation is the
-- share of runs they answered; the ranking is most activities first, then most points.
-- Run after schema-4-attendance.sql. SQL Editor → New query → paste all → Run. Safe to run again.

create table if not exists public.activity_runs (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  run          text not null,
  started_at   timestamptz not null default now(),
  primary key (activity_id, run)
);
create index if not exists activity_runs_session_idx on public.activity_runs (session_id);
alter table public.activity_runs enable row level security;   -- read through the functions below

-- Runs that already have answers (from before this update).
insert into public.activity_runs (session_id, activity_id, run, started_at)
select session_id, activity_id, run, min(created_at) from public.responses group by session_id, activity_id, run
on conflict do nothing;

-- set_live now also logs each run.
create or replace function public.set_live(p_session uuid, p_activity uuid, p_run text, p_step int, p_phase text, p_seconds int)
returns public.live_state language plpgsql security definer set search_path = public as $$
declare rec public.live_state;
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  if p_activity is not null and not exists (select 1 from public.activities where id = p_activity and session_id = p_session) then
    raise exception 'Activity not found';
  end if;
  if p_activity is not null and coalesce(p_run,'') <> '' then
    insert into public.activity_runs (session_id, activity_id, run) values (p_session, p_activity, p_run) on conflict do nothing;
  end if;
  insert into public.live_state as l (session_id, activity_id, run, step, phase, seconds, opened_at, updated_at)
  values (p_session, p_activity, coalesce(p_run,''), coalesce(p_step,0), p_phase, greatest(coalesce(p_seconds,0),0),
          case when p_phase = 'open' then now() end, now())
  on conflict (session_id) do update
     set activity_id = excluded.activity_id, run = excluded.run, step = excluded.step, phase = excluded.phase,
         seconds = excluded.seconds, opened_at = case when excluded.phase = 'open' then now() else l.opened_at end, updated_at = now()
  returning * into rec;
  return rec;
end $$;

-- Everyone who attended, ranked. (Internal: no ownership check; the two functions below check.)
create or replace function public.ts_participation(p_session uuid)
returns table (participant uuid, name text, organisation text, photo text, taken int, runs int, answers int, points int, rate int, rank int)
language sql stable security definer set search_path = public as $$
  with r as (select count(*)::int n from public.activity_runs where session_id = p_session),
  per as (
    select pt.id, trim(both ' ' from coalesce(nullif(pt.title,''),'') || case when pt.title in ('Miss','Ms') then ' ' when pt.title <> '' then '. ' else '' end || pt.full_name) as nm,
           pt.organisation, pt.photo_url,
           (select count(distinct (x.activity_id, x.run))::int from public.responses x where x.session_id = p_session and x.participant_id = pt.id) as taken,
           (select count(*)::int from public.responses x where x.session_id = p_session and x.participant_id = pt.id) as answers,
           (select coalesce(sum(x.points),0)::int from public.responses x where x.session_id = p_session and x.participant_id = pt.id) as points
      from public.attendance a join public.participants pt on pt.id = a.participant_id
     where a.session_id = p_session)
  select per.id, per.nm, per.organisation, per.photo_url, per.taken, r.n, per.answers, per.points,
         case when r.n > 0 then round(100.0 * per.taken / r.n)::int else 0 end,
         (rank() over (order by per.taken desc, per.points desc))::int
    from per, r
   order by 10, 2;
$$;
revoke all on function public.ts_participation(uuid) from public, anon, authenticated;

create or replace function public.session_participation(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank, t.name), '[]'::jsonb)
    from public.ts_participation(p_session) t
   where public.ts_owns_session(p_session);
$$;

create or replace function public.my_participation(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('taken', t.taken, 'runs', t.runs, 'points', t.points, 'rate', t.rate, 'rank', t.rank,
           'of', (select count(*) from public.attendance a where a.session_id = me.session_id))
    from public.ts_participant(p_code, p_token) me
    join lateral public.ts_participation(me.session_id) t on t.participant = me.participant_id;
$$;

grant execute on function public.session_participation(uuid) to authenticated;
grant execute on function public.my_participation(text, uuid) to anon, authenticated;
