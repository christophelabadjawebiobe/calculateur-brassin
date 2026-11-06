do $$ begin if not exists (select 1 from pg_roles where rolname=$q$anon$q$) then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname=$q$authenticated$q$) then create role authenticated nologin; end if; end $$;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated; grant usage on schema public to authenticated, anon;
create table public.profiles(id uuid primary key references auth.users, email text, full_name text, role text);
create table public.applications(id uuid primary key default gen_random_uuid(), name text, description text, icon text, route text);
create table public.user_app_permissions(user_id uuid references auth.users, app_id uuid references public.applications, has_access boolean, primary key(user_id,app_id));
grant select on public.profiles, public.applications, public.user_app_permissions to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
insert into public.profiles values ('00000000-0000-0000-0000-00000000000a','a@x','A','admin'),('00000000-0000-0000-0000-00000000000b','b@x','B','brasseur'),('00000000-0000-0000-0000-00000000000c','c@x','C','user'),('00000000-0000-0000-0000-00000000000d','d@x','D','user');
insert into public.applications(name,route) values ('budget','/apps/budget'),('analyse','/apps/analyse'),('calculateur','/apps/calculateur');
-- b: budget (brasseur) ; c: analyse (user) ; d: calculateur seulement
insert into public.user_app_permissions select '00000000-0000-0000-0000-00000000000b', id, true from public.applications where name='budget';
insert into public.user_app_permissions select '00000000-0000-0000-0000-00000000000c', id, true from public.applications where name='analyse';
insert into public.user_app_permissions select '00000000-0000-0000-0000-00000000000d', id, true from public.applications where name='calculateur';
