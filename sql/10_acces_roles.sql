-- =====================================================================
-- 10_acces_roles.sql : le niveau du RÔLE est la seule référence d'accès à une application
-- Modèle de données (inchangé) : role_permissions(role_id, app_key, level) avec level = 'none' | 'read' | 'write'
--   « Accès » décoché  = none  : tuile masquée, pages et données interdites (has_app_access = faux)
--   « Accès » coché    = read  : consultation seule
--   « Écriture » cochée = write : modification (impossible sans « Accès »)
-- Jusqu'ici, un droit individuel hérité (user_app_permissions.has_access) pouvait encore ouvrir une application
-- que le rôle avait retirée. Désormais il ne sert que de repli pour un rôle SANS ligne de permission pour cette application.
-- Rejouable. À exécuter après 05 (et 07 pour 'cooperateurs').
-- =====================================================================
create or replace function public.has_app_access(p_route text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or case
           when exists (select 1 from public.profiles p join public.role_permissions rp on rp.role_id = p.role
                         where p.id = auth.uid() and rp.app_key = public.route_app(p_route))
             then public.app_level(public.route_app(p_route)) <> 'none'
           else exists (
             select 1 from public.user_app_permissions upa join public.applications a on a.id = upa.app_id
              where upa.user_id = auth.uid() and upa.has_access = true and a.route = p_route)
         end
$$;
grant execute on function public.has_app_access(text) to authenticated;

-- Contrôle : niveau de chaque rôle par application
select role_id, app_key, level from public.role_permissions order by role_id, app_key;
