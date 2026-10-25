-- Training Suite — database, step 6 of the roadmap: certificates.
-- Certificates belong to the programme (one session or many). The programme lead sets the design and the rules,
-- reviews who qualifies, and issues. Each certificate has a number and a QR code that anyone can check.
-- Run after schema-10-rejoin.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. Settings ------------------------------------------------------------------------------------
-- Rules (all settable): a session counts as attended when the person was in the room for time_pct of it;
-- they qualify when they attended attend_pct of the programme's sessions, plus an optional post-test pass mark
-- and an optional "filled the evaluation".
alter table public.programmes add column if not exists cert_rules jsonb not null
  default '{"attend_pct":75,"time_pct":75,"pass_mark":null,"eval":false}';
-- When the live session started (for "time in the room" as a share of the session).
alter table public.sessions add column if not exists started_at timestamptz;
-- The participant confirmed the name on their certificate.
alter table public.participants add column if not exists name_confirmed_at timestamptz;

create or replace function public.ts_mark_started()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and new.started_at is null then new.started_at := now(); end if;
  return new;
end $$;
drop trigger if exists ts_started on public.sessions;
create trigger ts_started before insert or update of status on public.sessions
  for each row execute function public.ts_mark_started();

-- 2. Certificates ----------------------------------------------------------------------------------
create table if not exists public.certificates (
  id             uuid primary key default gen_random_uuid(),
  programme_id   uuid not null references public.programmes(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  number         text not null unique,
  name           text not null,                       -- as printed, with title
  status         text not null default 'valid' check (status in ('valid','revoked','replaced')),
  issued_at      timestamptz not null default now(),
  note           text not null default '',             -- why the lead included someone who didn't meet the rules
  reason         text not null default '',             -- why it was revoked
  replaced_by    uuid references public.certificates(id) on delete set null,
  design         jsonb not null default '{}',          -- the design at the time of issue
  info           jsonb not null default '{}',          -- programme name, dates, venue at the time of issue
  downloads      int not null default 0,
  downloaded_at  timestamptz
);
create index if not exists certificates_programme_idx on public.certificates (programme_id);
create unique index if not exists certificates_one_valid on public.certificates (programme_id, participant_id) where status = 'valid';
alter table public.certificates enable row level security;
drop policy if exists "owner reads certificates" on public.certificates;
create policy "owner reads certificates" on public.certificates for select to authenticated
  using (public.ts_owns_programme(programme_id));

-- A number that can't be guessed in sequence: TS-2026-7K3M9Q
create or replace function public.ts_cert_number()
returns text language plpgsql volatile set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := 'TS-' || to_char(now(), 'YYYY') || '-' ||
         (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.certificates where number = c);
  end loop;
  return c;
end $$;

create or replace function public.ts_display_name(p_title text, p_name text)
returns text language sql immutable as $$
  select trim(case when coalesce(p_title,'') = '' then '' when p_title in ('Miss','Ms') then p_title || ' ' else p_title || '. ' end || coalesce(p_name,''));
$$;

-- What prints on the certificate besides the name.
create or replace function public.ts_cert_info(p_programme uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('programme', p.name, 'code', p.code, 'dates', p.dates, 'venue', p.venue,
           'first', (select min(session_date) from public.sessions where programme_id = p.id and status <> 'draft'),
           'last',  (select max(session_date) from public.sessions where programme_id = p.id and status <> 'draft'),
           'sessions', (select count(*) from public.sessions where programme_id = p.id and status <> 'draft'))
    from public.programmes p where p.id = p_programme;
$$;

-- The programme's last session (by date, then by when it was made).
create or replace function public.ts_last_session(p_programme uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sessions where programme_id = p_programme and status <> 'draft'
   order by session_date desc nulls last, created_at desc limit 1;
$$;

-- 3. Who qualifies -----------------------------------------------------------------------------------
create or replace function public.ts_cert_people(p_programme uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.programmes; r jsonb; tp numeric; ap numeric; pm numeric; ev boolean; n_sess int; out jsonb := '[]'::jsonb;
        pt record; per jsonb; attended int; posts numeric[]; post numeric; ev_need int; ev_done int; why jsonb; c public.certificates;
        x record; pct numeric;
begin
  select * into p from public.programmes where id = p_programme;
  r := coalesce(p.cert_rules, '{}'::jsonb);
  tp := coalesce((r->>'time_pct')::numeric, 75); ap := coalesce((r->>'attend_pct')::numeric, 75);
  pm := (r->>'pass_mark')::numeric; ev := coalesce((r->>'eval')::boolean, false);
  select count(*) into n_sess from public.sessions where programme_id = p.id and status <> 'draft';
  for pt in select * from public.participants where programme_id = p.id order by full_name loop
    per := '[]'::jsonb; attended := 0; posts := '{}'; ev_need := 0; ev_done := 0;
    for x in
      select s.id, s.topic, s.session_date, s.status, s.evaluation, a.id as att,
             public.ts_spent(a.arrived_at, a.left_at, s.ended_at, a.away_seconds) as spent,
             greatest(1, floor(extract(epoch from (coalesce(s.ended_at, now()) -
               coalesce(s.started_at, (select min(arrived_at) from public.attendance z where z.session_id = s.id))))))::int as span,
             (select 100.0 * sum(coalesce(rr.score,0)) / greatest(max(jsonb_array_length(coalesce(ac.data->'steps','[]'::jsonb))),1)
                from public.activities ac join public.responses rr on rr.activity_id = ac.id
               where ac.session_id = s.id and ac.slot = 'test' and rr.run = 'post' and rr.participant_id = pt.id) as post,
             exists (select 1 from public.evaluations e where e.session_id = s.id and e.participant_id = pt.id) as evd
        from public.sessions s left join public.attendance a on a.session_id = s.id and a.participant_id = pt.id
       where s.programme_id = p.id and s.status <> 'draft'
       order by s.session_date nulls last, s.created_at
    loop
      pct := case when x.att is null then 0 else least(100, round(100.0 * x.spent / x.span)) end;
      if x.att is not null and pct >= tp then attended := attended + 1; end if;
      if x.post is not null then posts := posts || x.post; end if;
      if x.att is not null and coalesce(x.evaluation->>'mode','default') <> 'none' then
        ev_need := ev_need + 1; if x.evd then ev_done := ev_done + 1; end if;
      end if;
      per := per || jsonb_build_object('session', x.id, 'topic', x.topic, 'date', x.session_date, 'here', x.att is not null, 'pct', pct);
    end loop;
    post := (select round(avg(v)) from unnest(posts) v);
    why := '[]'::jsonb;
    if n_sess = 0 or 100.0 * attended / n_sess < ap then
      why := why || to_jsonb(case
        when n_sess = 0 then 'The programme has no sessions yet'
        when n_sess = 1 and not (per->0->>'here')::boolean then 'Didn''t attend the session'
        when n_sess = 1 then format('In the room for %s%% of the session (needs %s%%)', per->0->>'pct', tp)
        else format('Attended %s of %s sessions with %s%% or more time in the room (needs %s)', attended, n_sess, tp, greatest(1, ceil(n_sess * ap / 100.0)::int)) end);
    end if;
    if pm is not null and coalesce(post, -1) < pm then
      why := why || to_jsonb(case when post is null then format('No post-test score (pass mark %s%%)', pm) else format('Post-test %s%% (pass mark %s%%)', post, pm) end);
    end if;
    if ev and (ev_need = 0 or ev_done < ev_need) then
      why := why || to_jsonb(format('Evaluation filled for %s of %s session%s', ev_done, ev_need, case when ev_need = 1 then '' else 's' end));
    end if;
    select * into c from public.certificates where programme_id = p.id and participant_id = pt.id
     order by (status = 'valid') desc, issued_at desc limit 1;
    out := out || jsonb_build_object('participant', pt.id, 'title', pt.title, 'name', pt.full_name, 'email', pt.email,
             'organisation', pt.organisation, 'photo', pt.photo_url, 'preloaded', pt.preloaded, 'name_confirmed', pt.name_confirmed_at is not null,
             'sessions', n_sess, 'attended', attended, 'per', per, 'post', post, 'eval_done', ev_done, 'eval_need', ev_need,
             'qualifies', jsonb_array_length(why) = 0, 'why', why,
             'cert', case when c.id is null then null else jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status,
                       'name', c.name, 'issued_at', c.issued_at, 'downloads', c.downloads, 'note', c.note, 'reason', c.reason) end);
  end loop;
  return out;
end $$;

create or replace function public.programme_certificates(p_programme uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.programmes;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  select * into p from public.programmes where id = p_programme;
  return jsonb_build_object('on', p.certificates, 'rules', p.cert_rules, 'design', p.cert_design, 'info', public.ts_cert_info(p.id),
           'completed', p.completed_at is not null, 'last_session', public.ts_last_session(p.id),
           'people', public.ts_cert_people(p.id));
end $$;

-- 4. Issue, reissue, revoke ------------------------------------------------------------------------
create or replace function public.issue_certificates(p_programme uuid, p_people uuid[], p_notes jsonb default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare p public.programmes; pt public.participants; n int := 0; info jsonb;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  select * into p from public.programmes where id = p_programme;
  if not p.certificates then raise exception 'Certificates are off for this programme. Turn them on first.'; end if;
  info := public.ts_cert_info(p.id);
  for pt in select * from public.participants where programme_id = p.id and id = any(p_people) loop
    if exists (select 1 from public.certificates where programme_id = p.id and participant_id = pt.id and status = 'valid') then continue; end if;
    insert into public.certificates (programme_id, participant_id, number, name, design, info, note)
    values (p.id, pt.id, public.ts_cert_number(), public.ts_display_name(pt.title, pt.full_name), p.cert_design, info,
            left(coalesce(p_notes->>(pt.id::text), ''), 300));
    n := n + 1;
  end loop;
  return n;
end $$;

-- A new certificate (new number) with today's name and design; the old one shows "replaced".
create or replace function public.reissue_certificate(p_cert uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.certificates; p public.programmes; pt public.participants; nw public.certificates;
begin
  select * into c from public.certificates where id = p_cert;
  if c.id is null or not public.ts_owns_programme(c.programme_id) then raise exception 'Not your certificate'; end if;
  select * into p from public.programmes where id = c.programme_id;
  select * into pt from public.participants where id = c.participant_id;
  update public.certificates set status = 'replaced' where id = c.id and status = 'valid';
  insert into public.certificates (programme_id, participant_id, number, name, design, info, note)
  values (p.id, pt.id, public.ts_cert_number(), public.ts_display_name(pt.title, pt.full_name), p.cert_design, public.ts_cert_info(p.id), c.note)
  returning * into nw;
  update public.certificates set replaced_by = nw.id where id = c.id;
  return jsonb_build_object('id', nw.id, 'number', nw.number);
end $$;

create or replace function public.revoke_certificate(p_cert uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.certificates;
begin
  select * into c from public.certificates where id = p_cert;
  if c.id is null or not public.ts_owns_programme(c.programme_id) then raise exception 'Not your certificate'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Give a reason for revoking'; end if;
  update public.certificates set status = 'revoked', reason = left(trim(p_reason), 300) where id = c.id and status = 'valid';
end $$;

-- 5. Anyone: check a certificate by its number (the QR code opens this) ------------------------------
create or replace function public.verify_certificate(p_number text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', c.number, 'name', c.name, 'status', c.status, 'issued_at', c.issued_at, 'reason', c.reason,
           'programme', c.info->>'programme', 'dates', c.info->>'dates', 'first', c.info->>'first', 'last', c.info->>'last', 'venue', c.info->>'venue',
           'org', c.design->>'org', 'title', c.design->>'title', 'kind', c.design->>'kind',
           'signatories', (select coalesce(jsonb_agg(jsonb_build_object('name', s->>'name', 'title', s->>'title')), '[]'::jsonb)
                             from jsonb_array_elements(coalesce(c.design->'signatories','[]'::jsonb)) s where coalesce(s->>'name','') <> ''),
           'replaced_by', (select number from public.certificates n where n.id = c.replaced_by))
    from public.certificates c where c.number = upper(trim(p_number));
$$;

-- 6. Phones -------------------------------------------------------------------------------------------
create or replace function public.my_certificate(p_code text, p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record; s public.sessions; p public.programmes; pt public.participants; c public.certificates;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then return null; end if;
  select * into s from public.sessions where id = me.session_id;
  select * into p from public.programmes where id = s.programme_id;
  select * into pt from public.participants where id = me.participant_id;
  select * into c from public.certificates where programme_id = p.id and participant_id = pt.id and status = 'valid';
  return jsonb_build_object('on', p.certificates, 'last_session', public.ts_last_session(p.id) = s.id,
           'title', pt.title, 'name', pt.full_name, 'confirmed', pt.name_confirmed_at is not null,
           'cert', case when c.id is null then null else jsonb_build_object('number', c.number, 'name', c.name, 'issued_at', c.issued_at,
                     'design', c.design, 'info', c.info) end);
end $$;

-- Fix or confirm the name before the certificate is issued.
create or replace function public.confirm_cert_name(p_code text, p_token uuid, p_title text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; pt public.participants;
begin
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Enter your full name'; end if;
  if exists (select 1 from public.certificates c join public.participants x on x.id = c.participant_id
              where c.participant_id = me.participant_id and c.status = 'valid') then
    raise exception 'Your certificate has already been issued. Ask your facilitator to reissue it with the new name.';
  end if;
  update public.participants set title = left(coalesce(p_title, title), 20), full_name = left(trim(regexp_replace(p_name, '\s+', ' ', 'g')), 160),
         name_confirmed_at = now()
   where id = me.participant_id returning * into pt;
  return jsonb_build_object('title', pt.title, 'name', pt.full_name);
end $$;

create or replace function public.cert_downloaded(p_code text, p_token uuid)
returns void language sql security definer set search_path = public as $$
  update public.certificates c set downloads = downloads + 1, downloaded_at = now()
    from public.ts_participant(p_code, p_token) me join public.sessions s on s.id = me.session_id
   where c.participant_id = me.participant_id and c.programme_id = s.programme_id and c.status = 'valid';
$$;

-- 7. Storage for logos, signatures and uploaded designs (public, so phones can draw certificates) --
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ts-certs', 'ts-certs', true, 10485760, array['image/png','image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/png','image/jpeg'];
drop policy if exists "ts cert assets" on storage.objects;
create policy "ts cert assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'ts-certs' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());

grant execute on function public.programme_certificates(uuid) to authenticated;
grant execute on function public.issue_certificates(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.reissue_certificate(uuid) to authenticated;
grant execute on function public.revoke_certificate(uuid, text) to authenticated;
grant execute on function public.verify_certificate(text) to anon, authenticated;
grant execute on function public.my_certificate(text, uuid) to anon, authenticated;
grant execute on function public.confirm_cert_name(text, uuid, text, text) to anon, authenticated;
grant execute on function public.cert_downloaded(text, uuid) to anon, authenticated;
revoke all on function public.ts_cert_people(uuid) from public, anon, authenticated;
revoke all on function public.ts_cert_info(uuid) from public, anon, authenticated;
revoke all on function public.ts_last_session(uuid) from public, anon, authenticated;
