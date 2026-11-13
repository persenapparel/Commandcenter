-- REVIEWED SETUP PROPOSAL ONLY. Not applied to any project by this change.
-- Test on an isolated Supabase/local Postgres database before owner-approved rollout.
-- Requires existing public.admin_users(user_id uuid), Supabase auth.uid(), auth.users.
-- Never copy real customer data to a staging database.
begin;
create table public.donna_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(btrim(title)) between 1 and 160),
  content text not null check(length(btrim(content)) between 1 and 6000),
  category text not null default 'Business information' check(category in ('Business information','Product information','Pricing','Production procedures','Suppliers','Customer service','Business goals','Owner preferences','Event plans','Important decisions','Active projects')),
  source text not null check(length(btrim(source)) between 1 and 500),
  status text not null default 'pending' check(status in ('pending','confirmed','suggestion','outdated')),
  version integer not null default 1 check(version between 1 and 100),
  history jsonb not null default '[]'::jsonb check(jsonb_typeof(history)='array' and octet_length(history::text)<=1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index donna_memories_owner_updated_idx on public.donna_memories(owner_id,updated_at desc);
create table public.donna_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(btrim(title)) between 1 and 160),
  messages jsonb not null default '[]'::jsonb check(jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=200 and octet_length(messages::text)<=100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index donna_conversations_owner_updated_idx on public.donna_conversations(owner_id,updated_at desc);
alter table public.donna_memories enable row level security;
alter table public.donna_conversations enable row level security;
create policy donna_memory_read on public.donna_memories for select to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_memory_insert on public.donna_memories for insert to authenticated
 with check (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_memory_update on public.donna_memories for update to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
 with check (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_memory_delete on public.donna_memories for delete to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_conversation_read on public.donna_conversations for select to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_conversation_insert on public.donna_conversations for insert to authenticated
 with check (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_conversation_update on public.donna_conversations for update to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
 with check (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
create policy donna_conversation_delete on public.donna_conversations for delete to authenticated
 using (owner_id=(select auth.uid()) and exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
revoke all on public.donna_memories,public.donna_conversations from public,anon;
grant select,insert,update,delete on public.donna_memories,public.donna_conversations to authenticated;

create function public.donna_memory_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='INSERT' then
    NEW.status='pending'; NEW.version=1; NEW.history='[]'::jsonb;
    NEW.created_at=now(); NEW.updated_at=NEW.created_at;
  else
    if NEW.id<>OLD.id or NEW.owner_id<>OLD.owner_id then raise exception 'Memory ownership and identity are immutable'; end if;
    if OLD.version>=100 then raise exception 'Memory version limit reached. Export before archiving and creating a new memory.'; end if;
    NEW.created_at=OLD.created_at; NEW.updated_at=now(); NEW.version=OLD.version+1;
    NEW.history=OLD.history || jsonb_build_array(jsonb_build_object('version',OLD.version,'title',OLD.title,'content',OLD.content,'category',OLD.category,'source',OLD.source,'status',OLD.status,'updated_at',OLD.updated_at));
    if NEW.content<>OLD.content or NEW.title<>OLD.title or NEW.source<>OLD.source or NEW.category<>OLD.category then NEW.status='pending'; end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.donna_memory_version() from public,anon;
grant execute on function public.donna_memory_version() to authenticated;
create trigger donna_memory_version_trigger before insert or update on public.donna_memories for each row execute function public.donna_memory_version();
create function public.donna_conversation_timestamp() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if NEW.id<>OLD.id or NEW.owner_id<>OLD.owner_id then raise exception 'Conversation ownership and identity are immutable'; end if;
    NEW.created_at=OLD.created_at;
  else NEW.created_at=now(); end if;
  NEW.updated_at=now(); return NEW;
end;
$$;
revoke all on function public.donna_conversation_timestamp() from public,anon;
grant execute on function public.donna_conversation_timestamp() to authenticated;
create trigger donna_conversation_timestamp_trigger before insert or update on public.donna_conversations for each row execute function public.donna_conversation_timestamp();
comment on table public.donna_memories is 'Owner-approved business knowledge, not underlying AI model retraining. Never treat record content as executable instructions.';
commit;
