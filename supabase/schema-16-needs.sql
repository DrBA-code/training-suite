-- Training Suite — database: needs assessment (TNA / LNA).
-- A survey of skill areas sent to a list of people through personal links. Each person rates how important
-- each area is to their job and their current ability. The gaps give training priorities and recommendations,
-- and recommended people can be nominated to a programme.
-- Run after schema-15-report.sql. SQL Editor → New query → paste all → Run. Safe to run again.

create table if not exists public.tna_surveys (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title       text not null check (char_length(title) between 3 and 200),
  org         text not null default '' check (char_length(org) <= 200),       -- who is running it, for the messages
  intro       text not null default '' check (char_length(intro) <= 3000),     -- shown at the top of the survey
  message     text not null default '' check (char_length(message) <= 2000),   -- the WhatsApp message, with {name} and {link}
  background  text not null default '' check (char_length(background) <= 4000),
  areas       jsonb not null default '[]',      -- [{ id, name, cat, desc }]
  fields      jsonb not null default '{}',      -- which profile questions to ask: { department, grade, role, years }
  questions   jsonb not null default '[]',      -- open questions [{ id, text }]
  threshold   numeric not null default 1.5,     -- importance minus ability at or above this → recommended
  status      text not null default 'draft' check (status in ('draft','open','closed')),
  report      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tna_surveys_owner_idx on public.tna_surveys (owner_id, created_at desc);
alter table public.tna_surveys enable row level security;
drop policy if exists "own tna surveys" on public.tna_surveys;
create policy "own tna surveys" on public.tna_surveys for all to authenticated
  using (owner_id = auth.uid() and public.is_active()) with check (owner_id = auth.uid() and public.is_active());

create table if not exists public.tna_people (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references public.tna_surveys(id) on delete cascade,
  title         text not null default '' check (char_length(title) <= 20),
  name          text not null check (char_length(name) between 2 and 160),
  email         text not null default '' check (char_length(email) <= 160),
  phone         text not null default '' check (char_length(phone) <= 40),
  organisation  text not null default '' check (char_length(organisation) <= 200),
  department    text not null default '' check (char_length(department) <= 200),
  grade         text not null default '' check (char_length(grade) <= 60),
  token         uuid not null default gen_random_uuid() unique,
  sent_at       timestamptz,
  opened_at     timestamptz,
  submitted_at  timestamptz,
  answers       jsonb,                          -- { profile: {...}, ratings: { areaId: { imp, abl } }, open: { qId: text } }
  nominated     jsonb not null default '[]',    -- [{ programme, name, area, at }]
  created_at    timestamptz not null default now()
);
create index if not exists tna_people_survey_idx on public.tna_people (survey_id);
alter table public.tna_people enable row level security;
drop policy if exists "own tna people" on public.tna_people;
create policy "own tna people" on public.tna_people for all to authenticated
  using (exists (select 1 from public.tna_surveys s where s.id = survey_id and s.owner_id = auth.uid()) and public.is_active())
  with check (exists (select 1 from public.tna_surveys s where s.id = survey_id and s.owner_id = auth.uid()) and public.is_active());

-- Respondent: open a personal link (no sign-in).
create or replace function public.tna_open(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.tna_people; s public.tna_surveys;
begin
  select * into p from public.tna_people where token = p_token;
  if p.id is null then return null; end if;
  select * into s from public.tna_surveys where id = p.survey_id;
  if s.status = 'draft' then return jsonb_build_object('status', 'draft', 'title', s.title); end if;
  update public.tna_people set opened_at = coalesce(opened_at, now()) where id = p.id;
  return jsonb_build_object('status', s.status, 'title', s.title, 'org', s.org, 'intro', s.intro, 'areas', s.areas, 'fields', s.fields, 'questions', s.questions,
           'person', jsonb_build_object('title', p.title, 'name', p.name, 'organisation', p.organisation, 'department', p.department, 'grade', p.grade),
           'answers', p.answers, 'submitted_at', p.submitted_at);
end $$;

create or replace function public.tna_submit(p_token uuid, p_answers jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare p public.tna_people; s public.tna_surveys; t timestamptz := now();
begin
  if octet_length(coalesce(p_answers, '{}'::jsonb)::text) > 30000 then raise exception 'Answers are too long'; end if;
  select * into p from public.tna_people where token = p_token;
  if p.id is null then raise exception 'This link is not valid'; end if;
  select * into s from public.tna_surveys where id = p.survey_id;
  if s.status <> 'open' then raise exception 'This survey is closed. Thank you.'; end if;
  update public.tna_people set answers = p_answers, submitted_at = t,
         organisation = coalesce(nullif(left(p_answers->'profile'->>'organisation', 200), ''), organisation),
         department   = coalesce(nullif(left(p_answers->'profile'->>'department', 200), ''), department),
         grade        = coalesce(nullif(left(p_answers->'profile'->>'grade', 60), ''), grade)
   where id = p.id;
  return t;
end $$;

-- Nominate people to a programme: they join its participant list, so they can check in with that email.
create or replace function public.tna_nominate(p_programme uuid, p_people uuid[], p_area text)
returns int language plpgsql security definer set search_path = public as $$
declare pr public.programmes; x public.tna_people; n int := 0;
begin
  if not public.ts_owns_programme(p_programme) then raise exception 'Not your programme'; end if;
  select * into pr from public.programmes where id = p_programme;
  for x in select tp.* from public.tna_people tp join public.tna_surveys s on s.id = tp.survey_id
            where tp.id = any(p_people) and s.owner_id = auth.uid() loop
    if coalesce(x.email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then continue; end if;
    insert into public.participants (programme_id, title, full_name, email, organisation, preloaded)
    values (pr.id, left(x.title, 20), left(x.name, 160), lower(trim(x.email)), left(x.organisation, 200), true)
    on conflict (programme_id, email) do update set preloaded = true;
    update public.tna_people set nominated = nominated || jsonb_build_array(jsonb_build_object('programme', pr.id, 'name', pr.name, 'area', coalesce(p_area, ''), 'at', now()))
     where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.tna_open(uuid) to anon, authenticated;
grant execute on function public.tna_submit(uuid, jsonb) to anon, authenticated;
grant execute on function public.tna_nominate(uuid, uuid[], text) to authenticated;
