-- Training Suite — database, phase 3: activities (questions), running them live, answers, learning achievement.
-- Run after schema.sql and schema-2-participants.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. Activities: one per tool in a session's flow ("slot" = the tool, e.g. quiz, poll), plus "test" for the pre/post test.
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  slot        text not null check (char_length(slot) <= 20),
  kind        text not null check (kind in ('poll','words','quiz','buzz','battle','order','match','spot','case','exit','test')),
  title       text not null default '' check (char_length(title) <= 200),
  data        jsonb not null default '{"steps":[]}',
  updated_at  timestamptz not null default now(),
  unique (session_id, slot)
);
alter table public.activities enable row level security;
drop policy if exists "own activities" on public.activities;
create policy "own activities" on public.activities for all to authenticated
  using (owner_id = auth.uid() and public.is_active())
  with check (owner_id = auth.uid() and public.is_active()
              and exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid())
              and octet_length(data::text) < 200000);

-- 2. What is live in a session right now.
create table if not exists public.live_state (
  session_id   uuid primary key references public.sessions(id) on delete cascade,
  activity_id  uuid references public.activities(id) on delete set null,
  run          text not null default '',
  step         int  not null default 0,
  phase        text not null default 'idle' check (phase in ('idle','open','closed','reveal')),
  seconds      int  not null default 0,
  opened_at    timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.live_state enable row level security;   -- written and read through the functions below

-- 3. Answers: one per participant per question per run (run = 'pre' / 'post' for the test, otherwise one per launch).
create table if not exists public.responses (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references public.activities(id) on delete cascade,
  session_id      uuid not null references public.sessions(id) on delete cascade,
  run             text not null,
  step            int  not null,
  participant_id  uuid not null references public.participants(id) on delete cascade,
  grp             text not null default 'all' check (grp in ('all','A','B')),
  answer          jsonb not null default '{}',
  score           numeric,
  points          int not null default 0,
  ms              int not null default 0,
  feedback        text,
  created_at      timestamptz not null default clock_timestamp(),
  unique (activity_id, run, step, participant_id)
);
create index if not exists responses_session_idx on public.responses (session_id, activity_id, run);
alter table public.responses enable row level security;
drop policy if exists "owner reads responses" on public.responses;
create policy "owner reads responses" on public.responses for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active());

-- 4. Helpers ------------------------------------------------------------------------
create or replace function public.ts_shuffle(arr jsonb, seed text)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x order by md5(x::text || seed)), '[]'::jsonb) from jsonb_array_elements(coalesce(arr,'[]'::jsonb)) x;
$$;

-- What a phone may see of a question: never the answer before Reveal.
create or replace function public.ts_public_step(p_kind text, s jsonb, p_run text, p_reveal boolean)
returns jsonb language plpgsql immutable as $$
declare base jsonb := coalesce(s,'{}'::jsonb) - 'correct' - 'region' - 'items' - 'pairs';
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
  end if;
  return base;
end $$;

create or replace function public.ts_owns_session(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions where id = p_session and owner_id = auth.uid()) and public.is_active();
$$;

-- 5. Presenter -------------------------------------------------------------------------
create or replace function public.set_live(p_session uuid, p_activity uuid, p_run text, p_step int, p_phase text, p_seconds int)
returns public.live_state language plpgsql security definer set search_path = public as $$
declare rec public.live_state;
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  if p_activity is not null and not exists (select 1 from public.activities where id = p_activity and session_id = p_session) then
    raise exception 'Activity not found';
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

create or replace function public.live_results(p_activity uuid, p_run text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.activities;
begin
  select * into a from public.activities where id = p_activity;
  if a.id is null or not public.ts_owns_session(a.session_id) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'step', r.step, 'participant', r.participant_id,
            'name', trim(both ' ' from coalesce(nullif(pt.title,''),'') || case when pt.title in ('Miss','Ms') then ' ' when pt.title <> '' then '. ' else '' end || pt.full_name),
            'organisation', pt.organisation, 'photo', pt.photo_url, 'grp', r.grp, 'answer', r.answer, 'score', r.score,
            'points', r.points, 'ms', r.ms, 'feedback', r.feedback, 'at', r.created_at) order by r.created_at), '[]'::jsonb)
          from public.responses r join public.participants pt on pt.id = r.participant_id
         where r.activity_id = p_activity and r.run = p_run);
end $$;

