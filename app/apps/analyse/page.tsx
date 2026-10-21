// app/apps/analyse/page.tsx
import { requireApp } from '@/lib/access';
import AppHeader from '@/components/AppHeader';
import AnalyseDashboard from './AnalyseDashboard';

export const dynamic = 'force-dynamic';

export default async function AnalysePage() {
  const { canEdit } = await requireApp('/apps/analyse', 'can_write_actuals');
  return (
    <>
    <AppHeader title="Analyse : réel et budget" />
    <main className="mx-auto max-w-[1400px] p-4">
      <h1 className="mb-1 text-2xl font-semibold">Analyse : réel, budget et années antérieures</h1>
      <p className="mb-4 text-sm text-gray-600">Comparaison mois par mois du réel avec le budget, et de l&apos;année N avec N-1.</p>
      <AnalyseDashboard canEdit={canEdit} />
    </main>
    </>
  );
}
