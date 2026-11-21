-- STAGING ONLY: Epson TM-T20IV owner-confirmed receipt retry.
-- Project: naaqcspvbntzdtwuchrr. NEVER run against production.
-- The existing Windows agent intentionally ignores pos_print_jobs.created_at >24h old.
-- A prior retry did not refresh this dispatch timestamp, leaving receipts stuck.
-- This function touches ONLY the selected receipt job, NEVER a sale or drawer job.
-- A browser queue Refresh remains a read-only SELECT.
--
-- Operator must physically verify the receipt did NOT print before invoking.
-- Only explicitly failed, or never-claimed old queued jobs, are eligible.
-- Do not replay printing/submitted_to_browser (unknown physical outcome).
create or replace function public.pos_retry_print_job(p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_affected integer;
begin
  if (select auth.uid()) is null or not public.is_persen_admin() then
    raise exception 'Unauthorized';
  end if;
  update public.pos_print_jobs j
     set state = 'queued',
         -- This column doubles as dispatch time for the currently installed agent.
         -- The immutable sale.created_at still records when the sale happened.
         created_at = now(),
         claimed_at = null,
         submitted_at = null,
         last_error = null
   where j.id = p_job
     and j.owner_id = (select auth.uid())
     and j.attempts < 5
     and (
       j.state = 'failed'
       or (j.state = 'queued' and j.attempts = 0 and j.created_at < now() - interval '24 hours')
     )
     and exists (
       select 1 from public.pos_sales s
       where s.id = j.sale_id and s.owner_id = j.owner_id
     );
  get diagnostics v_affected = row_count;
  return v_affected = 1;
end;
$function$;

-- Explicitly restrict the SECURITY DEFINER function to signed-in users.
-- The function itself further checks that the caller is the POS owner/admin.
revoke all on function public.pos_retry_print_job(uuid) from public, anon;
grant execute on function public.pos_retry_print_job(uuid) to authenticated;