create or replace function public.set_feedback(p_response uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.responses;
begin
  select * into r from public.responses where id = p_response;
  if r.id is null or not public.ts_owns_session(r.session_id) then raise exception 'Not found'; end if;
  update public.responses set feedback = nullif(left(coalesce(p_text,''),2000),'') where id = p_response;
end $$;

-- Pre/post test results for the whole session (owner).
create or replace function public.session_learning(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.activities; n int;
begin
  if not public.ts_owns_session(p_session) then return '[]'::jsonb; end if;
  select * into a from public.activities where session_id = p_session and slot = 'test';
  if a.id is null then return '[]'::jsonb; end if;
  n := greatest(jsonb_array_length(coalesce(a.data->'steps','[]'::jsonb)), 1);
  return (select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('participant', pt.id,
             'name', trim(both ' ' from coalesce(nullif(pt.title,''),'') || case when pt.title in ('Miss','Ms') then ' ' when pt.title <> '' then '. ' else '' end || pt.full_name),
             'organisation', pt.organisation,
             'pre',  round(100.0 * sum(coalesce(r.score,0)) filter (where r.run = 'pre') / n),
             'post', round(100.0 * sum(coalesce(r.score,0)) filter (where r.run = 'post') / n),
             'took_pre', bool_or(r.run = 'pre'), 'took_post', bool_or(r.run = 'post')) as x
      from public.responses r join public.participants pt on pt.id = r.participant_id
     where r.activity_id = a.id and r.run in ('pre','post')
     group by pt.id) t);
end $$;

-- 6. Phones ---------------------------------------------------------------------------------
create or replace function public.ts_participant(p_code text, p_token uuid)
returns table (session_id uuid, participant_id uuid) language sql stable security definer set search_path = public as $$
  select s.id, pt.id from public.sessions s
    join public.attendance at on at.session_id = s.id
    join public.participants pt on pt.id = at.participant_id
   where s.attendance_code = upper(p_code) and pt.token = p_token limit 1;
$$;

create or replace function public.room_current(p_code text, p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record; st public.live_state; a public.activities; s jsonb; mine public.responses;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then return jsonb_build_object('phase','idle'); end if;
  select * into st from public.live_state where session_id = me.session_id;
  if st.session_id is null or st.activity_id is null or st.phase = 'idle' then return jsonb_build_object('phase','idle'); end if;
  select * into a from public.activities where id = st.activity_id;
  s := a.data->'steps'->st.step;
  select * into mine from public.responses r where r.activity_id = a.id and r.run = st.run and r.step = st.step and r.participant_id = me.participant_id;
  return jsonb_build_object(
    'phase', st.phase, 'activity', a.id, 'kind', a.kind, 'title', a.title, 'run', st.run, 'step', st.step,
    'steps', jsonb_array_length(coalesce(a.data->'steps','[]'::jsonb)),
    'teams', a.kind in ('battle','case'), 'seconds', st.seconds,
    'left', case when st.seconds > 0 and st.phase = 'open' then greatest(0, st.seconds - extract(epoch from now() - st.opened_at)) end,
    'q', public.ts_public_step(a.kind, s, st.run, st.phase = 'reveal'),
    'mine', case when mine.id is not null then jsonb_build_object('answer', mine.answer, 'score', mine.score, 'points', mine.points) end,
    'key', st.updated_at);
end $$;

create or replace function public.submit_answer(p_code text, p_token uuid, p_grp text, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me record; st public.live_state; a public.activities; s jsonb;
  sc numeric := null; pts int := 0; ms int; n int; hits int; rk int; rec public.responses; dx numeric; dy numeric;
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
    if a.kind in ('quiz','buzz','battle','test') then
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

-- A participant's own learning achievement (after the post-test).
create or replace function public.my_learning(p_code text, p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record; a public.activities; n int; pre numeric; post numeric; tp boolean; tq boolean;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then return null; end if;
  select * into a from public.activities where session_id = me.session_id and slot = 'test';
  if a.id is null then return null; end if;
  n := greatest(jsonb_array_length(coalesce(a.data->'steps','[]'::jsonb)), 1);
  select round(100.0 * sum(coalesce(score,0)) filter (where run = 'pre') / n), round(100.0 * sum(coalesce(score,0)) filter (where run = 'post') / n),
         bool_or(run = 'pre'), bool_or(run = 'post')
    into pre, post, tp, tq
    from public.responses where activity_id = a.id and participant_id = me.participant_id and run in ('pre','post');
  return jsonb_build_object('pre', pre, 'post', post, 'took_pre', coalesce(tp,false), 'took_post', coalesce(tq,false));
end $$;

-- Feedback sent to this phone (e.g. AI review of a case study answer).
create or replace function public.my_feedback(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', a.title, 'q', a.data->'steps'->r.step->>'q', 'feedback', r.feedback, 'at', r.created_at)
           order by r.created_at desc), '[]'::jsonb)
    from public.ts_participant(p_code, p_token) me
    join public.responses r on r.session_id = me.session_id and r.participant_id = me.participant_id and r.feedback is not null
    join public.activities a on a.id = r.activity_id;
$$;

revoke all on function public.ts_participant(text, uuid) from public, anon, authenticated;
grant execute on function public.set_live(uuid, uuid, text, int, text, int) to authenticated;
grant execute on function public.live_results(uuid, text) to authenticated;
grant execute on function public.set_feedback(uuid, text) to authenticated;
grant execute on function public.session_learning(uuid) to authenticated;
grant execute on function public.room_current(text, uuid) to anon, authenticated;
grant execute on function public.submit_answer(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.my_learning(text, uuid) to anon, authenticated;
grant execute on function public.my_feedback(text, uuid) to anon, authenticated;
