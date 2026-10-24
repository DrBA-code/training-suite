-- Training Suite — database, step 4b of the roadmap: short answer, rating gauge and star feedback activities;
-- a certificate design on each programme. Run after schema-7-finger.sql. SQL Editor → New query → paste all → Run. Safe to run again.

alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('poll','words','finger','scale','feedback','quiz','short','buzz','battle','order','match','spot','case','exit','test'));

-- Certificate design for the programme: a built-in template, or the trainer's own uploaded design.
alter table public.programmes add column if not exists cert_design jsonb not null default '{"template":"classic"}';

-- Short answers are compared after tidying: lower case, no punctuation or extra spaces.
create or replace function public.ts_norm(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(t,'')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- What a phone may see of a question: never the answer before Reveal.
create or replace function public.ts_public_step(p_kind text, s jsonb, p_run text, p_reveal boolean)
returns jsonb language plpgsql immutable as $$
declare base jsonb := coalesce(s,'{}'::jsonb) - 'correct' - 'region' - 'items' - 'pairs' - 'accept';
begin
  if p_kind = 'order' then
    base := base || jsonb_build_object('items', public.ts_shuffle(s->'items', p_run));
    if p_reveal then base := base || jsonb_build_object('answer_items', s->'items'); end if;
  elsif p_kind = 'match' then
    base := base || jsonb_build_object(
      'lefts',  (select coalesce(jsonb_agg(p->'l'), '[]'::jsonb) from jsonb_array_elements(coalesce(s->'pairs','[]'::jsonb)) p),
      'rights', public.ts_shuffle((select coalesce(jsonb_agg(p->'r'), '[]'::jsonb) from jsonb_array_elements(coalesce(s->'pairs','[]'::jsonb)) p), p_run));
    if p_reveal then base := base || jsonb_build_object('answer_pairs', s->'pairs'); end if;
  elsif p_kind in ('quiz','buzz','battle','test') then
    if p_reveal then base := base || jsonb_build_object('correct', s->'correct'); end if;
  elsif p_kind = 'spot' then
    if p_reveal then base := base || jsonb_build_object('region', s->'region'); end if;
  elsif p_kind = 'short' then
    base := base || jsonb_build_object('marked', jsonb_array_length(coalesce(s->'accept','[]'::jsonb)) > 0);
    if p_reveal then base := base || jsonb_build_object('accept', s->'accept'); end if;
  end if;
  return base;
end $$;

create or replace function public.submit_answer(p_code text, p_token uuid, p_grp text, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me record; st public.live_state; a public.activities; s jsonb;
  sc numeric := null; pts int := 0; ms int; n int; hits int; rk int; rec public.responses; dx numeric; dy numeric; v numeric;
begin
  if octet_length(coalesce(p_answer,'{}'::jsonb)::text) > 4000 then raise exception 'Answer is too long'; end if;
  select * into me from public.ts_participant(p_code, p_token);
  if me.session_id is null then raise exception 'Check in first'; end if;
  select * into st from public.live_state where session_id = me.session_id;
  if st.session_id is null or st.phase <> 'open' then raise exception 'Answers are closed'; end if;
  if st.seconds > 0 and now() > st.opened_at + make_interval(secs => st.seconds + 2) then raise exception 'Time is up'; end if;
  select * into a from public.activities where id = st.activity_id;
  s := a.data->'steps'->st.step;
  ms := greatest(0, round(extract(epoch from now() - st.opened_at) * 1000))::int;

  if a.kind in ('quiz','buzz','battle','test') then
    sc := case when (p_answer->>'i') is not null and (p_answer->>'i')::int = (s->>'correct')::int then 1 else 0 end;
  elsif a.kind = 'short' then
    if jsonb_array_length(coalesce(s->'accept','[]'::jsonb)) > 0 then
      sc := case when exists (select 1 from jsonb_array_elements_text(s->'accept') x
                               where public.ts_norm(x) <> '' and public.ts_norm(x) = public.ts_norm(p_answer->>'text')) then 1 else 0 end;
    end if;
  elsif a.kind = 'scale' then
    v := (p_answer->>'v')::numeric;
    if v is null or v < coalesce((s->>'min')::numeric, 0) or v > coalesce((s->>'max')::numeric, 10) then raise exception 'Pick a value on the scale'; end if;
  elsif a.kind = 'feedback' then
    v := (p_answer->>'stars')::numeric;
    if v is null or v < 1 or v > 5 then raise exception 'Pick 1 to 5 stars'; end if;
  elsif a.kind = 'order' then
    n := jsonb_array_length(coalesce(s->'items','[]'::jsonb));
    select count(*) into hits from generate_series(0, greatest(n-1,0)) i where n > 0 and (p_answer->'items'->>i) = (s->'items'->>i);
    sc := case when n > 0 then hits::numeric / n else 0 end;
  elsif a.kind = 'match' then
    n := jsonb_array_length(coalesce(s->'pairs','[]'::jsonb));
    select count(*) into hits from generate_series(0, greatest(n-1,0)) i where n > 0 and (p_answer->'rights'->>i) = (s->'pairs'->i->>'r');
    sc := case when n > 0 then hits::numeric / n else 0 end;
  elsif a.kind = 'spot' and s ? 'region' then
    dx := ((p_answer->>'x')::numeric - (s->'region'->>'x')::numeric) * coalesce((s->>'aspect')::numeric, 1);
    dy := (p_answer->>'y')::numeric - (s->'region'->>'y')::numeric;
    sc := case when sqrt(dx*dx + dy*dy) <= (s->'region'->>'r')::numeric then 1 else 0 end;
  end if;

  if sc is not null then
    sc := round(sc, 4);
    if a.kind in ('quiz','buzz','battle','test','short') then
      pts := round(sc * (500 + 500 * greatest(0, 1 - ms / (greatest(case when st.seconds > 0 then st.seconds else 30 end, 5) * 1000.0))));
    else pts := round(sc * 1000); end if;
  end if;

  insert into public.responses (activity_id, session_id, run, step, participant_id, grp, answer, score, points, ms)
  values (a.id, me.session_id, st.run, st.step, me.participant_id, case when p_grp in ('A','B') then p_grp else 'all' end,
          coalesce(p_answer,'{}'::jsonb), sc, pts, ms)
  on conflict (activity_id, run, step, participant_id) do nothing
  returning * into rec;
  if rec.id is null then raise exception 'You already answered'; end if;
  if sc = 1 then
    select count(*) + 1 into rk from public.responses r
     where r.activity_id = a.id and r.run = st.run and r.step = st.step and r.score = 1 and r.created_at < rec.created_at;
  end if;
  return jsonb_build_object('score', sc, 'points', pts, 'ms', ms, 'rank', rk);
end $$;
grant execute on function public.submit_answer(text, uuid, text, jsonb) to anon, authenticated;
