-- Training Suite — database: groups (any number, 2 to 12) and the participant's sex.
-- Groups belong to one session (fresh each session). The facilitator creates them in planning or on the live
-- screen: random, mixed by sex, mixed by MDA, same MDA together, or participants choose. People who arrive
-- later are placed automatically, keeping the mix. Answers and shared items use the group.
-- Run after schema-11-certificates.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. Columns ------------------------------------------------------------------------------------
alter table public.participants add column if not exists sex text not null default '';
alter table public.participants drop constraint if exists participants_sex_check;
alter table public.participants add constraint participants_sex_check check (sex in ('', 'male', 'female', 'na'));
-- { n, method: random|sex|mda_mix|mda_same|choose, names: [], aliases: { "moh": "ministry of health" } }
alter table public.sessions add column if not exists groups jsonb;
alter table public.attendance add column if not exists grp text not null default '';

-- Group keys: "1" to "12" (and the older A and B).
alter table public.responses drop constraint if exists responses_grp_check;
alter table public.responses add constraint responses_grp_check check (grp ~ '^(all|A|B|[1-9]|1[0-2])$');
alter table public.shared_items drop constraint if exists shared_items_target_check;
alter table public.shared_items add constraint shared_items_target_check check (target ~ '^(all|A|B|[1-9]|1[0-2])$');

-- 2. Placing one person -------------------------------------------------------------------------
create or replace function public.ts_mda(p_org text, p_aliases jsonb)
returns text language sql immutable as $$
  select coalesce(p_aliases->>public.ts_norm(p_org), public.ts_norm(p_org));
$$;

