-- PERSEN POS STAGING ONLY — pending staff badge reservations.
-- Badge slots do NOT confer any login ability and are not live staff accounts.
-- Activation later requires a separate authenticated employee account and
-- owner-granted register access; do not link these rows to owner JWT.
create table if not exists public.pos_pending_employee_badges (
 owner_id uuid not null references auth.users(id) on delete cascade,
 slot integer not null check (slot in (1,2)),
 first_name text not null check (length(first_name) between 1 and 80),
 employee_email text not null check (length(employee_email) between 3 and 250),
 badge_digest bytea not null unique,
 pin_hash text not null,
 prepared_at timestamptz not null default now(),
 primary key(owner_id,slot)
);
alter table public.pos_pending_employee_badges enable row level security;
revoke all on public.pos_pending_employee_badges from public,anon,authenticated;

-- Called ONLY from the signed-in owner/admin POS session. Server also checks
-- owner's original badge + PIN with throttling, not browser role flags.
create or replace function public.pos_owner_prepare_employee_badge(
 p_slot integer,p_first_name text,p_email text,p_badge text,p_pin text,
 p_owner_badge text,p_owner_pin text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_uid uuid:=auth.uid();
 v_attempt public.pos_staff_auth_attempts%rowtype;
 v_owner public.pos_staff_credentials%rowtype;
 v_name text:=btrim(coalesce(p_first_name,''));
 v_email text:=lower(btrim(coalesce(p_email,'')));
 v_badge text:=btrim(coalesce(p_badge,''));
 v_pin text:=coalesce(p_pin,'');
 v_owner_badge text:=btrim(coalesce(p_owner_badge,''));
 v_owner_pin text:=coalesce(p_owner_pin,'');
begin
 if v_uid is null or not public.is_persen_admin() or
    not exists(select 1 from public.pos_registers
       where owner_id=v_uid and active=true) then
  raise exception 'Owner authorization required';
 end if;
 if p_slot not in (1,2)
    or length(v_name) not between 1 and 80
    or length(v_email) not between 3 and 250
    or v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$'
    or v_badge !~ '^[0-9]{8}$'
    or length(v_pin) not between 6 and 128
    or length(v_owner_badge) not between 8 and 256
    or length(v_owner_pin) not between 6 and 128 then
  raise exception 'Invalid pending badge setup';
 end if;
 insert into public.pos_staff_auth_attempts(auth_user_id)
 values(v_uid) on conflict(auth_user_id) do nothing;
 select * into v_attempt from public.pos_staff_auth_attempts
 where auth_user_id=v_uid for update;
 if v_attempt.blocked_until>now() then
  raise exception 'Owner verification temporarily unavailable';
 end if;
 if v_attempt.window_started<now()-interval '15 minutes' then
  update public.pos_staff_auth_attempts
    set attempts=0,window_started=now(),blocked_until=null
    where auth_user_id=v_uid;
 end if;
 select * into v_owner from public.pos_staff_credentials
 where auth_user_id=v_uid and staff_role='owner' and enabled
   and badge_digest=extensions.digest(v_owner_badge,'sha256')
   and extensions.crypt(v_owner_pin,pin_hash)=pin_hash
 for update;
 if not found then
  update public.pos_staff_auth_attempts
  set attempts=attempts+1,
      blocked_until=case when attempts+1>=5 then now()+interval '15 minutes' else null end
  where auth_user_id=v_uid;
  return jsonb_build_object('saved',false,'error','Owner badge/PIN not verified');
 end if;
 if exists(select 1 from public.pos_staff_credentials
   where badge_digest=extensions.digest(v_badge,'sha256'))
   or exists(select 1 from public.pos_pending_employee_badges
   where badge_digest=extensions.digest(v_badge,'sha256')
     and (owner_id<>v_uid or slot<>p_slot)) then
  raise exception 'This badge code is unavailable';
 end if;
 insert into public.pos_pending_employee_badges
   (owner_id,slot,first_name,employee_email,badge_digest,pin_hash,prepared_at)
 values(v_uid,p_slot,v_name,v_email,extensions.digest(v_badge,'sha256'),
   extensions.crypt(v_pin,extensions.gen_salt('bf',12)),now())
 on conflict(owner_id,slot) do update set
   first_name=excluded.first_name,employee_email=excluded.employee_email,
   badge_digest=excluded.badge_digest,pin_hash=excluded.pin_hash,
   prepared_at=now();
 update public.pos_staff_auth_attempts
 set attempts=0,window_started=now(),blocked_until=null where auth_user_id=v_uid;
 return jsonb_build_object('saved',true,'slot',p_slot,'activated',false,
    'message','Badge reserved. Separate staff account and grant still required.');
exception when unique_violation then
 raise exception 'This badge code is unavailable';
end;
$$;
revoke all on function public.pos_owner_prepare_employee_badge(integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.pos_owner_prepare_employee_badge(integer,text,text,text,text,text,text) to authenticated;

create or replace function public.pos_owner_pending_employee_badges()
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_rows jsonb;
begin
 if v_uid is null or not public.is_persen_admin() then
  raise exception 'Owner authorization required';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'slot',slot,'firstName',first_name,'email',employee_email,
    'preparedAt',prepared_at,'activated',false) order by slot),'[]'::jsonb)
 into v_rows from public.pos_pending_employee_badges where owner_id=v_uid;
 return v_rows;
end;
$$;
revoke all on function public.pos_owner_pending_employee_badges() from public,anon,authenticated;
grant execute on function public.pos_owner_pending_employee_badges() to authenticated;
