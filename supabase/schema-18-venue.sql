-- Training Suite — database: venue check (on-site programmes) and on-site / online attendance (hybrid programmes).
-- • A programme is "on-site only", "hybrid" or not set (as before).
-- • At the venue, the planner registers the venue's location and how wide it is. For an on-site programme, phones
--   must be within that area to check in or get back in. In a hybrid programme, people say whether they are at the
--   venue or online, and the venue check applies only to those at the venue.
-- • If a phone can't prove it's there (weak GPS indoors, location off), the person can ask the facilitator to let them in.
-- • Only the result is kept ("at the venue, 40 m"), never where the person was.
-- Run after schema-17-focus-live.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.programmes add column if not exists delivery text check (delivery in ('onsite','hybrid'));
alter table public.programmes add column if not exists venue_geo jsonb;   -- { lat, lng, radius, acc, at }
alter table public.sessions   add column if not exists venue_geo jsonb;   -- this session only, when it is held somewhere else
alter table public.attendance add column if not exists mode text check (mode in ('venue','online'));
alter table public.attendance add column if not exists venue_check jsonb; -- { how: 'gps' | 'let_in', m, acc, at }

-- People waiting to be let in by the facilitator.
create table if not exists public.venue_waits (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 200),
  email       text not null default '' check (char_length(email) <= 160),
  status      text not null default 'wait' check (status in ('wait','let','no')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  used_at     timestamptz
);
create index if not exists venue_waits_session_idx on public.venue_waits (session_id, created_at desc);
alter table public.venue_waits enable row level security;   -- reached only through the functions below

-- Distance in metres between two points (haversine).
create or replace function public.ts_dist_m(a_lat float8, a_lng float8, b_lat float8, b_lng float8)
returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)));
$$;

