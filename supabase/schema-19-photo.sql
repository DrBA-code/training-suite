-- Training Suite — database: photo at check-in.
-- Each programme chooses: a selfie is required (the default), the person chooses a selfie or an avatar, or avatars only.
-- An avatar is a picture made on the phone (an emoji on a colour); it is kept like a photo, and marked as an avatar.
-- Run after schema-18-venue.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.programmes add column if not exists photo_mode text not null default 'selfie' check (photo_mode in ('selfie','choice','avatar'));
alter table public.participants add column if not exists avatar text check (char_length(avatar) <= 40);   -- the emoji and colour, when they chose an avatar

-- Check in, with the venue rule (schema-18) and the photo rule.
create or replace function public.checkin_v3(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sessions; pr public.programmes; g jsonb; r jsonb; e text := lower(trim(coalesce(p->>'email', '')));
        ph text := coalesce(p->>'photo', ''); av text := nullif(trim(coalesce(p->>'avatar', '')), ''); had text;
begin
  select * into s from public.sessions where attendance_code = upper(p->>'code');
  if s.id is null or s.status = 'draft' then raise exception 'This check-in code is not valid'; end if;
  select * into pr from public.programmes where id = s.programme_id;
  select photo_url into had from public.participants where programme_id = s.programme_id and email = e;
  if pr.photo_mode = 'selfie' and av is not null then raise exception 'A selfie is needed for this programme: an avatar can''t be used.'; end if;
  if pr.photo_mode = 'avatar' and av is null then ph := ''; end if;   -- avatars only: no face photo is kept
  if pr.photo_mode in ('selfie','choice') and ph = '' and had is null then
    raise exception 'Your photo didn''t upload. Check the connection and tap Check me in again.';
  end if;
  g := public.ts_venue_gate(s.id, p, e);
  r := public.checkin_v2(p || jsonb_build_object('photo', ph));
  update public.participants set avatar = case when av is not null then left(av, 40) when ph <> '' then null else avatar end
   where id = (r->>'participant')::uuid;
  perform public.ts_venue_note(s.id, (r->>'participant')::uuid, g);
  return r || jsonb_build_object('mode', g->>'mode');
end $$;

create or replace function public.public_session(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pkey', p.id, 'topic', s.topic, 'programme', p.name, 'course_lead', s.course_lead, 'date', s.session_date,
           'start_time', s.start_time, 'venue', s.venue, 'status', s.status, 'open', s.status in ('ready','live'),
           'ended', s.status = 'completed', 'roster_only', p.roster_only, 'closed', public.ts_closed(p),
           'programme_completed', p.completed_at is not null,
           'closes_at', case when p.completed_at is not null then p.completed_at + make_interval(days => p.access_days) end,
           'delivery', p.delivery, 'geo', coalesce(s.venue_geo, p.venue_geo) is not null, 'photo_mode', p.photo_mode)
    from public.sessions s join public.programmes p on p.id = s.programme_id
   where s.attendance_code = upper(p_code) and s.status <> 'draft';
$$;

grant execute on function public.checkin_v3(jsonb) to anon, authenticated;
grant execute on function public.public_session(text) to anon, authenticated;
