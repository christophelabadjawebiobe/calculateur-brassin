// app/apps/admin/users/page.tsx : ancienne adresse /apps/admin/users, redirige vers la route officielle /admin/users
import { redirect } from 'next/navigation';

export default function LegacyAdminUsersPage() {
  redirect('/admin/users');
}
