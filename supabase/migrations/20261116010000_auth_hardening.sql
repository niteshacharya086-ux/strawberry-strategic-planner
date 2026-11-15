-- Authentication hardening: reserve nitesh and rate-limit username logins.
begin;
create function private.guard_reserved_main_username() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if lower(new.username)='nitesh' and not exists(select 1 from public.platform_admins a where a.user_id=new.user_id and a.is_primary) then
  raise exception 'The username nitesh is reserved for the primary Main Admin';
 end if;
 return new;
end $$;
create trigger reserve_main_admin_username before insert or update of username on public.profiles for each row execute function private.guard_reserved_main_username();
revoke all on function private.guard_reserved_main_username() from public,anon,authenticated;

create table public.login_rate_limits (
 login_key text primary key check(login_key ~ '^[0-9a-f]{64}$'), attempts integer not null default 0 check(attempts>=0),
 window_started_at timestamptz not null default now(), locked_until timestamptz
);
alter table public.login_rate_limits enable row level security;
revoke all on public.login_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on public.login_rate_limits to service_role;
-- Server-side Edge Functions require table privileges for admin-client calls.
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
create function public.login_rate_limit_remaining(p_key text) returns integer language sql security definer set search_path='' as $$
 select coalesce(greatest(0,ceil(extract(epoch from (r.locked_until-now())))::integer),0) from public.login_rate_limits r where r.login_key=p_key $$;
create function public.record_login_failure(p_key text) returns integer language plpgsql security definer set search_path='' as $$
declare remaining integer; begin
 insert into public.login_rate_limits(login_key,attempts,window_started_at,locked_until) values(p_key,1,now(),null)
 on conflict(login_key) do update set
  attempts=case when public.login_rate_limits.window_started_at < now()-interval '15 minutes' then 1 else public.login_rate_limits.attempts+1 end,
  window_started_at=case when public.login_rate_limits.window_started_at < now()-interval '15 minutes' then now() else public.login_rate_limits.window_started_at end,
  locked_until=case when (case when public.login_rate_limits.window_started_at < now()-interval '15 minutes' then 1 else public.login_rate_limits.attempts+1 end)>=8 then now()+interval '15 minutes' else null end;
 select public.login_rate_limit_remaining(p_key) into remaining; return remaining;
end $$;
create function public.clear_login_failures(p_key text) returns void language sql security definer set search_path='' as $$ delete from public.login_rate_limits where login_key=p_key $$;
revoke all on function public.login_rate_limit_remaining(text),public.record_login_failure(text),public.clear_login_failures(text) from public,anon,authenticated;
grant execute on function public.login_rate_limit_remaining(text),public.record_login_failure(text),public.clear_login_failures(text) to service_role;
commit;
