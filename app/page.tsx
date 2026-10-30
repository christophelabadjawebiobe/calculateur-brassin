// app/page.tsx : la racine redirige vers le tableau de bord (le middleware renvoie vers /login si non connecté)
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/dashboard');
}
