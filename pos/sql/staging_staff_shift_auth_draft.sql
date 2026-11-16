-- STAGING ONLY. Do not apply to production. Requires pgcrypto and separately
-- approved staff enrollment; no staff credentials are seeded by this migration.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pos_staff_credentials (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id),
 first_name text not null check (length(first_name) between 1 and 80),
 staff_role text not null check (staff_role in ('owner','cashier')),
 badge_digest bytea not null unique,
 pin_hash text not null,
 enabled boolean not null default true,
 credential_version bigint not null default 1,
 created_at timestamptz not null default now()
);
create unique index if not exists pos_staff_credentials_user_unique
 on public.pos_staff_credentials(auth_user_id);
alter table public.pos_staff_credentials enable row level security;
revoke all on public.pos_staff_credentials from anon, authenticated;

create table if not exists public.pos_staff_shifts (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.pos_staff_credentials(id),
 auth_user_id uuid not null references auth.users(id),
 secret_digest bytea not null unique,
 credential_version bigint not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists pos_staff_shifts_staff_active on public.pos_staff_shifts(staff_id,expires_at);
alter table public.pos_staff_shifts enable row level security;
revoke all on public.pos_staff_shifts from anon, authenticated;

create table if not exists public.pos_staff_auth_attempts (
 auth_user_id uuid primary key,
 attempts integer not null default 0,
 window_started timestamptz not null default now(),
 blocked_until timestamptz
);
alter table public.pos_staff_auth_attempts enable row level security;
revoke all on public.pos_staff_auth_attempts from anon, authenticated;

-- The badge is an identifier; the PIN and the existing Supabase account
-- authenticate the employee. This RPC never accepts client-supplied roles.
create or replace function public.pos_staff_start_shift(p_badge text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_uid uuid := auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_staff public.pos_staff_credentials%rowtype;
 v_secret text;
 v_expiry timestamptz := now() + interval '8 hours';
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='28000'; end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until > now() then
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 if v_attempt.window_started < now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts set attempts=0,window_started=now(),blocked_until=null
  where auth_user_id=v_uid;
  v_attempt.attempts:=0;
 end if;
 -- Reject invalid sizes before digest/crypt to bound credential processing cost.
 if p_badge is null or length(p_badge) not between 16 and 256
    or p_pin is null or length(p_pin) not between 4 and 128 then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 select * into v_staff from public.pos_staff_credentials
 where auth_user_id=v_uid and badge_digest=extensions.digest(p_badge,'sha256')
 and enabled=true;
 if not found or p_badge is null or length(p_badge) not between 16 and 256
    or p_pin is null or length(p_pin) not between 4 and 128 or
    v_staff.pin_hash is null or
    extensions.crypt(p_pin,v_staff.pin_hash) is distinct from v_staff.pin_hash then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 update public.pos_staff_auth_attempts set attempts=0,blocked_until=null
 where auth_user_id=v_uid;
 -- A new successful PIN authentication rotates prior shifts for this employee.
 -- This prevents an older stolen shift token from remaining valid after re-login.
 update public.pos_staff_shifts
 set revoked_at=now()
 where staff_id=v_staff.id and revoked_at is null;
 v_secret:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.pos_staff_shifts(staff_id,auth_user_id,secret_digest,credential_version,expires_at)
 values(v_staff.id,v_uid,extensions.digest(v_secret,'sha256'),v_staff.credential_version,v_expiry);
 return jsonb_build_object('ok',true,'shift_id',(select id from public.pos_staff_shifts
  where secret_digest=extensions.digest(v_secret,'sha256')),
  'shift_secret',v_secret,'first_name',v_staff.first_name,
  'role',v_staff.staff_role,'expires_at',v_expiry);
end;
$$;
revoke all on function public.pos_staff_start_shift(text,text) from public,anon;
grant execute on function public.pos_staff_start_shift(text,text) to authenticated;

-- A resumed checkout requires the original authenticated account, the same
-- active shift secret, and the enrolled badge. It does NOT mint a new shift.
create or replace function public.pos_staff_resume_shift(
 p_shift_id uuid,p_shift_secret text,p_badge text)
returns jsonb
language plpgsql security definer set search_path = ''
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
 -- Reject invalid sizes before hashing untrusted badge or shift secrets.
 if p_shift_secret is null or length(p_shift_secret) <> 64
    or p_badge is null or length(p_badge) not between 16 and 256 then
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
 and s.revoked_at is null and s.expires_at>now()
 and c.enabled=true and c.credential_version=s.credential_version
 and s.secret_digest=extensions.digest(coalesce(p_shift_secret,''),'sha256')
 and c.badge_digest=extensions.digest(coalesce(p_badge,''),'sha256')
 -- Serialize successful resume against concurrent shift revocation and
 -- credential disable/rotation. No guest checkout authorization is implied.
 for update of s,c;
 if not found or p_shift_secret is null or length(p_shift_secret) <> 64
    or p_badge is null or length(p_badge) not between 16 and 256 then
  -- Do not RAISE here: an exception would roll back the throttle update.
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('ok',false,'error','Invalid employee credentials');
 end if;
 -- A successful badge-only resume must not erase failed PIN attempts.
 -- Otherwise an existing shift could reset the PIN brute-force counter.
 return jsonb_build_object('ok',true,'staff_id',v_staff.id,
  'first_name',v_staff.first_name,'role',v_staff.staff_role);
end;
$$;
revoke all on function public.pos_staff_resume_shift(uuid,text,text) from public,anon;
grant execute on function public.pos_staff_resume_shift(uuid,text,text) to authenticated;

-- No checkout authorization is granted by these RPCs alone. Server-side
-- checkout/RLS integration MUST validate shift and checkout ownership.
-- Rollback (staging only, after checking dependencies):
-- drop function if exists public.pos_staff_resume_shift(uuid,text,text);
-- drop function if exists public.pos_staff_start_shift(text,text);
-- drop table if exists public.pos_staff_auth_attempts;
-- drop table if exists public.pos_staff_shifts;
-- drop table if exists public.pos_staff_credentials;
