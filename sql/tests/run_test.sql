\set ON_ERROR_STOP on
\i sql/01_budget_analyse.sql
\i sql/01_budget_analyse.sql
-- admin crée plan + lignes + réel
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
insert into budget_plans(year) values (2026);
insert into budget_lines(plan_id,month,category,label,amount) select id,m,'ventes','HORECA',1000 from budget_plans, generate_series(1,12) m;
insert into budget_lines(plan_id,month,category,label,amount) select id,m,'matieres_premieres','Malt',300 from budget_plans, generate_series(1,12) m;
insert into budget_volumes(plan_id,month,hl_brewed,hl_sold) select id,1,20,18 from budget_plans;
insert into actuals_monthly(year,month,category,label,amount) values (2026,1,'ventes','',1200),(2026,1,'matieres_premieres','',250),(2025,1,'ventes','',900);
insert into actual_volumes values (2026,1,22,19),(2025,1,15,14);
select 'admin vue' t, month, category, budget, actual, variance, variance_favorable, prev_actual, yoy_pct from v_budget_vs_actual where year=2026 and month=1 order by sort_order;
select 'volumes' t, * from v_volumes_compare where year=2026 and month=1;
-- brasseur budget: lit et écrit le budget, n'écrit pas le réel
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
select 'brasseur lit lignes' t, count(*) from budget_lines;
update budget_lines set amount=1100 where category='ventes' and month=1;
select 'brasseur maj budget' t, amount from budget_lines where category='ventes' and month=1;
do $$ begin begin insert into actuals_monthly(year,month,category,label,amount) values (2026,2,'ventes','x',1); raise exception 'FAIL: brasseur a écrit le réel'; exception when insufficient_privilege or others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK brasseur ne peut pas écrire le réel (%)', sqlerrm; end; end $$;
-- user analyse : lit tout, n'écrit rien
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
select 'user analyse lit budget' t, count(*) from budget_lines;
select 'user analyse vue' t, count(*) from v_budget_vs_actual;
do $$ begin begin insert into actuals_monthly(year,month,category,label,amount) values (2026,2,'ventes','y',1); raise exception 'FAIL: user a écrit'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK user (role user) ne peut pas écrire (%)', sqlerrm; end; end $$;
-- d : aucun accès
set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000d';
select 'user sans accès lignes' t, count(*) from budget_lines;
select 'user sans accès vue' t, count(*) from v_budget_vs_actual;
select 'user sans accès réel' t, count(*) from actuals_monthly;
reset role; set role anon;
do $$ begin begin perform count(*) from budget_lines; raise exception 'FAIL anon'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK anon refusé'; end; end $$;
