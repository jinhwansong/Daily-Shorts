-- Apply once in Supabase SQL Editor. Existing published_topics is preserved.
create table if not exists public.vault_cases (
  id uuid primary key,
  canonical_key text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_content (
  id uuid primary key,
  case_id uuid not null references public.vault_cases(id),
  format text not null check(format in ('shorts','longform')),
  angle_key text not null,
  edition_key text not null default 'original',
  core_claim_keys text[] not null check(cardinality(core_claim_keys) > 0),
  status text not null,
  revision integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(case_id, format, angle_key, edition_key)
);

create table if not exists public.vault_budget (
  operation_key text primary key,
  content_id uuid not null references public.vault_content(id),
  month text not null check(month ~ '^\d{4}-\d{2}$'),
  category text not null check(category in ('research','tts','image','video','other')),
  reserved_micros bigint not null check(reserved_micros >= 0),
  spent_micros bigint not null default 0 check(spent_micros >= 0),
  state text not null default 'reserved' check(state in ('reserved','settled','released')),
  provider_task_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_runs (
  id uuid primary key,
  content_id uuid not null references public.vault_content(id),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_analytics (
  video_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists vault_one_active_run on public.vault_runs(content_id) where data->>'status' = 'running';
create table if not exists public.vault_legacy (
  id uuid primary key,
  external_key text not null unique,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.vault_legacy enable row level security;
revoke all on public.vault_legacy from anon, authenticated;
grant all on public.vault_legacy to service_role;
create table if not exists public.vault_results(operation_key text primary key references public.vault_budget(operation_key), data jsonb not null);
create table if not exists public.vault_settings(key text primary key, data jsonb not null);
alter table public.vault_results enable row level security;
alter table public.vault_settings enable row level security;
revoke all on public.vault_results,public.vault_settings from anon,authenticated;
grant all on public.vault_results,public.vault_settings to service_role;

create or replace function public.vault_save_case(p_record jsonb, p_previous jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_previous is null then
    insert into public.vault_cases(id,canonical_key,data) values((p_record->>'id')::uuid,p_record->>'canonicalKey',p_record);
  else
    update public.vault_cases set data=p_record where id=(p_record->>'id')::uuid and data=p_previous;
    if not found then raise exception 'case changed concurrently'; end if;
  end if;
  return p_record;
end $$;
revoke all on function public.vault_save_case(jsonb,jsonb) from public;
grant execute on function public.vault_save_case(jsonb,jsonb) to service_role;

alter table public.vault_cases enable row level security;
alter table public.vault_content enable row level security;
alter table public.vault_budget enable row level security;
alter table public.vault_runs enable row level security;
alter table public.vault_analytics enable row level security;
revoke all on public.vault_cases, public.vault_content, public.vault_budget, public.vault_runs, public.vault_analytics from anon, authenticated;
grant all on public.vault_cases, public.vault_content, public.vault_budget, public.vault_runs, public.vault_analytics to service_role;

create or replace function public.vault_reserve_content(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.vault_content; prior public.vault_content; keys text[];
begin
  perform pg_advisory_xact_lock(hashtext('case:' || (p_record->>'caseId')));
  select * into existing from public.vault_content where id = (p_record->>'id')::uuid;
  if found then return existing.data; end if;
  select array_agg(value order by value) into keys from jsonb_array_elements_text(p_record->'coreClaimIds');
  if cardinality(keys) is null or cardinality(keys) = 0 then raise exception 'core claims required'; end if;
  for prior in select * from public.vault_content where case_id = (p_record->>'caseId')::uuid and edition_key = (p_record->>'editionId') loop
    if prior.format='longform' and p_record->>'format'='longform' and p_record->>'editionId'='original' then raise exception 'duplicate original longform'; end if;
    if (prior.format = p_record->>'format' and prior.angle_key = lower(trim(p_record->>'angleId')))
      or (keys <@ prior.core_claim_keys and not (
        prior.format = 'longform' and p_record->>'format' = 'shorts'
        and coalesce(p_record->>'derivedFromId' = prior.id::text,false) and cardinality(keys) < cardinality(prior.core_claim_keys)
      )) then raise exception 'duplicate content'; end if;
  end loop;
  insert into public.vault_content(id,case_id,format,angle_key,edition_key,core_claim_keys,status,revision,data)
  values((p_record->>'id')::uuid,(p_record->>'caseId')::uuid,p_record->>'format',lower(trim(p_record->>'angleId')),p_record->>'editionId',keys,'reserved',1,p_record || jsonb_build_object('revision',1));
  return p_record || jsonb_build_object('revision',1);
end $$;

create or replace function public.vault_update_content(p_record jsonb, p_revision integer, p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; previous_status text; previous_data jsonb; permitted jsonb;
begin
  select status,data into previous_status,previous_data from public.vault_content where id=(p_record->>'id')::uuid for update;
  if exists(select 1 from public.vault_runs where content_id=(p_record->>'id')::uuid and data->>'status'='running' and (p_run is null or id<>p_run)) then raise exception 'content conflict: worker running'; end if;
  permitted := '{"reserved":["draft","failed"],"draft":["verified","failed"],"verified":["draft","rendered","failed"],"rendered":["draft","verified","uploading","failed"],"uploading":["uploaded_private","reconciliation_required"],"uploaded_private":["approved"],"approved":["publishing","uploaded_private"],"publishing":["published","reconciliation_required"],"published":[],"failed":["draft","verified","rendered"],"reconciliation_required":["uploaded_private","published"]}'::jsonb;
  if previous_status='reconciliation_required' and p_record->>'status'='rendered' then
    if previous_data->>'youtubeId' is not null or (previous_data->>'currentStep') is distinct from 'upload' or coalesce((previous_data->>'uploadedAt')::timestamptz,now()) > now()-interval '1 hour' or p_record->>'noUploadConfirmedAt' is null then raise exception 'invalid status transition: upload absence not confirmed'; end if;
  elsif previous_status <> p_record->>'status' and not coalesce((permitted->previous_status) ? (p_record->>'status'),false) then raise exception 'invalid status transition'; end if;
  update public.vault_content set data = p_record || jsonb_build_object('revision',p_revision+1),
    status = p_record->>'status', revision = p_revision+1, updated_at = now()
  where id = (p_record->>'id')::uuid and revision = p_revision
    and case_id = (p_record->>'caseId')::uuid and format = p_record->>'format'
    and angle_key = lower(trim(p_record->>'angleId')) and edition_key = p_record->>'editionId'
    and core_claim_keys = array(select value from jsonb_array_elements_text(p_record->'coreClaimIds') order by value)
  returning data into result;
  if result is null then raise exception 'content changed concurrently or immutable identity changed'; end if;
  return result;
end $$;

create or replace function public.vault_start_run(p_record jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.vault_content where id=(p_record->>'contentId')::uuid for update;
  insert into public.vault_runs(id,content_id,data) values((p_record->>'id')::uuid,(p_record->>'contentId')::uuid,p_record);
end $$;
revoke all on function public.vault_start_run(jsonb) from public;
grant execute on function public.vault_start_run(jsonb) to service_role;

create or replace function public.vault_reserve_budget(p_key text, p_content uuid, p_month text, p_category text, p_micros bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare total bigint; category_total bigint; category_limit bigint; existing public.vault_budget; base_key text := p_key; attempt_count integer;
begin
  if p_micros < 0 then raise exception 'invalid budget amount'; end if;
  perform pg_advisory_xact_lock(hashtext('vault-budget'));
  select * into existing from public.vault_budget where operation_key = p_key;
  if found then
    if existing.content_id <> p_content or existing.category <> p_category or existing.reserved_micros <> p_micros then raise exception 'budget operation conflict'; end if;
    if existing.state <> 'released' then return to_jsonb(existing) || jsonb_build_object('created',false); end if;
    select * into existing from public.vault_budget where left(operation_key,length(base_key)+9)=base_key||':attempt:' order by created_at desc,operation_key desc limit 1;
    if found and existing.state <> 'released' then return to_jsonb(existing) || jsonb_build_object('created',false); end if;
    select count(*) into attempt_count from public.vault_budget where left(operation_key,length(base_key)+9)=base_key||':attempt:';
    p_key := base_key || ':attempt:' || (attempt_count+1);
  end if;
  select coalesce(sum(case when state = 'reserved' then greatest(reserved_micros,spent_micros) else spent_micros end),0) into total from public.vault_budget where month=p_month or state='reserved';
  select coalesce(sum(case when state = 'reserved' then greatest(reserved_micros,spent_micros) else spent_micros end),0) into category_total from public.vault_budget where (month=p_month or state='reserved') and category=p_category;
  category_limit := case p_category when 'video' then 7000000 when 'research' then 5000000 when 'tts' then 2000000 when 'image' then 2000000 when 'other' then 4000000 else 0 end;
  if total+p_micros > 20000000 or category_total+p_micros > category_limit then raise exception 'monthly budget exceeded'; end if;
  insert into public.vault_budget(operation_key,content_id,month,category,reserved_micros) values(p_key,p_content,p_month,p_category,p_micros) returning * into existing;
  return to_jsonb(existing) || jsonb_build_object('created',true);
end $$;

create or replace function public.vault_settle_budget(p_key text,p_spent bigint,p_state text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_spent < 0 or p_state not in ('settled','released') or (p_state='released' and p_spent<>0) then raise exception 'invalid budget settlement'; end if;
  perform pg_advisory_xact_lock(hashtext('vault-budget'));
  update public.vault_budget set spent_micros=p_spent,state=p_state where operation_key=p_key and state='reserved';
  if not found then raise exception 'budget reservation missing or already settled'; end if;
end $$;

revoke all on function public.vault_reserve_content(jsonb), public.vault_update_content(jsonb,integer,uuid), public.vault_reserve_budget(text,uuid,text,text,bigint), public.vault_settle_budget(text,bigint,text) from public;
grant execute on function public.vault_reserve_content(jsonb), public.vault_update_content(jsonb,integer,uuid), public.vault_reserve_budget(text,uuid,text,text,bigint), public.vault_settle_budget(text,bigint,text) to service_role;
