\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/03_app_state_calculateur.sql
\i sql/04_admin_reel_validation.sql
\i sql/05_roles_permissions.sql
\i sql/05_roles_permissions.sql
insert into roles(id,name) values ('stagiaire','Stagiaire') on conflict do nothing;
insert into role_permissions values ('stagiaire','analyse','read'),('stagiaire','budget','none'),('stagiaire','calculateur','write');
insert into auth.users values ('00000000-0000-0000-0000-00000000000e');
insert into profiles values ('00000000-0000-0000-0000-00000000000e','e@x','E','stagiaire');
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000e';
select 'stagiaire app_level', app_level('calculateur'), app_level('analyse'), app_level('budget');
select 'stagiaire acces budget / analyse', has_app_access('/apps/budget'), has_app_access('/apps/analyse');
select 'stagiaire peut ecrire budget/analyse/finance', can_write_budget(), can_write_actuals(), can_write_finance();
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user: budget lecture, ecriture refusee', has_app_access('/apps/budget'), can_write_budget();
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'brasseur ecrit', can_write_budget(), can_write_actuals();
do $$ begin begin insert into roles(id,name) values ('x1','X'); raise exception 'FAIL non-admin cree role'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK non-admin ne cree pas de role'; end; end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into roles(id,name,description) values ('compta','Comptabilité','x');
insert into role_permissions values ('compta','budget','write');
update role_permissions set level='read' where role_id='compta';
select 'admin role cree', (select count(*) from roles), (select level from role_permissions where role_id='compta');
update role_permissions set level='none' where role_id='admin';
select 'admin: perms du role admin intactes', (select count(*) from role_permissions where role_id='admin' and level='write');
delete from roles where id='admin'; select 'role systeme non supprime', count(*) from roles where id='admin';
delete from roles where id='compta'; select 'role perso supprime', count(*) from roles where id='compta';
reset role;
