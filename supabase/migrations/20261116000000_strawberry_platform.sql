-- Strawberry Strategic Planner platform schema (new Supabase project).
-- Apply with Supabase SQL Editor or `supabase db push`. No password/bootstrap secret belongs here.
begin;
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-zA-Z0-9_.-]{3,32}$'),
 display_name text not null default '', status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index profiles_username_casefold on public.profiles(lower(username));
create table public.platform_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 is_primary boolean not null default false, created_at timestamptz not null default now(),
 check (not is_primary or user_id is not null)
);
create unique index one_primary_admin on public.platform_admins(is_primary) where is_primary;
create table public.platform_settings (
 setting_key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.guilds (
 id uuid primary key default gen_random_uuid(), guild_code text not null unique check(guild_code ~ '^[A-Z0-9-]{3,32}$'),
 name text not null check(char_length(name) between 2 and 80), status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.guild_memberships (
 guild_id uuid not null references public.guilds(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('guild_admin','planner','member')), created_at timestamptz not null default now(),
 primary key(guild_id,user_id)
);
create table public.guild_registration_requests (
 id uuid primary key default gen_random_uuid(), requested_name text not null check(char_length(requested_name) between 2 and 80),
 requested_code text not null check(requested_code ~ '^[A-Z0-9-]{3,32}$'), contact_note text,
 requester_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id)
);
create table public.guild_membership_requests (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), unique(guild_id,user_id)
);
-- Legacy workspace retained to keep the existing planner's serialized format working.
create table public.guild_workspaces (
 guild_id uuid primary key references public.guilds(id) on delete cascade, workspace jsonb not null default '{"players":[],"pool":[]}'::jsonb,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.guild_players (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 legacy_id text not null, is_pool boolean not null default false,
 display_name text not null check(char_length(display_name) between 1 and 100), data jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(guild_id,id), unique(guild_id,legacy_id)
);
create table public.guild_maps (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 legacy_id text not null, name text not null, data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(guild_id,id), unique(guild_id,legacy_id)
);
create table public.guild_plans (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 legacy_id text not null, map_id uuid, name text not null, data jsonb not null default '{}', created_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(guild_id,id),
 unique(guild_id,legacy_id),
 foreign key(guild_id,map_id) references public.guild_maps(guild_id,id) on delete cascade
);
create table public.guild_placements (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 plan_id uuid not null, player_id uuid, position jsonb not null default '{}',
 foreign key(guild_id,plan_id) references public.guild_plans(guild_id,id) on delete cascade,
 foreign key(guild_id,player_id) references public.guild_players(guild_id,id) on delete cascade
);
create table public.participation_entries (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 60), note text check(char_length(coalesce(note,''))<=200),
 created_at timestamptz not null default now()
);
create table public.guild_files (
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.guilds(id) on delete cascade,
 object_path text not null unique, display_name text not null, content_type text, uploaded_by uuid references auth.users(id), created_at timestamptz not null default now(),
 check(object_path like guild_id::text || '/%')
);
create table public.guild_audit_logs (
 id bigint generated always as identity primary key, guild_id uuid not null references public.guilds(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.platform_audit_logs (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
 target_user_id uuid, guild_id uuid, action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);

create function private.audit_membership_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb; action_name text; begin
 if tg_op='DELETE' then rowdata:=to_jsonb(old); action_name:='membership_deleted';
 elsif tg_op='INSERT' then rowdata:=to_jsonb(new); action_name:='membership_created';
 else rowdata:=to_jsonb(new); action_name:='membership_role_changed'; end if;
 insert into public.guild_audit_logs(guild_id,actor_id,action,details) values((rowdata->>'guild_id')::uuid,(select auth.uid()),action_name,rowdata);
 insert into public.platform_audit_logs(actor_id,target_user_id,guild_id,action,details) values((select auth.uid()),(rowdata->>'user_id')::uuid,(rowdata->>'guild_id')::uuid,action_name,rowdata);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger audit_guild_memberships after insert or update or delete on public.guild_memberships for each row execute function private.audit_membership_mutation();
revoke all on function private.audit_membership_mutation() from public,anon,authenticated;

create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins p join public.profiles pr on pr.user_id=p.user_id where p.user_id=(select auth.uid()) and pr.status='active') $$;
create function private.guild_role(gid uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.guild_memberships m join public.guilds g on g.id=m.guild_id join public.profiles p on p.user_id=m.user_id
 where m.guild_id=gid and m.user_id=(select auth.uid()) and g.status='active' and p.status='active' $$;
create function private.can_access_guild(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_platform_admin() or private.guild_role(gid) is not null $$;
revoke all on function private.is_platform_admin(),private.guild_role(uuid),private.can_access_guild(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_platform_admin(),private.guild_role(uuid),private.can_access_guild(uuid) to authenticated;

-- Least-privilege, role-specific RLS. Platform mutation is performed only in trusted Edge Functions.
do $$ declare t text; begin
 foreach t in array array['profiles','platform_admins','platform_settings','guilds','guild_memberships','guild_registration_requests','guild_membership_requests','guild_workspaces','guild_players','guild_maps','guild_plans','guild_placements','participation_entries','guild_files','guild_audit_logs','platform_audit_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy profile_read_self_or_admin on public.profiles for select to authenticated using(user_id=(select auth.uid()) or private.is_platform_admin());
create policy admin_read_self on public.platform_admins for select to authenticated using(user_id=(select auth.uid()));
create policy setting_read_admin on public.platform_settings for select to authenticated using(private.is_platform_admin());
create policy guild_read_member on public.guilds for select to authenticated using(private.can_access_guild(id));
create policy membership_read_guild on public.guild_memberships for select to authenticated using(user_id=(select auth.uid()) or private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
create policy registration_read_admin on public.guild_registration_requests for select to authenticated using(private.is_platform_admin());
create policy registration_insert_self on public.guild_registration_requests for insert to authenticated with check(requester_id=(select auth.uid()) and status='pending');
grant insert(requested_name,requested_code,contact_note) on public.guild_registration_requests to authenticated;
create policy membership_request_read on public.guild_membership_requests for select to authenticated using(user_id=(select auth.uid()) or private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
create policy membership_request_insert_self on public.guild_membership_requests for insert to authenticated with check(user_id=(select auth.uid()) and status='pending' and private.can_access_guild(guild_id));
grant insert(guild_id) on public.guild_membership_requests to authenticated;
create policy workspace_read on public.guild_workspaces for select to authenticated using(private.can_access_guild(guild_id));
create policy workspace_create_admin on public.guild_workspaces for insert to authenticated with check(private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
create policy workspace_edit_planner on public.guild_workspaces for update to authenticated using(private.is_platform_admin() or private.guild_role(guild_id) in ('guild_admin','planner')) with check(private.is_platform_admin() or private.guild_role(guild_id) in ('guild_admin','planner'));
grant insert(guild_id,workspace) on public.guild_workspaces to authenticated;
grant update(workspace,updated_at,updated_by) on public.guild_workspaces to authenticated;
create function private.guard_legacy_workspace_players() returns trigger language plpgsql security definer set search_path='' as $$
declare old_ids text[]; new_ids text[]; old_identity text;
begin
 if (select auth.uid()) is null or private.is_platform_admin() or private.guild_role(old.guild_id)='guild_admin' then return new; end if;
 old_ids:=array(select coalesce(x->>'id',x->>'name',x::text) from (select value x from jsonb_array_elements(coalesce(old.workspace->'players','[]'::jsonb)) union all select value x from jsonb_array_elements(coalesce(old.workspace->'pool','[]'::jsonb))) q);
 new_ids:=array(select coalesce(x->>'id',x->>'name',x::text) from (select value x from jsonb_array_elements(coalesce(new.workspace->'players','[]'::jsonb)) union all select value x from jsonb_array_elements(coalesce(new.workspace->'pool','[]'::jsonb))) q);
 foreach old_identity in array coalesce(old_ids,'{}') loop
  if not (old_identity = any(coalesce(new_ids,'{}'))) then
   raise exception 'Planner role cannot delete players';
  end if;
 end loop;
 return new;
end $$;
create trigger guard_legacy_workspace_players before update on public.guild_workspaces for each row execute function private.guard_legacy_workspace_players();
revoke all on function private.guard_legacy_workspace_players() from public,anon,authenticated;
create function private.sync_workspace_normalized() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; v_map_id uuid; v_plan_id uuid; v_player_id uuid; placement record; actor uuid;
begin
 actor:=(select auth.uid());
 if actor is not null and not (private.is_platform_admin() or private.guild_role(new.guild_id) in ('guild_admin','planner')) then raise exception 'Not authorized to save this guild'; end if;

 -- Keep the normalized player roster and extra pool synchronized with the legacy planner state.
 insert into public.guild_players(guild_id,legacy_id,is_pool,display_name,data)
 select new.guild_id,coalesce(p->>'id',md5(p::text)),false,left(coalesce(p->>'name','Player'),100),p
 from jsonb_array_elements(coalesce(new.workspace->'players','[]'::jsonb)) as people(p)
 on conflict(guild_id,legacy_id) do update set is_pool=false,display_name=excluded.display_name,data=excluded.data;
 insert into public.guild_players(guild_id,legacy_id,is_pool,display_name,data)
 select new.guild_id,coalesce(p->>'id',md5(p::text)),true,left(coalesce(p->>'name','Player'),100),p
 from jsonb_array_elements(coalesce(new.workspace->'pool','[]'::jsonb)) as people(p)
 on conflict(guild_id,legacy_id) do update set is_pool=true,display_name=excluded.display_name,data=excluded.data;
 if actor is null or private.is_platform_admin() or private.guild_role(new.guild_id)='guild_admin' then
  delete from public.guild_players p where p.guild_id=new.guild_id and not exists(
   select 1 from (select coalesce(value->>'id',md5(value::text)) legacy_id from jsonb_array_elements(coalesce(new.workspace->'players','[]'::jsonb))
    union all select coalesce(value->>'id',md5(value::text)) from jsonb_array_elements(coalesce(new.workspace->'pool','[]'::jsonb))) x where x.legacy_id=p.legacy_id);
 end if;

 -- A planner map tab becomes a guild map plus a linked plan with placements.
 for item in select value from jsonb_array_elements(coalesce(new.workspace->'tabs','[]'::jsonb)) loop
  insert into public.guild_maps(guild_id,legacy_id,name,data) values(new.guild_id,coalesce(item->>'id',md5(item::text)),left(coalesce(item->>'name','Map'),120),item)
  on conflict(guild_id,legacy_id) do update set name=excluded.name,data=excluded.data,updated_at=now() returning id into v_map_id;
  insert into public.guild_plans(guild_id,legacy_id,map_id,name,data,created_by) values(new.guild_id,coalesce(item->>'id',md5(item::text)),v_map_id,left(coalesce(item->>'name','Plan'),120),item,actor)
  on conflict(guild_id,legacy_id) do update set map_id=excluded.map_id,name=excluded.name,data=excluded.data,updated_at=now() returning id into v_plan_id;
  delete from public.guild_placements gp where gp.guild_id=new.guild_id and gp.plan_id=v_plan_id;
  for placement in select key,value from jsonb_each(coalesce(item->'placed','{}'::jsonb)) loop
   select p.id into v_player_id from public.guild_players p where p.guild_id=new.guild_id and p.legacy_id=placement.key;
   if v_player_id is not null then insert into public.guild_placements(guild_id,plan_id,player_id,position) values(new.guild_id,v_plan_id,v_player_id,placement.value); end if;
  end loop;
 end loop;
 delete from public.guild_maps m where m.guild_id=new.guild_id and not exists(
  select 1 from jsonb_array_elements(coalesce(new.workspace->'tabs','[]'::jsonb)) as tabs(tab) where coalesce(tab->>'id',md5(tab::text))=m.legacy_id);
 insert into public.guild_audit_logs(guild_id,actor_id,action,details) values(new.guild_id,actor,'workspace_saved',jsonb_build_object('players',jsonb_array_length(coalesce(new.workspace->'players','[]'::jsonb)),'pool',jsonb_array_length(coalesce(new.workspace->'pool','[]'::jsonb)),'maps',jsonb_array_length(coalesce(new.workspace->'tabs','[]'::jsonb))));
 return new;
end $$;
create trigger sync_workspace_normalized after insert or update of workspace on public.guild_workspaces for each row execute function private.sync_workspace_normalized();
revoke all on function private.sync_workspace_normalized() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['guild_players','guild_maps','guild_plans','guild_placements'] loop
  execute format('create policy %I on public.%I for select to authenticated using(private.can_access_guild(guild_id))',t||'_read',t);
  execute format('create policy %I on public.%I for insert to authenticated with check(private.is_platform_admin() or private.guild_role(guild_id) in (''guild_admin'',''planner''))',t||'_edit_insert',t);
  execute format('create policy %I on public.%I for update to authenticated using(private.is_platform_admin() or private.guild_role(guild_id) in (''guild_admin'',''planner'')) with check(private.is_platform_admin() or private.guild_role(guild_id) in (''guild_admin'',''planner''))',t||'_edit_update',t);
  execute format('grant insert,update on public.%I to authenticated',t);
  if t<>'guild_players' then execute format('create policy %I on public.%I for delete to authenticated using(private.is_platform_admin() or private.guild_role(guild_id)=''guild_admin'')',t||'_admin_delete',t); execute format('grant delete on public.%I to authenticated',t); end if;
 end loop;
end $$;
create policy guild_players_delete_admin on public.guild_players for delete to authenticated using(private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
grant delete on public.guild_players to authenticated;
create policy participation_read_guild on public.participation_entries for select to authenticated using(private.can_access_guild(guild_id));
create policy participation_insert_member on public.participation_entries for insert to authenticated with check(user_id=(select auth.uid()) and private.guild_role(guild_id)='member');
create policy participation_delete_admin on public.participation_entries for delete to authenticated using(private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
grant insert(guild_id,display_name,note) on public.participation_entries to authenticated;
grant delete on public.participation_entries to authenticated;
create policy file_meta_read on public.guild_files for select to authenticated using(private.can_access_guild(guild_id));
create policy file_meta_add on public.guild_files for insert to authenticated with check((uploaded_by=(select auth.uid()) and private.guild_role(guild_id) in ('guild_admin','planner')) or private.is_platform_admin());
create policy file_meta_delete_admin on public.guild_files for delete to authenticated using(private.is_platform_admin() or private.guild_role(guild_id)='guild_admin');
grant insert(guild_id,object_path,display_name,content_type,uploaded_by) on public.guild_files to authenticated;
grant delete on public.guild_files to authenticated;
create policy guild_audit_admin_read on public.guild_audit_logs for select to authenticated using(private.guild_role(guild_id)='guild_admin');
create policy platform_audit_admin_read on public.platform_audit_logs for select to authenticated using(private.is_platform_admin());

-- Supabase private Storage bucket; first path segment MUST be guild UUID.
insert into storage.buckets(id,name,public) values('guild-files','guild-files',false) on conflict(id) do update set public=false;
create policy guild_files_select on storage.objects for select to authenticated using(bucket_id='guild-files' and private.can_access_guild(((storage.foldername(name))[1])::uuid));
create policy guild_files_insert on storage.objects for insert to authenticated with check(bucket_id='guild-files' and (private.is_platform_admin() or private.guild_role(((storage.foldername(name))[1])::uuid) in ('guild_admin','planner')));
create policy guild_files_update on storage.objects for update to authenticated using(bucket_id='guild-files' and (private.is_platform_admin() or private.guild_role(((storage.foldername(name))[1])::uuid) in ('guild_admin','planner'))) with check(bucket_id='guild-files' and (private.is_platform_admin() or private.guild_role(((storage.foldername(name))[1])::uuid) in ('guild_admin','planner')));
create policy guild_files_delete on storage.objects for delete to authenticated using(bucket_id='guild-files' and (private.is_platform_admin() or private.guild_role(((storage.foldername(name))[1])::uuid)='guild_admin'));

-- Existing entry points retained; privileged CRUD is intentionally moved to Edge Functions.
create function public.request_guild_membership(p_guild_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare gid uuid; rid uuid; begin
 if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
 select id into gid from public.guilds where guild_code=upper(trim(p_guild_code)) and status='active';
 if gid is null then raise exception 'Guild not found or inactive'; end if;
 insert into public.guild_membership_requests(guild_id,user_id) values(gid,(select auth.uid())) on conflict(guild_id,user_id) do update set status='pending' returning id into rid; return rid;
end $$;
create function public.review_guild_membership(p_request_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare req public.guild_membership_requests%rowtype; begin
 select * into req from public.guild_membership_requests where id=p_request_id for update;
 if not found or private.guild_role(req.guild_id)<>'guild_admin' then raise exception 'Not authorized'; end if;
 update public.guild_membership_requests set status=case when p_approve then 'approved' else 'rejected' end where id=p_request_id;
 if p_approve then insert into public.guild_memberships(guild_id,user_id,role) values(req.guild_id,req.user_id,'member') on conflict do nothing; end if;
end $$;
revoke all on function public.request_guild_membership(text),public.review_guild_membership(uuid,boolean) from public,anon;
grant execute on function public.request_guild_membership(text),public.review_guild_membership(uuid,boolean) to authenticated;
commit;
