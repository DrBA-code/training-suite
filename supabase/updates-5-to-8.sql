-- Training Suite — all database updates after schema-4, in order (5, 6, 7, 8). Safe to run more than once.
-- SQL Editor → New query → paste all → Run.

-- ======================== schema-5-participation.sql ========================
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

-- Dashboard numbers for the signed-in trainer: people reached, learning achievement and participation per session.
create or replace function public.dashboard_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (select id, programme_id from public.sessions where owner_id = auth.uid() and public.is_active()),
  tests as (select a.id, a.session_id, greatest(jsonb_array_length(coalesce(a.data->'steps','[]'::jsonb)),1) n
              from public.activities a join mine on mine.id = a.session_id where a.slot = 'test'),
  pp as (select t.session_id, r.participant_id,
                100.0 * sum(coalesce(r.score,0)) filter (where r.run = 'pre') / t.n as pre,
                100.0 * sum(coalesce(r.score,0)) filter (where r.run = 'post') / t.n as post
           from tests t join public.responses r on r.activity_id = t.id and r.run in ('pre','post')
          group by t.session_id, r.participant_id, t.n),
  ach as (select session_id, case when pre >= 100 then case when post >= 100 then 1 else (post - 100) / 100 end else (post - pre) / (100 - pre) end as a
            from pp where pre is not null and post is not null),
  part as (select mine.id as session_id, avg(t.rate) as rate
             from mine cross join lateral public.ts_participation(mine.id) t where t.runs > 0 group by mine.id),
  per as (select mine.id, mine.programme_id,
                 (select count(*) from public.attendance x where x.session_id = mine.id) as people,
                 (select avg(a) from ach where ach.session_id = mine.id) as ach,
                 (select rate from part where part.session_id = mine.id) as part
            from mine)
  select jsonb_build_object(
    'people', (select count(distinct x.participant_id) from public.attendance x join mine on mine.id = x.session_id),
    'checkins', (select count(*) from public.attendance x join mine on mine.id = x.session_id),
    'achievement', (select round((avg(a) * 100)::numeric) from ach),
    'participation', (select round(avg(rate)::numeric) from part),
    'runs', (select count(*) from public.activity_runs r join mine on mine.id = r.session_id),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'programme', programme_id, 'people', people,
                  'achievement', round((ach * 100)::numeric), 'participation', round(part::numeric))) from per), '[]'::jsonb));
$$;
grant execute on function public.dashboard_stats() to authenticated;

-- ======================== schema-6-ai.sql ========================
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

-- ======================== schema-7-finger.sql ========================
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

-- ======================== schema-8-more.sql ========================
-- Training Suite — database, step 4b of the roadmap: short answer, rating gauge and star feedback activities;
-- a certificate design on each programme. Run after schema-7-finger.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('poll','words','finger','scale','feedback','quiz','short','buzz','battle','order','match','spot','case','exit','test'));

-- Certificate design for the programme: a built-in template, or the trainer's own uploaded design.
alter table public.programmes add column if not exists cert_design jsonb not null default '{"template":"classic"}';

