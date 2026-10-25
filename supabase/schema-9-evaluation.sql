-- Training Suite — database, step 5 of the roadmap: session evaluation.
-- One evaluation per participant per session. Anonymous by default: the facilitator sees results, not names.
-- Run after updates-5-to-8.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.sessions add column if not exists eval_open boolean not null default false;

create table if not exists public.evaluations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  participant_id  uuid not null references public.participants(id) on delete cascade,
  answers         jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (session_id, participant_id)
);
create index if not exists evaluations_session_idx on public.evaluations (session_id);
alter table public.evaluations enable row level security;   -- read and written through the functions below

-- Phone: is there an evaluation to fill, and has this person done it?
create or replace function public.my_evaluation(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'mode', coalesce(s.evaluation->>'mode', 'default'),
           'anonymous', coalesce((s.evaluation->>'anonymous')::boolean, true),
           'at_tapout', coalesce((s.evaluation->>'at_tapout')::boolean, true),
           'items', s.evaluation->'items',
           'open', s.eval_open or s.status = 'completed',
           'done', exists (select 1 from public.evaluations e where e.session_id = s.id and e.participant_id = me.participant_id),
           'topic', s.topic, 'main_topic', s.main_topic, 'key_skill', s.key_skill, 'course_lead', s.course_lead, 'objectives', s.objectives)
    from public.ts_participant(p_code, p_token) me join public.sessions s on s.id = me.session_id;
$$;

create or replace function public.submit_evaluation(p_code text, p_token uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; s public.sessions;
begin
  if octet_length(coalesce(p_answers,'{}'::jsonb)::text) > 12000 then raise exception 'Answers are too long'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be a set of item answers'; end if;
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into s from public.sessions where id = me.session_id;
  if coalesce(s.evaluation->>'mode', 'default') = 'none' then raise exception 'This session has no evaluation'; end if;
  insert into public.evaluations (session_id, participant_id, answers) values (s.id, me.participant_id, p_answers)
  on conflict (session_id, participant_id) do update set answers = excluded.answers, created_at = now();
end $$;

-- Facilitator: open or close the evaluation on phones.
create or replace function public.set_eval_open(p_session uuid, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  update public.sessions set eval_open = coalesce(p_open, false) where id = p_session;
end $$;

-- Facilitator: results. Names only when the evaluation is not anonymous.
create or replace function public.session_evaluation(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.ts_owns_session(p_session) then null else jsonb_build_object(
    'attendees', (select count(*) from public.attendance a where a.session_id = p_session),
    'anonymous', coalesce((s.evaluation->>'anonymous')::boolean, true),
    'open', s.eval_open,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('answers', e.answers, 'at', e.created_at,
               'name', case when coalesce((s.evaluation->>'anonymous')::boolean, true) then null else pt.full_name end) order by e.created_at)
             from public.evaluations e join public.participants pt on pt.id = e.participant_id where e.session_id = p_session), '[]'::jsonb)) end
    from public.sessions s where s.id = p_session;
$$;

-- How many have done it (for the live screen), without opening the results.
create or replace function public.eval_count(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.ts_owns_session(p_session) then jsonb_build_object(
    'done', (select count(*) from public.evaluations where session_id = p_session),
    'attendees', (select count(*) from public.attendance where session_id = p_session)) end;
$$;

-- The facilitator's overall rating, per session, for the dashboard: the average of the "overall" item (1 to 5 stars).
create or replace function public.dashboard_ratings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'rating', x.r, 'n', x.n)), '[]'::jsonb) from (
    select s.id, round(avg((e.answers->>'overall')::numeric), 2) r, count(e.*) n
      from public.sessions s join public.evaluations e on e.session_id = s.id
     where s.owner_id = auth.uid() and public.is_active() and (e.answers->>'overall') ~ '^[1-5]$'
     group by s.id) x;
$$;

-- Ending a session also opens the evaluation on phones (re-stated from update 4).
create or replace function public.end_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; done boolean;
begin
  select * into s from public.sessions where id = p_session and owner_id = auth.uid();
  if s.id is null or not public.is_active() then raise exception 'Not your session'; end if;
  update public.sessions set status = 'completed', ended_at = coalesce(ended_at, now()), progress = 999,
         eval_open = coalesce(evaluation->>'mode', 'default') <> 'none' where id = s.id;
  update public.live_state set phase = 'idle', activity_id = null, updated_at = now() where session_id = s.id;
  done := not exists (select 1 from public.sessions where programme_id = s.programme_id and status in ('ready','live'));
  if done then update public.programmes set completed_at = coalesce(completed_at, now()) where id = s.programme_id; end if;
  return jsonb_build_object('programme_completed', done);
end $$;

grant execute on function public.my_evaluation(text, uuid) to anon, authenticated;
grant execute on function public.submit_evaluation(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.set_eval_open(uuid, boolean) to authenticated;
grant execute on function public.session_evaluation(uuid) to authenticated;
grant execute on function public.eval_count(uuid) to authenticated;
grant execute on function public.dashboard_ratings() to authenticated;