-- Put a person who has no group yet into the best group for the session's rule.
create or replace function public.ts_place(p_session uuid, p_participant uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s public.sessions; a public.attendance; pt public.participants; n int; m text; best int; k int; score numeric; top numeric; me_mda text; al jsonb;
begin
  select * into s from public.sessions where id = p_session;
  if s.groups is null or coalesce(s.groups->>'method','random') = 'choose' then return null; end if;
  select * into a from public.attendance where session_id = p_session and participant_id = p_participant;
  if a.id is null or a.grp <> '' then return a.grp; end if;
  select * into pt from public.participants where id = p_participant;
  n := greatest(2, least(12, coalesce((s.groups->>'n')::int, 2))); m := coalesce(s.groups->>'method', 'random');
  al := coalesce(s.groups->'aliases', '{}'::jsonb); me_mda := public.ts_mda(pt.organisation, al);
  for k in 1..n loop
    -- lower is better: same-sex or same-MDA count first (or, for "same MDA together", most of my MDA), then size
    select case
             when m = 'sex' then count(*) filter (where x.sex = pt.sex) * 1000
             when m = 'mda_mix' then count(*) filter (where public.ts_mda(x.organisation, al) = me_mda and me_mda <> '') * 1000
             when m = 'mda_same' then -count(*) filter (where public.ts_mda(x.organisation, al) = me_mda and me_mda <> '') * 1000
             else 0 end + count(*) + random() * 0.5
      into score
      from public.attendance y join public.participants x on x.id = y.participant_id
     where y.session_id = p_session and y.grp = k::text;
    if top is null or score < top then top := score; best := k; end if;
  end loop;
  update public.attendance set grp = best::text where id = a.id;
  return best::text;
end $$;

-- Arrivals are placed when the check-in finishes (deferred, so the sex given at check-in is known).
create or replace function public.ts_place_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ts_place(new.session_id, new.participant_id);
  return null;
end $$;
drop trigger if exists ts_place_on_arrival on public.attendance;
create constraint trigger ts_place_on_arrival after insert on public.attendance
  deferrable initially deferred for each row execute function public.ts_place_trg();

-- An answer always counts for the group the person is in.
create or replace function public.ts_resp_grp()
returns trigger language plpgsql security definer set search_path = public as $$
declare g text;
begin
  select a.grp into g from public.attendance a where a.session_id = new.session_id and a.participant_id = new.participant_id;
  if coalesce(g, '') <> '' then new.grp := g; end if;
  return new;
end $$;
drop trigger if exists ts_resp_grp on public.responses;
create trigger ts_resp_grp before insert on public.responses for each row execute function public.ts_resp_grp();

-- 3. Phones ---------------------------------------------------------------------------------------
-- Check in with the sex question (same as checkin, plus sex). Falls back to checkin on older databases.
create or replace function public.checkin_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sx text := coalesce(p->>'sex', '');
begin
  if sx not in ('', 'male', 'female', 'na') then sx := ''; end if;
  r := public.checkin(p->>'code', p->>'title', p->>'name', p->>'email', p->>'org', p->>'photo', coalesce(p->>'device', ''));
  if sx <> '' then update public.participants set sex = sx where id = (r->>'participant')::uuid; end if;
  return r;
end $$;

create or replace function public.set_my_sex(p_code text, p_token uuid, p_sex text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  if p_sex not in ('', 'male', 'female', 'na') then raise exception 'Pick one of the choices'; end if;
  select * into me from public.ts_participant(p_code, p_token);
  if me.participant_id is null then raise exception 'Check in first'; end if;
  update public.participants set sex = p_sex where id = me.participant_id;
end $$;

create or replace function public.my_group(p_code text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; s public.sessions; g text;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then return null; end if;
  select * into s from public.sessions where id = me.session_id;
  if s.groups is null then return jsonb_build_object('groups', null); end if;
  g := public.ts_place(s.id, me.participant_id);
  select grp into g from public.attendance where session_id = s.id and participant_id = me.participant_id;
  return jsonb_build_object('groups', s.groups - 'aliases', 'grp', coalesce(g, ''),
           'mates', (select coalesce(jsonb_agg(public.ts_display_name(x.title, x.full_name) order by x.full_name), '[]'::jsonb)
                       from public.attendance y join public.participants x on x.id = y.participant_id
                      where y.session_id = s.id and y.grp = g and g <> '' and x.id <> me.participant_id));
end $$;

create or replace function public.choose_group(p_code text, p_token uuid, p_grp text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; s public.sessions;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into s from public.sessions where id = me.session_id;
  if s.groups is null or coalesce(s.groups->>'method','') <> 'choose' then raise exception 'Your facilitator places people in groups for this session'; end if;
  if p_grp !~ '^([1-9]|1[0-2])$' or p_grp::int > (s.groups->>'n')::int then raise exception 'Pick one of the groups'; end if;
  update public.attendance set grp = p_grp where session_id = s.id and participant_id = me.participant_id;
end $$;

-- MDAs already entered in this programme, as suggestions while typing (names of organisations only).
create or replace function public.mda_list(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(o order by c desc, o), '[]'::jsonb) from (
    select min(trim(pt.organisation)) o, count(*) c from public.participants pt join public.sessions s on s.programme_id = pt.programme_id
     where s.attendance_code = upper(p_code) and s.status <> 'draft' and trim(pt.organisation) <> ''
     group by public.ts_norm(pt.organisation) order by c desc limit 200) t;
$$;

-- 4. Facilitator ----------------------------------------------------------------------------------
-- Save the groups and who is in each (the page works out the mix): assign = { participant_id: "3", ... }
create or replace function public.set_groups(p_session uuid, p_config jsonb, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  if p_config is not null and ((p_config->>'n')::int not between 2 and 12) then raise exception 'Use 2 to 12 groups'; end if;
  update public.sessions set groups = p_config where id = p_session;
  if p_config is null then update public.attendance set grp = '' where session_id = p_session; return; end if;
  if p_assign is not null then
    update public.attendance a set grp = coalesce(nullif(p_assign->>(a.participant_id::text), ''), '')
     where a.session_id = p_session;
  end if;
end $$;

create or replace function public.move_to_group(p_session uuid, p_participant uuid, p_grp text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ts_owns_session(p_session) then raise exception 'Not your session'; end if;
  if p_grp <> '' and p_grp !~ '^([1-9]|1[0-2])$' then raise exception 'Unknown group'; end if;
  update public.attendance set grp = p_grp where session_id = p_session and participant_id = p_participant;
end $$;

-- The register, now with group and sex.
create or replace function public.session_roll(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
           'organisation', pt.organisation, 'photo', pt.photo_url, 'arrived_at', a.arrived_at, 'left_at', a.left_at,
           'away_seconds', a.away_seconds, 'periods', a.periods, 'preloaded', pt.preloaded, 'rejoins', a.rejoins,
           'sex', pt.sex, 'grp', a.grp,
           'spent_seconds', public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds))
           order by a.arrived_at), '[]'::jsonb)
    from public.attendance a join public.participants pt on pt.id = a.participant_id join public.sessions s on s.id = a.session_id
   where a.session_id = p_session and s.owner_id = auth.uid() and public.is_active();
$$;

grant execute on function public.checkin_v2(jsonb) to anon, authenticated;
grant execute on function public.mda_list(text) to anon, authenticated;
grant execute on function public.set_my_sex(text, uuid, text) to anon, authenticated;
grant execute on function public.my_group(text, uuid) to anon, authenticated;
grant execute on function public.choose_group(text, uuid, text) to anon, authenticated;
grant execute on function public.set_groups(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.move_to_group(uuid, uuid, text) to authenticated;
revoke all on function public.ts_place(uuid, uuid) from public, anon, authenticated;
