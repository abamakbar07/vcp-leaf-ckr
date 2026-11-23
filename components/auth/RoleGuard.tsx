import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { AppModule, canAccessModule } from '@/lib/auth/rbac';

async function RoleGuardCheck({
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

export function RoleGuard({
  module,
  children,
}: {
  module: AppModule;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-xs text-slate-500">
          Verifying access permissions...
        </div>
      }
    >
      <RoleGuardCheck module={module}>{children}</RoleGuardCheck>
    </Suspense>
  );
}