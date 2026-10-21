// app/apps/budget/page.tsx
import { requireApp } from '@/lib/access';
import BudgetEditor from './BudgetEditor';

export const dynamic = 'force-dynamic';

export default async function BudgetPage() {
  const { canEdit } = await requireApp('/apps/budget', 'can_write_budget');
  return (
    <main className="mx-auto max-w-[1400px] p-4">
      <h1 className="mb-1 text-2xl font-semibold">Budget prévisionnel</h1>
      <p className="mb-4 text-sm text-gray-600">
        Revenus prévus, charges fixes et variables, matières premières et volumes, mois par mois. Montants en € HTVA.
      </p>
      <BudgetEditor canEdit={canEdit} />
    </main>
  );
}
