-- Training Suite — database: the session report's executive summary.
-- Background and rationale for each session; an edited summary kept with the session; the facilitator's
-- title and signature on their profile, to sign reports.
-- Run after schema-14-focus.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.sessions
  add column if not exists background text not null default '',
  add column if not exists rationale  text not null default '',
  add column if not exists report     jsonb;                 -- { summary: "paragraphs…", edited_at }
alter table public.sessions drop constraint if exists sessions_background_len;
alter table public.sessions add constraint sessions_background_len check (char_length(background) <= 4000 and char_length(rationale) <= 4000);

alter table public.profiles
  add column if not exists job_title text not null default '',
  add column if not exists signature text not null default '';   -- a picture of the signature (public link)

create or replace function public.update_my_signature(p_job_title text, p_signature text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare rec public.profiles;
begin
  update public.profiles set job_title = left(trim(coalesce(p_job_title, '')), 160), signature = left(coalesce(p_signature, ''), 600)
   where id = auth.uid() returning * into rec;
  return rec;
end $$;
grant execute on function public.update_my_signature(text, text) to authenticated;

-- The programme report's executive summary: background, rationale and objectives for the programme,
-- and an edited summary kept with it.
alter table public.programmes
  add column if not exists background text not null default '',
  add column if not exists rationale  text not null default '',
  add column if not exists objectives text not null default '',
  add column if not exists report     jsonb;
alter table public.programmes drop constraint if exists programmes_texts_len;
alter table public.programmes add constraint programmes_texts_len check (char_length(background) <= 4000 and char_length(rationale) <= 4000 and char_length(objectives) <= 4000);

-- Running a programme again also copies each session's background and rationale.
create or replace function public.copy_programme(p_programme uuid, p_name text, p_code text, p_dates text, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.programmes; np public.programmes; s public.sessions; ns uuid; shift int; first date;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Give the new programme a name'; end if;
  select * into p from public.programmes where id = p_programme;
  insert into public.programmes (owner_id, name, code, dates, venue, certificates, cert_rule, cert_design, cert_rules, roster_only, access_days, background, rationale, objectives)
  values (auth.uid(), left(trim(p_name), 200), left(coalesce(p_code, ''), 60), left(coalesce(p_dates, ''), 120), p.venue,
          p.certificates, p.cert_rule, p.cert_design, p.cert_rules, p.roster_only, p.access_days, p.background, p.rationale, p.objectives)
  returning * into np;
  select min(session_date) into first from public.sessions where programme_id = p.id;
  shift := case when p_start is not null and first is not null then p_start - first else null end;
  for s in select * from public.sessions where programme_id = p.id order by session_date nulls last, created_at loop
    insert into public.sessions (programme_id, owner_id, topic, session_date, start_time, venue, course_lead, objectives, main_topic, key_skill,
                                 pre_test, post_test, tools, flow, evaluation, files, slide_count, status, progress, groups, background, rationale)
    values (np.id, auth.uid(), s.topic, case when shift is null then null else s.session_date + shift end, s.start_time, s.venue, s.course_lead,
            s.objectives, s.main_topic, s.key_skill, s.pre_test, s.post_test, s.tools, s.flow, s.evaluation, s.files, s.slide_count,
            case when s.status = 'draft' then 'draft' else 'ready' end, 0, s.groups, s.background, s.rationale)
    returning id into ns;
    insert into public.activities (session_id, owner_id, slot, kind, title, data)
    select ns, auth.uid(), a.slot, a.kind, a.title, a.data from public.activities a where a.session_id = s.id;
  end loop;
  return np.id;
end $$;
