-- STAGING ONLY. After #233. Bind resumed shift to the credential's auth identity.
-- A shift's auth_user_id must never authorize a different credential account.
-- Preserve existing throttle, register grants, owner exception and locking.
-- Rollback: a NEW reviewed migration restoring the previous function body;
-- do not re-enable legacy ambiguous grant RPCs or resurrect revoked shifts.
create or replace function public.pos_staff_resume_shift(
 p_shift_id uuid, p_shift_secret text, p_badge text, p_register uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid := auth.uid();
 v_staff public.pos_staff_credentials%rowtype;
 v_attempt public.pos_staff_auth_attempts%rowtype;
begin
 if v_uid is null then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until > now() then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 if v_attempt.window_started < now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts
  set attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
 end if;
 if p_register is null or p_shift_id is null or p_shift_secret is null
    or length(p_shift_secret) <> 64 or p_badge is null
    or length(p_badge) not between 8 and 256 then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 select c.* into v_staff
 from public.pos_staff_shifts s
 join public.pos_staff_credentials c on c.id=s.staff_id
 where s.id=p_shift_id and s.auth_user_id=v_uid
   -- Critical identity binding: reject a shift that names another auth account's credential.
   and c.auth_user_id=v_uid
   and s.revoked_at is null and s.expires_at>now()
   and c.enabled=true and c.credential_version=s.credential_version
   and s.secret_digest=extensions.digest(p_shift_secret,'sha256')
   and c.badge_digest=extensions.digest(p_badge,'sha256')
   and exists (
     select 1 from public.pos_registers r
     where r.id=p_register and r.active=true
       and (
         (c.staff_role='owner' and r.owner_id=v_uid and public.is_persen_admin())
         or exists (
           select 1 from public.pos_staff_register_grants g
           where g.register_id=r.id and g.staff_id=c.id
             and g.active=true and g.owner_id=r.owner_id
         )
       )
   )
 for update of s,c;
 if not found then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 -- Do not clear failed PIN attempts on a successful badge-only resume.
 return jsonb_build_object('ok',true,'staff_id',v_staff.id,
  'first_name',v_staff.first_name,'role',v_staff.staff_role);
end;
$$;
revoke all on function public.pos_staff_resume_shift(uuid,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.pos_staff_resume_shift(uuid,text,text,uuid)
 to authenticated;
