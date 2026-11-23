import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { AppModule, canAccessModule } from '@/lib/auth/rbac';

export async function RoleGuard({
  module,
  children,
}: {
  module: AppModule;
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.must_change_pin) redirect('/login?mode=change-pin');
  if (!canAccessModule(user.role, module)) {
    redirect('/?error=access_denied');
  }
  return <>{children}</>;
}