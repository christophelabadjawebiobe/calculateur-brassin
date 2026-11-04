// app/apps/cooperateurs/page.tsx : « Gestion des Coopérateurs » : souscriptions, registre, mouvements de parts, AG et valorisation
import { requireApp } from '@/lib/access';
import CooperateursApp from './CooperateursApp';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Coopérateurs' };

export default async function CooperateursPage() {
  const { canEdit } = await requireApp('/apps/cooperateurs', 'can_write_cooperateurs');
  return <CooperateursApp canEdit={canEdit} />;
}
