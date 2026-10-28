-- Training Suite — database: Focus mode on the live screen.
-- • The facilitator chooses what the live screen shows: only a count on the Focus button (default), or names and timers too.
-- • A research window is kept with its end time, so the live screen can tell "researching" from "away" without missing a beat.
-- • The facilitator's view gets the server's clock, so timers stay right even if the computer's clock is off.
-- Run after schema-16-needs.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.attendance add column if not exists focus_res_until timestamptz;   -- research window ends at

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
         'scope', case when p_focus->>'scope' = 'session' then 'session' else 'activities' end,
         'grace', greatest(5, least(600, coalesce((p_focus->>'grace')::int, 30))),
         'research', greatest(0, least(30, coalesce((p_focus->>'research')::int, 3))),
         'show', case when p_focus->>'show' = 'names' then 'names' else 'count' end,
         'since', case when coalesce((s.focus->>'on')::boolean, false) then s.focus->'since' else to_jsonb(now()) end) end;
  update public.sessions set focus = f where id = p_session;
  if not coalesce((f->>'on')::boolean, false) then update public.attendance set focus_out_at = null, focus_res_until = null where session_id = p_session; end if;
  return f;
end $$;

create or replace function public.focus_event(p_code text, p_token uuid, p_kind text, p_secs int default 0, p_research int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; s public.sessions; a public.attendance; grace int; secs int; cap int;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into s from public.sessions where id = me.session_id;
  select * into a from public.attendance where session_id = me.session_id and participant_id = me.participant_id;
  if not coalesce((s.focus->>'on')::boolean, false) then return jsonb_build_object('on', false); end if;
  grace := coalesce((s.focus->>'grace')::int, 30);
  if p_kind = 'accept' then
    update public.attendance set focus_accepted_at = coalesce(focus_accepted_at, now()) where id = a.id;
  elsif p_kind = 'out' then
    update public.attendance set focus_out_at = coalesce(focus_out_at, now()) where id = a.id;
  elsif p_kind = 'research' then
    if a.focus_res_until is not null and a.focus_res_until > now() then return jsonb_build_object('on', true, 'until', a.focus_res_until); end if;
    update public.attendance set focus_research = focus_research + 1,
           focus_res_until = now() + make_interval(mins => coalesce((s.focus->>'research')::int, 3)),
           focus_log = focus_log || jsonb_build_array(jsonb_build_object('research', now(), 'minutes', (s.focus->>'research')::int)) where id = a.id;
  elsif p_kind = 'back' then
    -- no "out" on record: either it was already counted (a repeat), or the phone's "out" never arrived
    if a.focus_out_at is null and exists (select 1 from jsonb_array_elements(a.focus_log) e where (e->>'back')::timestamptz > now() - interval '2 minutes') then
      return jsonb_build_object('on', true, 'counted', false, 'secs', 0);
    end if;
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

create or replace function public.session_focus(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.ts_owns_session(p_session) then null else jsonb_build_object(
    'now', now(),
    'focus', (select focus from public.sessions where id = p_session),
    'allowed', (select p.focus_allowed from public.sessions s join public.programmes p on p.id = s.programme_id where s.id = p_session),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('participant', pt.id, 'name', public.ts_display_name(pt.title, pt.full_name), 'photo', pt.photo_url,
               'in_room', a.left_at is null, 'accepted', a.focus_accepted_at is not null, 'out_at', a.focus_out_at, 'res_until', a.focus_res_until,
               'leaves', a.focus_leaves, 'away', a.focus_away, 'short', a.focus_short, 'research', a.focus_research, 'log', a.focus_log)
               order by a.focus_leaves desc, a.focus_away desc, pt.full_name)
             from public.attendance a join public.participants pt on pt.id = a.participant_id where a.session_id = p_session), '[]'::jsonb)) end;
$$;

grant execute on function public.set_focus(uuid, jsonb) to authenticated;
grant execute on function public.session_focus(uuid) to authenticated;
grant execute on function public.focus_event(text, uuid, text, int, int) to anon, authenticated;
