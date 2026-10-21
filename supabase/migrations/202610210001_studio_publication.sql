-- Studio controls publication. Keep existing records, locks and revision checks.
create or replace function public.vault_update_content(p_record jsonb, p_revision integer, p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; previous_status text; previous_data jsonb; permitted jsonb;
begin
  select status,data into previous_status,previous_data from public.vault_content where id=(p_record->>'id')::uuid for update;
  if exists(select 1 from public.vault_runs where content_id=(p_record->>'id')::uuid and data->>'status'='running' and (p_run is null or id<>p_run)) then raise exception 'content conflict: worker running'; end if;
  permitted := '{"reserved":["draft","failed"],"draft":["verified","failed"],"verified":["draft","rendered","failed"],"rendered":["draft","verified","uploading","failed"],"uploading":["uploaded_private","reconciliation_required"],"uploaded_private":["published"],"approved":["published","uploaded_private"],"publishing":["published","uploaded_private","reconciliation_required"],"published":[],"failed":["draft","verified","rendered"],"reconciliation_required":["uploaded_private","published"]}'::jsonb;
  if previous_status='reconciliation_required' and p_record->>'status'='rendered' then
    if previous_data->>'youtubeId' is not null or (previous_data->>'currentStep') is distinct from 'upload' or coalesce((previous_data->>'uploadedAt')::timestamptz,now()) > now()-interval '1 hour' or p_record->>'noUploadConfirmedAt' is null then raise exception 'invalid status transition: upload absence not confirmed'; end if;
  elsif previous_status <> p_record->>'status' and not coalesce((permitted->previous_status) ? (p_record->>'status'),false) then raise exception 'invalid status transition'; end if;
  if previous_status <> 'published' and p_record->>'status'='published' and (p_record->>'youtubeId' is null or coalesce(p_record->>'youtubeVisibility','') <> 'public' or p_record->>'youtubeSyncedAt' is null) then raise exception 'public YouTube state must be observed first'; end if;
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

revoke all on function public.vault_update_content(jsonb,integer,uuid) from public;
grant execute on function public.vault_update_content(jsonb,integer,uuid) to service_role;
