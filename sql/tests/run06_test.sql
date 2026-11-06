\set ON_ERROR_STOP on
\i sql/mock_test.sql
\i sql/01_budget_analyse.sql
\i sql/02_budget_pcmn.sql
\i sql/03_app_state_calculateur.sql
\i sql/04_admin_reel_validation.sql
\i sql/05_roles_permissions.sql
-- un budget validé avant la migration
set role postgres;
delete from pcmn_budget_plans;
insert into pcmn_budget_plans(year,data) values (2025,'{"v":1,"rows":{}}');
alter table pcmn_budget_plans disable trigger trg_pcmn_plans_guard;
update pcmn_budget_plans set validated_at=now(), validated_data=data where year=2025;
alter table pcmn_budget_plans enable trigger trg_pcmn_plans_guard;
\i sql/06_budget_scenarios.sql
\i sql/06_budget_scenarios.sql
select 'migration : base + verrouillé', scenario, title, is_locked from pcmn_budget_plans where year=2025;
select 'cle primaire = (year, scenario)', (select array_length(conkey,1) from pg_constraint where conrelid='pcmn_budget_plans'::regclass and contype='p');
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into pcmn_budget_plans(year,scenario,title,data) values (2026,'base','Budget 2026','{"v":1,"rows":{}}'),(2026,'prudent','Budget Prudent','{"v":1,"rows":{"701000":{"mode":"annual","annual":10,"months":[],"subs":[]}}}');
select 'deux scenarios en 2026', count(*) from pcmn_budget_plans where year=2026;
do $$ begin begin insert into pcmn_budget_plans(year,scenario,title) values (2026,'prudent','doublon'); raise exception 'FAIL doublon'; exception when unique_violation then raise notice 'OK doublon (annee, scenario) refuse'; end; end $$;
do $$ begin begin insert into pcmn_budget_plans(year,scenario,title) values (2026,'Mauvais Nom','x'); raise exception 'FAIL format'; exception when check_violation then raise notice 'OK identifiant de scenario invalide refuse'; end; end $$;
select 'valider prudent', validate_pcmn_budget(2026,true,'prudent') is not null;
select 'prudent verrouillé, base non', (select is_locked from pcmn_budget_plans where year=2026 and scenario='prudent'), (select is_locked from pcmn_budget_plans where year=2026 and scenario='base');
do $$ begin begin update pcmn_budget_plans set data='{"v":1,"rows":{}}' where year=2026 and scenario='prudent'; raise exception 'FAIL modif verrouille'; exception when insufficient_privilege then raise notice 'OK modification refusée sur budget verrouillé'; end; end $$;
update pcmn_budget_plans set title='Prudent (renommé)' where year=2026 and scenario='prudent';
update pcmn_budget_plans set data='{"v":1,"rows":{"701000":{"mode":"annual","annual":99,"months":[],"subs":[]}}}' where year=2026 and scenario='base';
select 'base modifiable', (data->'rows'->'701000'->>'annual') from pcmn_budget_plans where year=2026 and scenario='base';
-- un non-admin ne peut ni valider ni déverrouiller
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
do $$ begin begin perform validate_pcmn_budget(2026,true,'base'); raise exception 'FAIL non-admin valide'; exception when insufficient_privilege then raise notice 'OK non-admin ne valide pas'; end; end $$;
update pcmn_budget_plans set is_locked=false where year=2026 and scenario='prudent';
select 'non-admin ne déverrouille pas', is_locked from pcmn_budget_plans where year=2026 and scenario='prudent';
insert into pcmn_budget_plans(year,scenario,title,data,is_locked) values (2027,'base','Budget 2027','{"v":1,"rows":{}}',true);
select 'non-admin ne crée pas de budget verrouillé', is_locked from pcmn_budget_plans where year=2027;
-- déverrouillage admin
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
select 'deverrouiller', validate_pcmn_budget(2026,false,'prudent') is null, (select is_locked from pcmn_budget_plans where year=2026 and scenario='prudent');
