-- Training Suite — database, phase 1: accounts, approvals, programmes, sessions.
-- Paste the whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
-- At the very end, the line marked <<< SUPER ADMIN makes your own account the Super Admin
-- (sign up on the site first, then run that line).

-- 0. Helpers ------------------------------------------------------------------
create extension if not exists pgcrypto;

-- 1. Profiles: one per account, created automatically at sign-up ---------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null default '',
  full_name    text not null default '' check (char_length(full_name) <= 160),
  phone        text not null default '' check (char_length(phone) <= 40),
  role         text not null default 'course_lead' check (role in ('programme_lead','course_lead')),
  where_train  text not null default '' check (char_length(where_train) <= 160),
  status       text not null default 'pending' check (status in ('pending','active','rejected','suspended')),
  plan         text not null default '' check (char_length(plan) <= 60),
  expires_at   timestamptz,
  is_admin     boolean not null default false,
  note         text not null default '' check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
alter table public.profiles enable row level security;

-- New sign-ups start as pending. Details come from the sign-up form (user metadata).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, phone, role, where_train)
  values (new.id, lower(coalesce(new.email,'')), left(coalesce(m->>'full_name',''),160), left(coalesce(m->>'phone',''),40),
          case when m->>'role' = 'programme_lead' then 'programme_lead' else 'course_lead' end,
          left(coalesce(m->>'where_train',''),160))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;

-- An account may work only while approved and within its plan dates. Admin accounts are not customer accounts.
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and not is_admin
                 and (expires_at is null or expires_at > now()));
$$;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
-- No insert/update/delete policies: changes go through the functions below.

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_where_train text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare rec public.profiles;
begin
  update public.profiles set full_name = left(trim(coalesce(p_full_name,'')),160), phone = left(trim(coalesce(p_phone,'')),40),
         where_train = left(trim(coalesce(p_where_train,'')),160)
   where id = auth.uid() returning * into rec;
  return rec;
end $$;

-- Super Admin decisions.
create or replace function public.admin_decide(p_user uuid, p_status text, p_plan text, p_expires timestamptz, p_note text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare rec public.profiles;
begin
  if not public.is_admin() then raise exception 'Only the Super Admin can do this'; end if;
  if p_status not in ('pending','active','rejected','suspended') then raise exception 'Unknown status'; end if;
  update public.profiles
     set status = p_status, plan = left(coalesce(p_plan, plan),60), expires_at = p_expires,
         note = left(coalesce(p_note, note),500), decided_at = now()
   where id = p_user and not is_admin
  returning * into rec;
  if rec.id is null then raise exception 'Account not found'; end if;
  return rec;
end $$;

-- 2. Programmes ----------------------------------------------------------------
create table if not exists public.programmes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name          text not null check (char_length(name) between 3 and 200),
  code          text not null default '' check (char_length(code) <= 60),
  dates         text not null default '' check (char_length(dates) <= 120),
  venue         text not null default '' check (char_length(venue) <= 160),
  certificates  boolean not null default false,
  cert_rule     text not null default 'completion' check (cert_rule in ('attendance','completion','achievement')),
  created_at    timestamptz not null default now()
);
create index if not exists programmes_owner_idx on public.programmes (owner_id, created_at desc);
alter table public.programmes enable row level security;
drop policy if exists "own programmes" on public.programmes;
create policy "own programmes" on public.programmes for all to authenticated
  using (owner_id = auth.uid() and public.is_active())
  with check (owner_id = auth.uid() and public.is_active());

-- 3. Sessions ------------------------------------------------------------------
create or replace function public.new_attendance_code()
returns text language plpgsql volatile set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.sessions where attendance_code = c);
  end loop;
  return c;
end $$;

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  programme_id     uuid not null references public.programmes(id) on delete cascade,
  owner_id         uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  topic            text not null check (char_length(topic) between 2 and 200),
  session_date     date,
  start_time       text not null default '' check (char_length(start_time) <= 10),
  venue            text not null default '' check (char_length(venue) <= 160),
  course_lead      text not null default '' check (char_length(course_lead) <= 160),
  objectives       text not null default '' check (char_length(objectives) <= 3000),
  main_topic       text not null default '' check (char_length(main_topic) <= 200),
  key_skill        text not null default '' check (char_length(key_skill) <= 200),
  pre_test         boolean not null default false,
  post_test        boolean not null default false,
  tools            text[] not null default '{}',
  flow             jsonb not null default '[]',
  evaluation       jsonb not null default '{"mode":"default","anonymous":true,"at_tapout":true}',
  files            jsonb not null default '[]',
  slide_count      int not null default 0,
  status           text not null default 'ready' check (status in ('draft','ready','live','completed')),
  progress         int not null default 0,
  attendance_code  text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists sessions_owner_idx on public.sessions (owner_id, session_date);
create index if not exists sessions_programme_idx on public.sessions (programme_id, session_date);
alter table public.sessions enable row level security;
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all to authenticated
  using (owner_id = auth.uid() and public.is_active())
  with check (owner_id = auth.uid() and public.is_active()
              and exists (select 1 from public.programmes p where p.id = programme_id and p.owner_id = auth.uid()));

create or replace function public.sessions_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.attendance_code is null or new.attendance_code = '' then new.attendance_code := public.new_attendance_code(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sessions_before_write on public.sessions;
create trigger sessions_before_write before insert or update on public.sessions for each row execute function public.sessions_before_write();

-- 4. Files: slides and things to share (private; each account only sees its own folder) ----
insert into storage.buckets (id, name, public, file_size_limit)
values ('session-files', 'session-files', false, 52428800)   -- 50 MB per file
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "ts own files read" on storage.objects;
drop policy if exists "ts own files add" on storage.objects;
drop policy if exists "ts own files remove" on storage.objects;
create policy "ts own files read" on storage.objects for select to authenticated
  using (bucket_id = 'session-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ts own files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'session-files' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
create policy "ts own files remove" on storage.objects for delete to authenticated
  using (bucket_id = 'session-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Permissions -----------------------------------------------------------------
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active() to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.admin_decide(uuid, text, text, timestamptz, text) to authenticated;

-- 6. SUPER ADMIN -------------------------------------------------------------------
-- After you have signed up on the site with your admin email, run just this line (edit the email if needed):
-- update public.profiles set is_admin = true, status = 'active' where email = 'babajidearulogun@gmail.com';   -- <<< SUPER ADMIN
