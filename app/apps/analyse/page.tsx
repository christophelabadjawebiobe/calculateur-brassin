// app/apps/analyse/page.tsx : « Reporting » : analyse du réalisé face au budget validé et à l'année N-1
import { requireApp } from '@/lib/access';
import AnalyseApp from './AnalyseApp';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reporting' };

export default async function AnalysePage() {
  const { canEdit } = await requireApp('/apps/analyse', 'can_write_actuals');
  return <AnalyseApp canEdit={canEdit} />;
}