-- Short answers are compared after tidying: lower case, no punctuation or extra spaces.
create or replace function public.ts_norm(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(t,'')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- What a phone may see of a question: never the answer before Reveal.
create or replace function public.ts_public_step(p_kind text, s jsonb, p_run text, p_reveal boolean)
returns jsonb language plpgsql immutable as $$
declare base jsonb := coalesce(s,'{}'::jsonb) - 'correct' - 'region' - 'items' - 'pairs' - 'accept';
begin
  if p_kind = 'order' then
    base := base || jsonb_build_object('items', public.ts_shuffle(s->'items', p_run));
    if p_reveal then base := base || jsonb_build_object('answer_items', s->'items'); end if;
  elsif p_kind = 'match' then
    base := base || jsonb_build_object(
      'lefts',  (select coalesce(jsonb_agg(p->'l'), '[]'::jsonb) from jsonb_array_elements(coalesce(s->'pairs','[]'::jsonb)) p),
      'rights', public.ts_shuffle((select coalesce(jsonb_agg(p->'r'), '[]'::jsonb) from jsonb_array_elements(coalesce(s->'pairs','[]'::jsonb)) p), p_run));
    if p_reveal then base := base || jsonb_build_object('answer_pairs', s->'pairs'); end if;
  elsif p_kind in ('quiz','buzz','battle','test') then
    if p_reveal then base := base || jsonb_build_object('correct', s->'correct'); end if;
  elsif p_kind = 'spot' then
    if p_reveal then base := base || jsonb_build_object('region', s->'region'); end if;
  elsif p_kind = 'short' then
    base := base || jsonb_build_object('marked', jsonb_array_length(coalesce(s->'accept','[]'::jsonb)) > 0);
    if p_reveal then base := base || jsonb_build_object('accept', s->'accept'); end if;
  end if;
  return base;
end $$;

create or replace function public.submit_answer(p_code text, p_token uuid, p_grp text, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me record; st public.live_state; a public.activities; s jsonb;
  sc numeric := null; pts int := 0; ms int; n int; hits int; rk int; rec public.responses; dx numeric; dy numeric; v numeric;
begin
  if octet_length(coalesce(p_answer,'{}'::jsonb)::text) > 4000 then raise exception 'Answer is too long'; end if;
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into st from public.live_state where session_id = me.session_id;
  if st.session_id is null or st.phase <> 'open' then raise exception 'Answers are closed'; end if;
  if st.seconds > 0 and now() > st.opened_at + make_interval(secs => st.seconds + 2) then raise exception 'Time is up'; end if;
  select * into a from public.activities where id = st.activity_id;
  s := a.data->'steps'->st.step;
  ms := greatest(0, round(extract(epoch from now() - st.opened_at) * 1000))::int;

  if a.kind in ('quiz','buzz','battle','test') then
    sc := case when (p_answer->>'i') is not null and (p_answer->>'i')::int = (s->>'correct')::int then 1 else 0 end;
  elsif a.kind = 'short' then
    if jsonb_array_length(coalesce(s->'accept','[]'::jsonb)) > 0 then
      sc := case when exists (select 1 from jsonb_array_elements_text(s->'accept') x
                               where public.ts_norm(x) <> '' and public.ts_norm(x) = public.ts_norm(p_answer->>'text')) then 1 else 0 end;
    end if;
  elsif a.kind = 'scale' then
    v := (p_answer->>'v')::numeric;
    if v is null or v < coalesce((s->>'min')::numeric, 0) or v > coalesce((s->>'max')::numeric, 10) then raise exception 'Pick a value on the scale'; end if;
  elsif a.kind = 'feedback' then
    v := (p_answer->>'stars')::numeric;
    if v is null or v < 1 or v > 5 then raise exception 'Pick 1 to 5 stars'; end if;
  elsif a.kind = 'order' then
    n := jsonb_array_length(coalesce(s->'items','[]'::jsonb));
    select count(*) into hits from generate_series(0, greatest(n-1,0)) i where n > 0 and (p_answer->'items'->>i) = (s->'items'->>i);
    sc := case when n > 0 then hits::numeric / n else 0 end;
  elsif a.kind = 'match' then
    n := jsonb_array_length(coalesce(s->'pairs','[]'::jsonb));
    select count(*) into hits from generate_series(0, greatest(n-1,0)) i where n > 0 and (p_answer->'rights'->>i) = (s->'pairs'->i->>'r');
    sc := case when n > 0 then hits::numeric / n else 0 end;
  elsif a.kind = 'spot' and s ? 'region' then
    dx := ((p_answer->>'x')::numeric - (s->'region'->>'x')::numeric) * coalesce((s->>'aspect')::numeric, 1);
    dy := (p_answer->>'y')::numeric - (s->'region'->>'y')::numeric;
    sc := case when sqrt(dx*dx + dy*dy) <= (s->'region'->>'r')::numeric then 1 else 0 end;
  end if;

  if sc is not null then
    sc := round(sc, 4);
    if a.kind in ('quiz','buzz','battle','test','short') then
      pts := round(sc * (500 + 500 * greatest(0, 1 - ms / (greatest(case when st.seconds > 0 then st.seconds else 30 end, 5) * 1000.0))));
    else pts := round(sc * 1000); end if;
  end if;

  insert into public.responses (activity_id, session_id, run, step, participant_id, grp, answer, score, points, ms)
  values (a.id, me.session_id, st.run, st.step, me.participant_id, case when p_grp in ('A','B') then p_grp else 'all' end,
          coalesce(p_answer,'{}'::jsonb), sc, pts, ms)
  on conflict (activity_id, run, step, participant_id) do nothing
  returning * into rec;
  if rec.id is null then raise exception 'You already answered'; end if;
  if sc = 1 then
    select count(*) + 1 into rk from public.responses r
     where r.activity_id = a.id and r.run = st.run and r.step = st.step and r.score = 1 and r.created_at < rec.created_at;
  end if;
  return jsonb_build_object('score', sc, 'points', pts, 'ms', ms, 'rank', rk);
end $$;
grant execute on function public.submit_answer(text, uuid, text, jsonb) to anon, authenticated;
