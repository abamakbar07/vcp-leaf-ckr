export type UserRole = 'Administrator' | 'Admin' | 'Management' | 'Checker' | 'FD';

export interface AuthenticatedUser {
  id: string;
  user_id: string;
  full_name: string;
  role: UserRole;
  is_super_user: boolean;
  must_change_pin: boolean;
  is_active: boolean;
  last_login_at: string | null;
}

export const ROLE_LEVEL: Record<UserRole, number> = {
  Administrator: 1,
  Admin: 2,
  Management: 3,
  Checker: 4,
  FD: 5,
};

export const ROLE_DEFAULT_HOME: Record<UserRole, string> = {
  Administrator: '/admin',
  Admin: '/dashboard',
  Management: '/dashboard',
  Checker: '/scanner',
  FD: '/scanner',
};

export type AppModule = 'operational' | 'dashboard' | 'admin' | 'hioki' | 'profile';

const MODULE_PERMISSIONS: Record<AppModule, UserRole[]> = {
  hioki: ['Administrator', 'Admin', 'Management', 'Checker', 'FD'],
  profile: ['Administrator', 'Admin', 'Management', 'Checker', 'FD'],
  dashboard: ['Administrator', 'Admin', 'Management', 'Checker', 'FD'],
  operational: ['Administrator', 'Admin', 'Checker', 'FD'],
  admin: ['Administrator', 'Admin'],
};

export function canAccessModule(role: UserRole, module: AppModule): boolean {
  return MODULE_PERMISSIONS[module].includes(role);
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (pathname === '/' || pathname.startsWith('/tools/hioki')) return true;
  if (pathname.startsWith('/profile')) return true;
  if (pathname.startsWith('/dashboard')) return canAccessModule(role, 'dashboard');
  if (pathname.startsWith('/admin')) return canAccessModule(role, 'admin');
  if (
    pathname.startsWith('/inbound') ||
    pathname.startsWith('/inventory') ||
    pathname.startsWith('/loading') ||
    pathname.startsWith('/scanner')
  ) {
    return canAccessModule(role, 'operational');
  }
  return false;
}

/**
 * Enforces Level 1 (Administrator) vs Level 2 (Admin) management boundaries.
 */
export function canManageTargetUser(
  actor: AuthenticatedUser,
  target: { user_id: string; role: UserRole; is_super_user?: boolean },
  requestedNewRole?: UserRole
): { allowed: boolean; reason?: string } {
  if (actor.role !== 'Administrator' && actor.role !== 'Admin') {
    return { allowed: false, reason: 'Insufficient administrative privileges.' };
  }

  // Super User accounts can only be modified by themselves or another Super User
  if (target.is_super_user && !actor.is_super_user) {
    return { allowed: false, reason: 'Super User accounts cannot be modified.' };
  }

  // Level 2 Admin restrictions
  if (actor.role === 'Admin') {
    if (target.role === 'Administrator' || target.role === 'Admin') {
      return {
        allowed: false,
        reason: 'Admin role cannot modify Administrator or peer Admin accounts.',
      };
    }
    if (requestedNewRole === 'Administrator' || requestedNewRole === 'Admin') {
      return {
        allowed: false,
        reason: 'Admin role cannot assign Administrator or Admin privileges.',
      };
    }
    if (actor.user_id.toLowerCase() === target.user_id.toLowerCase() && requestedNewRole) {
      return { allowed: false, reason: 'Self privilege elevation is prohibited.' };
    }
  }

  // Prevent Administrator from accidentally demoting themselves
  if (
    actor.user_id.toLowerCase() === target.user_id.toLowerCase() &&
    requestedNewRole &&
    requestedNewRole !== actor.role
  ) {
    return { allowed: false, reason: 'You cannot modify your own assigned role.' };
  }

  return { allowed: true };
}