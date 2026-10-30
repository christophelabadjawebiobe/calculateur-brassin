// app/dashboard/users/page.tsx : ancien emplacement, redirige vers l'administration
import { redirect } from 'next/navigation';
export default function OldUsersPage() { redirect('/admin/users'); }
