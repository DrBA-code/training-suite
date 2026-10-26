-- Training Suite — database, step 7 of the roadmap: running a programme again, and the Library.
-- Run after schema-12-groups.sql. SQL Editor → New query → paste all → Run. Safe to run again.

-- 1. Run a programme again ---------------------------------------------------------------------------
-- A new programme with the same sessions, slides, files, questions, flow, evaluation, groups plan and
-- certificate design and rules. No people, attendance, answers or certificates are copied, and the earlier
-- programme is left exactly as it was. With p_start, session dates move by the same number of days.
create or replace function public.copy_programme(p_programme uuid, p_name text, p_code text, p_dates text, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.programmes; np public.programmes; s public.sessions; ns uuid; shift int; first date;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  if char_length(trim(coalesce(p_name,''))) < 3 then raise exception 'Give the new programme a name'; end if;
  select * into p from public.programmes where id = p_programme;
  insert into public.programmes (owner_id, name, code, dates, venue, certificates, cert_rule, cert_design, cert_rules, roster_only, access_days)
  values (auth.uid(), left(trim(p_name), 200), left(coalesce(p_code, ''), 60), left(coalesce(p_dates, ''), 120), p.venue,
          p.certificates, p.cert_rule, p.cert_design, p.cert_rules, p.roster_only, p.access_days)
  returning * into np;
  select min(session_date) into first from public.sessions where programme_id = p.id;
  shift := case when p_start is not null and first is not null then p_start - first else null end;
  for s in select * from public.sessions where programme_id = p.id order by session_date nulls last, created_at loop
    insert into public.sessions (programme_id, owner_id, topic, session_date, start_time, venue, course_lead, objectives, main_topic, key_skill,
                                 pre_test, post_test, tools, flow, evaluation, files, slide_count, status, progress, groups)
    values (np.id, auth.uid(), s.topic, case when shift is null then null else s.session_date + shift end, s.start_time, s.venue, s.course_lead,
            s.objectives, s.main_topic, s.key_skill, s.pre_test, s.post_test, s.tools, s.flow, s.evaluation, s.files, s.slide_count,
            case when s.status = 'draft' then 'draft' else 'ready' end, 0, s.groups)
    returning id into ns;
    insert into public.activities (session_id, owner_id, slot, kind, title, data)
    select ns, auth.uid(), a.slot, a.kind, a.title, a.data from public.activities a where a.session_id = s.id;
  end loop;
  return np.id;
end $$;
grant execute on function public.copy_programme(uuid, text, text, text, date) to authenticated;

-- How many sessions use a stored file (so deleting one copy never removes a file another session still uses).
create or replace function public.file_in_use(p_path text, p_except uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s, jsonb_array_elements(s.files) f
                  where s.owner_id = auth.uid() and s.id <> p_except and f->>'path' = p_path);
$$;
grant execute on function public.file_in_use(text, uuid) to authenticated;

-- 2. Library -------------------------------------------------------------------------------------------
-- Question sets, case studies and evaluation forms kept for reuse in any session.
create table if not exists public.library_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind        text not null check (char_length(kind) <= 20),     -- an activity kind (quiz, case, …) or 'evaluation'
  title       text not null check (char_length(title) between 1 and 200),
  data        jsonb not null default '{}',
  tags        text[] not null default '{}',
  uses        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists library_owner_idx on public.library_items (owner_id, kind, updated_at desc);
alter table public.library_items enable row level security;
drop policy if exists "own library" on public.library_items;
create policy "own library" on public.library_items for all to authenticated
  using (owner_id = auth.uid() and public.is_active())
  with check (owner_id = auth.uid() and public.is_active());
