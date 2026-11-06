\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/02_budget_pcmn.sql
select 'rows histo',count(*) from pcmn_budget_history;
select 'plan 2026 comptes', (select count(*) from jsonb_object_keys(data->'rows')) from pcmn_budget_plans where year=2026;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'brasseur lit histo',count(*) from pcmn_budget_history;
update pcmn_budget_plans set data = jsonb_set(data,'{rows,701000,annual}','1'::jsonb) where year=2026;
select 'brasseur maj plan', data->'rows'->'701000'->>'annual', updated_at>now()-interval '1 minute' from pcmn_budget_plans;
do $$ begin begin insert into pcmn_budget_history values ('zz',2026,1); raise exception 'FAIL brasseur ecrit histo'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK brasseur ne peut pas ecrire histo'; end; end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user analyse lit plan',count(*) from pcmn_budget_plans;
update pcmn_budget_plans set data='{}'; 
select 'user analyse : maj refusee (0 ligne modifiee attendue)', data->'rows'->'701000'->>'annual' from pcmn_budget_plans;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select 'user sans acces histo',count(*) from pcmn_budget_history;
select 'user sans acces plan',count(*) from pcmn_budget_plans;
reset role;
