-- Training Suite — database, phase 2: participants, check-in / tap-out, the session room, shared files.
-- Run after schema.sql. Supabase → SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. Participants: one per person per programme (matched by email), so day 2 is a one-tap check-in.
create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  programme_id  uuid not null references public.programmes(id) on delete cascade,
  title         text not null default '' check (char_length(title) <= 20),
  full_name     text not null check (char_length(full_name) between 3 and 160),
  email         text not null check (char_length(email) between 5 and 160),
  organisation  text not null default '' check (char_length(organisation) <= 200),
  photo_url     text,
  token         uuid not null default gen_random_uuid(),   -- the phone's key for its own room and tap-out
  created_at    timestamptz not null default now(),
  unique (programme_id, email)
);
alter table public.participants enable row level security;
drop policy if exists "owner reads participants" on public.participants;
create policy "owner reads participants" on public.participants for select to authenticated
  using (exists (select 1 from public.programmes p where p.id = programme_id and p.owner_id = auth.uid()) and public.is_active());

-- 2. Attendance: one row per participant per session.
create table if not exists public.attendance (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  participant_id  uuid not null references public.participants(id) on delete cascade,
  arrived_at      timestamptz not null default now(),
  left_at         timestamptz,
  unique (session_id, participant_id)
);
create index if not exists attendance_session_idx on public.attendance (session_id, arrived_at);
alter table public.attendance enable row level security;
drop policy if exists "owner reads attendance" on public.attendance;
create policy "owner reads attendance" on public.attendance for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active());

-- 3. Items shared to the room (files and slides thrown from the presenting screen).
create table if not exists public.shared_items (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  kind        text not null default 'file' check (kind in ('file','slide','link')),
  name        text not null default '' check (char_length(name) <= 200),
  url         text not null check (char_length(url) <= 1000),
  target      text not null default 'all' check (target in ('all','A','B')),
  created_at  timestamptz not null default now()
);
create index if not exists shared_items_session_idx on public.shared_items (session_id, created_at desc);
alter table public.shared_items enable row level security;
drop policy if exists "owner manages shared items" on public.shared_items;
create policy "owner manages shared items" on public.shared_items for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active())
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = auth.uid()) and public.is_active());

-- 4. Public functions for participants' phones (no sign-in; the attendance code is the key) ----
-- What a phone may know about a session.
create or replace function public.public_session(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pkey', p.id, 'topic', s.topic, 'programme', p.name, 'course_lead', s.course_lead, 'date', s.session_date,
           'start_time', s.start_time, 'venue', s.venue, 'status', s.status, 'open', s.status in ('ready','live'))
    from public.sessions s join public.programmes p on p.id = s.programme_id
   where s.attendance_code = upper(p_code) and s.status <> 'draft';
$$;

-- Check in (or check in again). Returns the phone's token and whether this person is new to the programme.
create or replace function public.checkin(p_code text, p_title text, p_name text, p_email text, p_org text, p_photo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; a public.attendance; e text := lower(trim(coalesce(p_email,''))); fresh boolean := false;
begin
  select * into s from public.sessions where attendance_code = upper(p_code);
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  if s.status = 'completed' then raise exception 'This session has ended'; end if;
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Enter your full name'; end if;
  select * into pt from public.participants where programme_id = s.programme_id and email = e;
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
  insert into public.attendance (session_id, participant_id) values (s.id, pt.id)
  on conflict (session_id, participant_id) do update set left_at = null
  returning * into a;
  return jsonb_build_object('participant', pt.id, 'token', pt.token, 'title', pt.title, 'name', pt.full_name,
                            'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'new', fresh);
end $$;

-- A returning phone (same programme, token saved) checks in to today's session with one tap.
create or replace function public.checkin_again(p_code text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pt public.participants; a public.attendance;
begin
  select * into s from public.sessions where attendance_code = upper(p_code);
  if s.id is null or s.status in ('draft','completed') then raise exception 'This check-in code is not valid'; end if;
  select * into pt from public.participants where token = p_token and programme_id = s.programme_id;
  if pt.id is null then return null; end if;
  insert into public.attendance (session_id, participant_id) values (s.id, pt.id)
  on conflict (session_id, participant_id) do update set left_at = null
  returning * into a;
  return jsonb_build_object('participant', pt.id, 'token', pt.token, 'title', pt.title, 'name', pt.full_name,
                            'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'new', false);
end $$;

create or replace function public.tap_out(p_code text, p_token uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update public.attendance a set left_at = now()
    from public.sessions s, public.participants pt
   where a.session_id = s.id and a.participant_id = pt.id and s.attendance_code = upper(p_code) and pt.token = p_token and a.left_at is null
  returning a.left_at into t;
  if t is null then raise exception 'Already tapped out, or not checked in'; end if;
  return t;
end $$;

-- The room: what has been shared with this phone's session.
create or replace function public.room_items(p_code text, p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'url', i.url, 'target', i.target, 'at', i.created_at)
           order by i.created_at desc), '[]'::jsonb)
    from public.shared_items i join public.sessions s on s.id = i.session_id
   where s.attendance_code = upper(p_code)
     and exists (select 1 from public.attendance a join public.participants pt on pt.id = a.participant_id
                  where a.session_id = s.id and pt.token = p_token);
$$;

-- For the welcome screen and register (owner only): who is in, with photos.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at)
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;

-- 5. Storage: check-in photos and shared files are public (unguessable paths) so phones and the projector can show them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ts-photos', 'ts-photos', true, 1048576, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];
insert into storage.buckets (id, name, public, file_size_limit)
values ('ts-shared', 'ts-shared', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "ts check-in photo" on storage.objects;
create policy "ts check-in photo" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'ts-photos');
drop policy if exists "ts share files" on storage.objects;
create policy "ts share files" on storage.objects for insert to authenticated
  with check (bucket_id = 'ts-shared' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());

grant execute on function public.public_session(text) to anon, authenticated;
grant execute on function public.checkin(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.checkin_again(text, uuid) to anon, authenticated;
grant execute on function public.tap_out(text, uuid) to anon, authenticated;
grant execute on function public.room_items(text, uuid) to anon, authenticated;
grant execute on function public.session_roll(uuid) to authenticated;