-- The rule for one check-in. Returns { mode, check } or raises an error the phone understands:
-- 'venue:need' (location needed), 'venue:weak' (location too rough), 'venue:far:<metres>'.
create or replace function public.ts_venue_gate(p_session uuid, p jsonb, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pr public.programmes; v jsonb; md text := p->>'mode'; w public.venue_waits;
        lat float8; lng float8; acc float8; d float8; r float8;
begin
  select * into s from public.sessions where id = p_session;
  select * into pr from public.programmes where id = s.programme_id;
  if pr.delivery = 'onsite' then md := 'venue';
  elsif pr.delivery = 'hybrid' then if md not in ('venue','online') then md := null; end if;
  else md := null; end if;
  v := coalesce(s.venue_geo, pr.venue_geo);
  if md is distinct from 'venue' or v is null then return jsonb_build_object('mode', md, 'check', null); end if;
  -- let in by the facilitator
  if nullif(p->>'pass', '') is not null then
    select * into w from public.venue_waits where id = (p->>'pass')::uuid and session_id = s.id;
    if w.id is not null and w.status = 'let' and w.used_at is null and lower(w.email) = lower(coalesce(p_email, '')) then
      update public.venue_waits set used_at = now() where id = w.id;
      return jsonb_build_object('mode', 'venue', 'check', jsonb_build_object('how', 'let_in', 'at', now()));
    end if;
  end if;
  begin
    lat := (p->'geo'->>'lat')::float8; lng := (p->'geo'->>'lng')::float8; acc := greatest(0, coalesce((p->'geo'->>'acc')::float8, 9999));
  exception when others then lat := null; end;
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'venue:need'; end if;
  if acc > 1500 then raise exception 'venue:weak'; end if;
  d := public.ts_dist_m(lat, lng, (v->>'lat')::float8, (v->>'lng')::float8);
  r := coalesce((v->>'radius')::float8, 150);
  -- allow for the phone's stated accuracy, but only up to 100 m, so a rough fix far away doesn't pass
  if d > r + least(acc, 100) then raise exception 'venue:far:%', round(d)::int; end if;
  return jsonb_build_object('mode', 'venue', 'check', jsonb_build_object('how', 'gps', 'm', round(d)::int, 'acc', round(acc)::int, 'at', now()));
end $$;

create or replace function public.ts_venue_note(p_session uuid, p_participant uuid, g jsonb)
returns void language sql security definer set search_path = public as $$
  update public.attendance set mode = coalesce(g->>'mode', mode), venue_check = coalesce(g->'check', venue_check)
   where session_id = p_session and participant_id = p_participant;
$$;

-- Phones: check in, get back in by email, and one-tap check-in again — each with the venue rule.
create or replace function public.checkin_v3(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; g jsonb; r jsonb;
begin
  select * into s from public.sessions where attendance_code = upper(p->>'code');
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  g := public.ts_venue_gate(s.id, p, lower(trim(coalesce(p->>'email', ''))));
  r := public.checkin_v2(p);
  perform public.ts_venue_note(s.id, (r->>'participant')::uuid, g);
  return r || jsonb_build_object('mode', g->>'mode');
end $$;

create or replace function public.rejoin_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; g jsonb := '{}'; r jsonb;
begin
  select * into s from public.sessions where attendance_code = upper(p->>'code');
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  if s.status <> 'completed' then g := public.ts_venue_gate(s.id, p, lower(trim(coalesce(p->>'email', '')))); end if;
  r := public.rejoin(p->>'code', p->>'email', coalesce(p->>'device', ''));
  if s.status <> 'completed' then perform public.ts_venue_note(s.id, (r->>'participant')::uuid, g); end if;
  return r || jsonb_build_object('mode', g->>'mode');
end $$;

create or replace function public.checkin_again_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; g jsonb; r jsonb;
begin
  select * into s from public.sessions where attendance_code = upper(p->>'code');
  if s.id is null or s.status in ('draft','completed') then raise exception 'This check-in code is not valid'; end if;
  begin select * into pt from public.participants where token = (p->>'token')::uuid and programme_id = s.programme_id;
  exception when others then return null; end;
  if pt.id is null then return null; end if;
  g := public.ts_venue_gate(s.id, p, pt.email);
  r := public.checkin_again(p->>'code', pt.token, coalesce(p->>'device', ''));
  if r is not null then perform public.ts_venue_note(s.id, pt.id, g); end if;
  return r || jsonb_build_object('mode', g->>'mode');
end $$;

-- Phones: ask the facilitator to be let in, then wait for the answer.
create or replace function public.venue_ask(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; e text := lower(trim(coalesce(p->>'email', ''))); n text := trim(coalesce(p->>'name', '')); w uuid;
begin
  select * into s from public.sessions where attendance_code = upper(p->>'code');
  if s.id is null or s.status in ('draft','completed') then raise exception 'This check-in code is not valid'; end if;
  if nullif(p->>'token', '') is not null then
    begin select * into pt from public.participants where token = (p->>'token')::uuid and programme_id = s.programme_id; exception when others then null; end;
    if pt.id is not null then e := pt.email; n := public.ts_display_name(pt.title, pt.full_name); end if;
  end if;
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if n = '' then select public.ts_display_name(x.title, x.full_name) into n from public.participants x where x.programme_id = s.programme_id and x.email = e; end if;
  if (select count(*) from public.venue_waits where session_id = s.id and status = 'wait') >= 300 then raise exception 'Too many people are waiting. Please see the facilitator.'; end if;
  select id into w from public.venue_waits where session_id = s.id and email = e and status = 'wait' and created_at > now() - interval '2 hours';
  if w is null then insert into public.venue_waits (session_id, name, email) values (s.id, left(coalesce(nullif(n, ''), e), 200), left(e, 160)) returning id into w; end if;
  return w;
end $$;

create or replace function public.venue_wait(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from public.venue_waits where id = p_id;
$$;

-- Facilitator: who is waiting, and the answer.
create or replace function public.session_venue_waits(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.ts_owns_session(p_session) then null else coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'at', created_at) order by created_at)
    from public.venue_waits where session_id = p_session and status = 'wait' and created_at > now() - interval '2 hours'), '[]'::jsonb) end;
$$;

create or replace function public.venue_answer(p_id uuid, p_let boolean)
returns void language plpgsql security definer set search_path = public as $$
declare w public.venue_waits;
begin
  select * into w from public.venue_waits where id = p_id;
  if w.id is null or not public.ts_owns_session(w.session_id) then raise exception 'Not your session'; end if;
  update public.venue_waits set status = case when p_let then 'let' else 'no' end, answered_at = now() where id = p_id;
end $$;

-- Facilitator: register the venue where you are standing (for the whole programme, or this session only), or clear it.
create or replace function public.set_venue(p_session uuid, p_geo jsonb, p_scope text default 'programme')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; v jsonb := null;
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  select * into s from public.sessions where id = p_session;
  if p_geo is not null then
    if (p_geo->>'lat')::float8 not between -90 and 90 or (p_geo->>'lng')::float8 not between -180 and 180 then raise exception 'That location is not valid'; end if;
    v := jsonb_build_object('lat', round((p_geo->>'lat')::numeric, 6), 'lng', round((p_geo->>'lng')::numeric, 6),
           'radius', greatest(50, least(1000, coalesce((p_geo->>'radius')::int, 150))),
           'acc', round(greatest(0, coalesce((p_geo->>'acc')::numeric, 0))), 'at', now());
  end if;
  if p_scope = 'session' then update public.sessions set venue_geo = v where id = s.id;
  else
    update public.programmes set venue_geo = v where id = s.programme_id;
    update public.sessions set venue_geo = null where id = s.id;   -- the programme's venue applies here again
  end if;
  return v;
end $$;

-- What the check-in page needs to know.
create or replace function public.public_session(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pkey', p.id, 'topic', s.topic, 'programme', p.name, 'course_lead', s.course_lead, 'date', s.session_date,
           'start_time', s.start_time, 'venue', s.venue, 'status', s.status, 'open', s.status in ('ready','live'),
           'ended', s.status = 'completed', 'roster_only', p.roster_only, 'closed', public.ts_closed(p),
           'programme_completed', p.completed_at is not null,
           'closes_at', case when p.completed_at is not null then p.completed_at + make_interval(days => p.access_days) end,
           'delivery', p.delivery, 'geo', coalesce(s.venue_geo, p.venue_geo) is not null)
    from public.sessions s join public.programmes p on p.id = s.programme_id
   where s.attendance_code = upper(p_code) and s.status <> 'draft';
$$;

-- The register, now with where each person attended from.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at,
           'away_seconds', a.away_seconds, 'periods', a.periods, 'preloaded', pt.preloaded, 'rejoins', a.rejoins,
           'sex', pt.sex, 'grp', a.grp, 'focus_leaves', a.focus_leaves, 'focus_away', a.focus_away, 'focus_accepted', a.focus_accepted_at is not null,
           'mode', a.mode, 'venue_check', a.venue_check,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds))
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;

grant execute on function public.checkin_v3(jsonb) to anon, authenticated;
grant execute on function public.rejoin_v2(jsonb) to anon, authenticated;
grant execute on function public.checkin_again_v2(jsonb) to anon, authenticated;
grant execute on function public.venue_ask(jsonb) to anon, authenticated;
grant execute on function public.venue_wait(uuid) to anon, authenticated;
grant execute on function public.session_venue_waits(uuid) to authenticated;
grant execute on function public.venue_answer(uuid, boolean) to authenticated;
grant execute on function public.set_venue(uuid, jsonb, text) to authenticated;
grant execute on function public.public_session(text) to anon, authenticated;
grant execute on function public.session_roll(uuid) to authenticated;
-- The older ways in skip the venue rule, so phones now use only the ones above.
revoke all on function public.ts_venue_gate(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.ts_venue_note(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.checkin(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.checkin_v2(jsonb) from public, anon, authenticated;
revoke all on function public.rejoin(text, text, text) from public, anon, authenticated;
revoke all on function public.checkin_again(text, uuid, text) from public, anon, authenticated;
