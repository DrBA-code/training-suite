-- Training Suite — database, step 1 of the roadmap: preloaded participant lists, one person per phone,
-- time out deducted from time spent, ending sessions and completing programmes, merging duplicates.
-- Run after schema-3-activities.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. New columns -----------------------------------------------------------------------------
alter table public.programmes
  add column if not exists roster_only  boolean not null default false,          -- only preloaded emails may check in
  add column if not exists access_days  int     not null default 30,             -- participant pages stay open this long after the programme ends
  add column if not exists completed_at timestamptz;
alter table public.programmes drop constraint if exists programmes_access_days_check;
alter table public.programmes add constraint programmes_access_days_check check (access_days between 0 and 3650);

alter table public.participants add column if not exists preloaded boolean not null default false;

alter table public.attendance
  add column if not exists away_seconds int   not null default 0,      -- total time tapped out and back
  add column if not exists periods      jsonb not null default '[]',   -- [{"out": time, "back": time}]
  add column if not exists device       text  not null default '';     -- the phone that checked this person in

alter table public.sessions add column if not exists ended_at timestamptz;

-- 2. Helpers -----------------------------------------------------------------------------------
-- Time in the session minus time away. The clock stops at tap-out or when the facilitator ends the session.
create or replace function public.ts_spent(p_arrived timestamptz, p_left timestamptz, p_ended timestamptz, p_away int)
returns int language sql stable as $$
  select greatest(0, floor(extract(epoch from (least(p_left, p_ended, now()) - p_arrived)))::int - coalesce(p_away, 0));
$$;

-- A programme closes to participants access_days after it is completed.
create or replace function public.ts_closed(p public.programmes)
returns boolean language sql stable as $$
  select p.completed_at is not null and now() > p.completed_at + make_interval(days => p.access_days);
$$;

create or replace function public.ts_owns_programme(p_programme uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.programmes where id = p_programme and owner_id = auth.uid()) and public.is_active();
$$;

-- Shared by check-in, one-tap check-in and the facilitator's manual check-in.
-- Coming back after tapping out adds the time away and records the period.
create or replace function public.ts_arrive(p_session uuid, p_participant uuid, p_device text)
returns public.attendance language plpgsql security definer set search_path = public as $$
declare a public.attendance;
begin
  insert into public.attendance as x (session_id, participant_id, device)
  values (p_session, p_participant, coalesce(p_device, ''))
  on conflict (session_id, participant_id) do update set
    away_seconds = x.away_seconds + case when x.left_at is not null then greatest(0, floor(extract(epoch from now() - x.left_at)))::int else 0 end,
    periods      = case when x.left_at is not null then x.periods || jsonb_build_array(jsonb_build_object('out', x.left_at, 'back', now())) else x.periods end,
    left_at      = null,
    device       = case when x.device = '' then excluded.device else x.device end
  returning * into a;
  return a;
end $$;

-- 3. Phones ------------------------------------------------------------------------------------
create or replace function public.public_session(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pkey', p.id, 'topic', s.topic, 'programme', p.name, 'course_lead', s.course_lead, 'date', s.session_date,
           'start_time', s.start_time, 'venue', s.venue, 'status', s.status, 'open', s.status in ('ready','live'),
           'ended', s.status = 'completed', 'roster_only', p.roster_only, 'closed', public.ts_closed(p),
           'programme_completed', p.completed_at is not null,
           'closes_at', case when p.completed_at is not null then p.completed_at + make_interval(days => p.access_days) end)
    from public.sessions s join public.programmes p on p.id = s.programme_id
   where s.attendance_code = upper(p_code) and s.status <> 'draft';
$$;

