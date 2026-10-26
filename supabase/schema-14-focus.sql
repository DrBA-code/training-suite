-- Training Suite — database: Focus mode.
-- A programme may allow Focus mode. The facilitator turns it on during a session; phones ask each person to
-- accept. Leaving the Training Suite page longer than the grace period is logged and the facilitator is alerted.
-- A research window (started from the phone's Research button) doesn't count as leaving.
-- Run after schema-13-step7.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.programmes add column if not exists focus_allowed boolean not null default false;
-- { on: true, grace: 20 (seconds), research: 3 (minutes, 0 = no research window), since: time }
alter table public.sessions add column if not exists focus jsonb;
alter table public.attendance
  add column if not exists focus_accepted_at timestamptz,
  add column if not exists focus_out_at      timestamptz,             -- away right now, since
  add column if not exists focus_leaves      int not null default 0,  -- times away longer than the grace period
  add column if not exists focus_away        int not null default 0,  -- seconds away (beyond research windows)
  add column if not exists focus_short       int not null default 0,  -- short absences, within the grace period
  add column if not exists focus_research    int not null default 0,  -- research windows used
  add column if not exists focus_log         jsonb not null default '[]';

-- Facilitator: turn Focus mode on or off, and set the grace period and research window.
create or replace function public.set_focus(p_session uuid, p_focus jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; p public.programmes; f jsonb;
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  select * into s from public.sessions where id = p_session;
  select * into p from public.programmes where id = s.programme_id;
  if coalesce((p_focus->>'on')::boolean, false) and not p.focus_allowed then
    raise exception 'Focus mode is off for this programme. Turn it on in the programme settings first.';
  end if;
  f := case when p_focus is null then null else jsonb_build_object(
         'on', coalesce((p_focus->>'on')::boolean, false),
         'grace', greatest(5, least(600, coalesce((p_focus->>'grace')::int, 20))),
         'research', greatest(0, least(30, coalesce((p_focus->>'research')::int, 3))),
         'since', case when coalesce((s.focus->>'on')::boolean, false) then s.focus->'since' else to_jsonb(now()) end) end;
  update public.sessions set focus = f where id = p_session;
  if not coalesce((f->>'on')::boolean, false) then update public.attendance set focus_out_at = null where session_id = p_session; end if;
  return f;
end $$;

-- Phone: the session's focus settings and this person's state.
create or replace function public.my_focus(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('focus', s.focus, 'accepted', a.focus_accepted_at is not null, 'leaves', a.focus_leaves, 'away', a.focus_away)
    from public.ts_participant(p_code, p_token) me join public.sessions s on s.id = me.session_id
    join public.attendance a on a.session_id = me.session_id and a.participant_id = me.participant_id;
$$;

-- Phone: accept, away, back, research.
-- p_kind: 'accept' | 'out' | 'back' (p_secs = seconds away outside any research window, p_research = seconds inside one) | 'research'
create or replace function public.focus_event(p_code text, p_token uuid, p_kind text, p_secs int default 0, p_research int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; s public.sessions; a public.attendance; grace int; secs int; cap int;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into s from public.sessions where id = me.session_id;
  select * into a from public.attendance where session_id = me.session_id and participant_id = me.participant_id;
  if not coalesce((s.focus->>'on')::boolean, false) then return jsonb_build_object('on', false); end if;
  grace := coalesce((s.focus->>'grace')::int, 20);
  if p_kind = 'accept' then
    update public.attendance set focus_accepted_at = coalesce(focus_accepted_at, now()) where id = a.id;
  elsif p_kind = 'out' then
    update public.attendance set focus_out_at = now() where id = a.id;
  elsif p_kind = 'research' then
    update public.attendance set focus_research = focus_research + 1,
           focus_log = focus_log || jsonb_build_array(jsonb_build_object('research', now(), 'minutes', (s.focus->>'research')::int)) where id = a.id;
  elsif p_kind = 'back' then
    cap := case when a.focus_out_at is null then 86400 else greatest(0, floor(extract(epoch from now() - a.focus_out_at))::int + 5) end;
    secs := greatest(0, least(coalesce(p_secs, 0), cap));
    if secs > grace then
      update public.attendance set focus_leaves = focus_leaves + 1, focus_away = focus_away + secs, focus_out_at = null,
             focus_log = focus_log || jsonb_build_array(jsonb_build_object('out', now() - make_interval(secs => secs + greatest(0, coalesce(p_research, 0))), 'back', now(), 'secs', secs, 'research', greatest(0, coalesce(p_research, 0))))
       where id = a.id;
    else
      update public.attendance set focus_short = focus_short + case when secs > 0 then 1 else 0 end, focus_out_at = null where id = a.id;
    end if;
  else raise exception 'Unknown focus event';
  end if;
  return jsonb_build_object('on', true, 'counted', coalesce(secs, 0) > grace, 'secs', coalesce(secs, 0));
end $$;

-- Facilitator: everyone's focus state.
create or replace function public.session_focus(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.ts_owns_session(p_session) then null else jsonb_build_object(
    'focus', (select focus from public.sessions where id = p_session),
    'allowed', (select p.focus_allowed from public.sessions s join public.programmes p on p.id = s.programme_id where s.id = p_session),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('participant', pt.id, 'name', public.ts_display_name(pt.title, pt.full_name), 'photo', pt.photo_url,
               'in_room', a.left_at is null, 'accepted', a.focus_accepted_at is not null, 'out_at', a.focus_out_at,
               'leaves', a.focus_leaves, 'away', a.focus_away, 'short', a.focus_short, 'research', a.focus_research, 'log', a.focus_log)
               order by a.focus_leaves desc, a.focus_away desc, pt.full_name)
             from public.attendance a join public.participants pt on pt.id = a.participant_id where a.session_id = p_session), '[]'::jsonb)) end;
$$;

-- The register, now with focus.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at,
           'away_seconds', a.away_seconds, 'periods', a.periods, 'preloaded', pt.preloaded, 'rejoins', a.rejoins,
           'sex', pt.sex, 'grp', a.grp, 'focus_leaves', a.focus_leaves, 'focus_away', a.focus_away, 'focus_accepted', a.focus_accepted_at is not null,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds))
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;

grant execute on function public.set_focus(uuid, jsonb) to authenticated;
grant execute on function public.session_focus(uuid) to authenticated;
grant execute on function public.my_focus(text, uuid) to anon, authenticated;
grant execute on function public.focus_event(text, uuid, text, int, int) to anon, authenticated;
