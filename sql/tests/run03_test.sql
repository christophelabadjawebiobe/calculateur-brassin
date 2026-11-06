\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/03_app_state_calculateur.sql
\i sql/03_app_state_calculateur.sql
-- d : accès calculateur mais rôle user ; a admin ; b brasseur (sans accès calculateur -> refusé) 
insert into public.user_app_permissions select '00000000-0000-0000-0000-00000000000b', id, true from public.applications where name='calculateur';
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into app_state(id,data) values ('main','{"recipes":[1,2],"annual":{"g":1}}');
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
update app_state set data='{"recipes":[1,2,3],"annual":{"g":1}}' where id='main';
select 'brasseur maj ok', jsonb_array_length(data->'recipes') from app_state;
do $$ begin begin update app_state set data='{"recipes":[1],"annual":{"g":1}}'; raise exception 'FAIL suppr'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK brasseur ne supprime pas de recette'; end; end $$;
do $$ begin begin update app_state set data='{"recipes":[1,2,3],"annual":{"g":2}}'; raise exception 'FAIL annual'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK brasseur ne modifie pas annual'; end; end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select 'user (acces calc) lit', count(*) from app_state;
update app_state set data='{}'; select 'user maj : inchangé', jsonb_array_length(data->'recipes') from app_state;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user sans acces calc', count(*) from app_state;
reset role;