drop function if exists public.checkin(text, text, text, text, text, text);
create or replace function public.checkin(p_code text, p_title text, p_name text, p_email text, p_org text, p_photo text, p_device text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; p public.programmes; pt public.participants; a public.attendance;
        e text := lower(trim(coalesce(p_email,''))); fresh boolean := false; other text;
begin
  select * into s from public.sessions where attendance_code = upper(p_code);
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  if s.status = 'completed' then raise exception 'This session has ended'; end if;
  select * into p from public.programmes where id = s.programme_id;
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Enter your full name'; end if;
  select * into pt from public.participants where programme_id = s.programme_id and email = e;
  if p.roster_only and (pt.id is null or not pt.preloaded) then
    raise exception 'This email isn''t registered for this programme. Use the email you registered with.';
  end if;
  -- one phone, one person per session
  if coalesce(p_device,'') <> '' then
    select x.full_name into other from public.attendance at join public.participants x on x.id = at.participant_id
     where at.session_id = s.id and at.device = p_device and x.id is distinct from pt.id limit 1;
    if other is not null then
      raise exception 'This phone has already checked in % for this session. Use your own phone, or ask your facilitator to check you in.', other;
    end if;
  end if;
  if pt.id is null then
    insert into public.participants (programme_id, title, full_name, email, organisation, photo_url)
    values (s.programme_id, left(coalesce(p_title,''),20), left(trim(p_name),160), e, left(trim(coalesce(p_org,'')),200), nullif(p_photo,''))
    returning * into pt;
    fresh := true;
  else
    update public.participants
       set title = coalesce(nullif(left(coalesce(p_title,''),20),''), title),
           full_name = left(trim(p_name),160),
           organisation = coalesce(nullif(left(trim(coalesce(p_org,'')),200),''), organisation),
           photo_url = coalesce(nullif(p_photo,''), photo_url)
     where id = pt.id returning * into pt;
  end if;
  a := public.ts_arrive(s.id, pt.id, p_device);
  return jsonb_build_object('participant', pt.id, 'token', pt.token, 'title', pt.title, 'name', pt.full_name,
                            'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'new', fresh);
end $$;

drop function if exists public.checkin_again(text, uuid);
create or replace function public.checkin_again(p_code text, p_token uuid, p_device text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; p public.programmes; pt public.participants; a public.attendance; other text;
begin
  select * into s from public.sessions where attendance_code = upper(p_code);
  if s.id is null or s.status in ('draft','completed') then raise exception 'This check-in code is not valid'; end if;
  select * into p from public.programmes where id = s.programme_id;
  select * into pt from public.participants where token = p_token and programme_id = s.programme_id;
  if pt.id is null then return null; end if;
  if p.roster_only and not pt.preloaded then
    raise exception 'This email isn''t registered for this programme. Use the email you registered with.';
  end if;
  if coalesce(p_device,'') <> '' then
    select x.full_name into other from public.attendance at join public.participants x on x.id = at.participant_id
     where at.session_id = s.id and at.device = p_device and x.id <> pt.id limit 1;
    if other is not null then
      raise exception 'This phone has already checked in % for this session. Use your own phone, or ask your facilitator to check you in.', other;
    end if;
  end if;
  a := public.ts_arrive(s.id, pt.id, p_device);
  return jsonb_build_object('participant', pt.id, 'token', pt.token, 'title', pt.title, 'name', pt.full_name,
                            'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'new', false);
end $$;

create or replace function public.tap_out(p_code text, p_token uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update public.attendance a set left_at = now()
    from public.sessions s, public.participants pt
   where a.session_id = s.id and a.participant_id = pt.id and s.attendance_code = upper(p_code) and pt.token = p_token
     and a.left_at is null and s.status <> 'completed'
  returning a.left_at into t;
  if t is null then raise exception 'Already tapped out, or not checked in'; end if;
  return t;
end $$;

-- What a phone shows about its own attendance: time in, time away, time spent.
create or replace function public.my_attendance(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('arrived_at', a.arrived_at, 'left_at', a.left_at, 'away_seconds', a.away_seconds, 'periods', a.periods,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds),
           'ended', s.status = 'completed', 'ended_at', s.ended_at)
    from public.sessions s join public.attendance a on a.session_id = s.id join public.participants pt on pt.id = a.participant_id
   where s.attendance_code = upper(p_code) and pt.token = p_token;
$$;

create or replace function public.room_items(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'url', i.url, 'target', i.target, 'at', i.created_at)
           order by i.created_at desc), '[]'::jsonb)
    from public.shared_items i join public.sessions s on s.id = i.session_id join public.programmes p on p.id = s.programme_id
   where s.attendance_code = upper(p_code) and not public.ts_closed(p)
     and exists (select 1 from public.attendance a join public.participants pt on pt.id = a.participant_id
                  where a.session_id = s.id and pt.token = p_token);
$$;

-- 4. Facilitator -------------------------------------------------------------------------------------
-- The register: who came, time away, time spent.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at,
           'away_seconds', a.away_seconds, 'periods', a.periods, 'preloaded', pt.preloaded,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds))
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;

-- Check someone in from the register (a shared phone, no phone, a late registration).
create or replace function public.facilitator_checkin(p_session uuid, p_title text, p_name text, p_email text, p_org text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; e text := lower(trim(coalesce(p_email,'')));
begin
  select * into s from public.sessions where id = p_session and owner_id = auth.uid();
  if s.id is null or not public.is_active() then raise exception 'Not your session'; end if;
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Enter the full name'; end if;
  insert into public.participants as x (programme_id, title, full_name, email, organisation)
  values (s.programme_id, left(coalesce(p_title,''),20), left(trim(p_name),160), e, left(trim(coalesce(p_org,'')),200))
  on conflict (programme_id, email) do update set
    title = coalesce(nullif(excluded.title,''), x.title), full_name = excluded.full_name,
    organisation = coalesce(nullif(excluded.organisation,''), x.organisation)
  returning * into pt;
  perform public.ts_arrive(s.id, pt.id, '');
  return jsonb_build_object('participant', pt.id, 'name', pt.full_name);
end $$;

-- Merge two records of the same person (two emails). Keeps p_keep; moves attendance and answers over.
create or replace function public.merge_participants(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k public.participants; d public.participants; r record;
begin
  select * into k from public.participants where id = p_keep;
  select * into d from public.participants where id = p_drop;
  if k.id is null or d.id is null or k.id = d.id or k.programme_id <> d.programme_id or not public.ts_owns_programme(k.programme_id) then
    raise exception 'Choose two different people from the same programme';
  end if;
  for r in select * from public.attendance where participant_id = d.id loop
    if exists (select 1 from public.attendance where session_id = r.session_id and participant_id = k.id) then
      update public.attendance set arrived_at = least(arrived_at, r.arrived_at),
             left_at = case when left_at is null or r.left_at is null then null else greatest(left_at, r.left_at) end
       where session_id = r.session_id and participant_id = k.id;
      delete from public.attendance where id = r.id;
    else
      update public.attendance set participant_id = k.id where id = r.id;
    end if;
  end loop;
  update public.responses x set participant_id = k.id where x.participant_id = d.id
     and not exists (select 1 from public.responses y where y.participant_id = k.id and y.activity_id = x.activity_id and y.run = x.run and y.step = x.step);
  update public.participants set preloaded = k.preloaded or d.preloaded, photo_url = coalesce(k.photo_url, d.photo_url),
         organisation = coalesce(nullif(k.organisation,''), d.organisation) where id = k.id;
  delete from public.participants where id = d.id;   -- leftover duplicate answers go with it
  -- keep the phone working: if only the dropped record was made on a phone, the kept one takes its phone key
  if k.photo_url is null and d.photo_url is not null then update public.participants set token = d.token where id = k.id; end if;
end $$;

-- End a session: the room closes on every phone. When every scheduled session has ended, the programme is completed.
create or replace function public.end_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; done boolean;
begin
  select * into s from public.sessions where id = p_session and owner_id = auth.uid();
  if s.id is null or not public.is_active() then raise exception 'Not your session'; end if;
  update public.sessions set status = 'completed', ended_at = coalesce(ended_at, now()), progress = 999 where id = s.id;
  update public.live_state set phase = 'idle', activity_id = null, updated_at = now() where session_id = s.id;
  done := not exists (select 1 from public.sessions where programme_id = s.programme_id and status in ('ready','live'));
  if done then update public.programmes set completed_at = coalesce(completed_at, now()) where id = s.programme_id; end if;
  return jsonb_build_object('programme_completed', done);
end $$;

-- Undo an end by mistake.
create or replace function public.reopen_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session and owner_id = auth.uid();
  if s.id is null or not public.is_active() then raise exception 'Not your session'; end if;
  update public.sessions set status = 'live', ended_at = null, progress = 0 where id = s.id;
  update public.programmes set completed_at = null where id = s.programme_id;
end $$;

-- Preloaded list: add or update people (rows: [{"title","name","email","org"}]).
create or replace function public.roster_import(p_programme uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; e text; n text; added int := 0; updated int := 0; skipped int := 0; was boolean;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 3000 then raise exception 'Import at most 3000 people at a time'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    e := lower(trim(coalesce(r->>'email','')));
    n := trim(regexp_replace(coalesce(r->>'name',''), '\s+', ' ', 'g'));
    if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(e) > 160 then skipped := skipped + 1; continue; end if;
    if char_length(n) < 3 then n := split_part(e, '@', 1); end if;
    if char_length(n) < 3 then n := e; end if;
    select true into was from public.participants where programme_id = p_programme and email = e;
    insert into public.participants as x (programme_id, title, full_name, email, organisation, preloaded)
    values (p_programme, left(coalesce(r->>'title',''),20), left(n,160), e, left(trim(coalesce(r->>'org','')),200), true)
    on conflict (programme_id, email) do update set preloaded = true,
      title = coalesce(nullif(excluded.title,''), x.title),
      organisation = coalesce(nullif(x.organisation,''), excluded.organisation);
    if was then updated := updated + 1; else added := added + 1; end if;
    was := null;
  end loop;
  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped);
end $$;

-- Remove from the preloaded list. People who already attended keep their record (and lose only the "preloaded" mark).
create or replace function public.roster_remove(p_participant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pt public.participants;
begin
  select * into pt from public.participants where id = p_participant;
  if pt.id is null or not public.ts_owns_programme(pt.programme_id) then raise exception 'Not found'; end if;
  if exists (select 1 from public.attendance where participant_id = pt.id) then
    update public.participants set preloaded = false where id = pt.id;
  else
    delete from public.participants where id = pt.id;
  end if;
end $$;

-- The programme's people: preloaded or checked in, with how many sessions each attended.
create or replace function public.programme_people(p_programme uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'preloaded', pt.preloaded,
           'sessions', (select count(*) from public.attendance a where a.participant_id = pt.id)) order by pt.full_name), '[]'::jsonb)
    from public.participants pt
   where pt.programme_id = p_programme and public.ts_owns_programme(p_programme);
$$;

grant execute on function public.checkin(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.checkin_again(text, uuid, text) to anon, authenticated;
grant execute on function public.my_attendance(text, uuid) to anon, authenticated;
grant execute on function public.facilitator_checkin(uuid, text, text, text, text) to authenticated;
grant execute on function public.merge_participants(uuid, uuid) to authenticated;
grant execute on function public.end_session(uuid) to authenticated;
grant execute on function public.reopen_session(uuid) to authenticated;
grant execute on function public.roster_import(uuid, jsonb) to authenticated;
grant execute on function public.roster_remove(uuid) to authenticated;
grant execute on function public.programme_people(uuid) to authenticated;
revoke all on function public.ts_arrive(uuid, uuid, text) from public, anon, authenticated;
