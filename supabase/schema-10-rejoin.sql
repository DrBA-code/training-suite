-- Training Suite — database: getting back in with just an email.
-- Someone who already checked in (this session, or an earlier session of the programme) and lost the page,
-- changed phone or cleared the browser gets back in with their email: no form, no new photo, no second record.
-- Run after schema-9-evaluation.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- Each time someone gets back in by email, the time is noted, so the register can show it.
alter table public.attendance add column if not exists rejoins jsonb not null default '[]';

create or replace function public.rejoin(p_code text, p_email text, p_device text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; a public.attendance; other text;
        e text := lower(trim(coalesce(p_email,'')));
begin
  select * into s from public.sessions where attendance_code = upper(p_code);
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  select * into pt from public.participants where programme_id = s.programme_id and email = e;
  if pt.id is null then
    raise exception 'We couldn''t find that email for this programme. Check the spelling, or tap I''m new here.';
  end if;
  -- only people who have really checked in before (listed in advance but never came → use the form)
  if pt.photo_url is null and not exists (select 1 from public.attendance x join public.sessions y on y.id = x.session_id
                                           where x.participant_id = pt.id and y.programme_id = s.programme_id) then
    raise exception 'You haven''t checked in with this email yet. Tap I''m new here to check in.';
  end if;
  if s.status = 'completed' then
    -- after the end: back to their summary, evaluation and results, if they were here
    select * into a from public.attendance where session_id = s.id and participant_id = pt.id;
    if a.id is null then raise exception 'This session has ended'; end if;
  else
    if coalesce(p_device,'') <> '' then
      select x.full_name into other from public.attendance at join public.participants x on x.id = at.participant_id
       where at.session_id = s.id and at.device = p_device and x.id <> pt.id limit 1;
      if other is not null then
        raise exception 'This phone has already checked in % for this session. Use your own phone, or ask your facilitator to check you in.', other;
      end if;
    end if;
    a := public.ts_arrive(s.id, pt.id, p_device);
    update public.attendance set rejoins = rejoins || jsonb_build_array(now()) where id = a.id returning * into a;
  end if;
  return jsonb_build_object('participant', pt.id, 'token', pt.token, 'title', pt.title, 'name', pt.full_name,
                            'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'new', false,
                            'ended', s.status = 'completed');
end $$;
grant execute on function public.rejoin(text, text, text) to anon, authenticated;

-- The register, now with the times someone got back in by email.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at,
           'away_seconds', a.away_seconds, 'periods', a.periods, 'preloaded', pt.preloaded, 'rejoins', a.rejoins,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds))
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;
