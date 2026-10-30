\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/04_admin_reel_validation.sql
\i sql/04_admin_reel_validation.sql
grant select on auth.users to authenticated;
-- profils : admin voit tout
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select 'admin voit profils', count(*) from profiles;
update profiles set role='brasseur' where email='d@x';
select 'admin change role', role from profiles where email='d@x';
select 'admin valide', validate_pcmn_budget(2026) is not null;
select 'snapshot present', validated_data is not null, validated_at is not null from pcmn_budget_plans where year=2026;
-- dernier admin protégé
do $$ begin begin update profiles set role='user' where email='a@x'; raise exception 'FAIL dernier admin'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK dernier admin protege: %', sqlerrm; end; end $$;
-- brasseur
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'brasseur voit seulement son profil', count(*) from profiles;
update profiles set role='admin' where email='c@x';
select 'brasseur ne promeut pas (0 attendu admin c)', role from profiles where email='c@x';
do $$ begin begin perform validate_pcmn_budget(2026); raise exception 'FAIL brasseur valide'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK brasseur ne valide pas: %', sqlerrm; end; end $$;
update pcmn_budget_plans set validated_data = '{}'::jsonb, data = jsonb_set(data,'{rows,701000,annual}','7'::jsonb) where year=2026;
select 'brasseur: snapshot intact', validated_data::text <> '{}', data->'rows'->'701000'->>'annual' from pcmn_budget_plans where year=2026;
insert into pcmn_budget_history values ('701000',2022,123) on conflict (account_key,year) do update set amount=excluded.amount;
select 'brasseur importe historique', count(*) from pcmn_budget_history where year=2022;
insert into pcmn_actuals(account_key,year,month,amount) values ('701000',2026,1,100);
select 'brasseur ecrit actuals', count(*) from pcmn_actuals;
-- user analyse (c) : lit, n'écrit pas
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user analyse lit actuals', count(*) from pcmn_actuals;
do $$ begin begin insert into pcmn_actuals(account_key,year,month,amount) values ('701000',2026,2,1); raise exception 'FAIL user ecrit'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK user ne peut pas ecrire actuals'; end; end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select 'brasseur d (calculateur seul) lit actuals', count(*) from pcmn_actuals;
reset role;
