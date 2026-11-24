import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateSessionToken, hashSessionToken } from './crypto';
import { AuthenticatedUser, canAccessModule, AppModule } from './rbac';

export const SESSION_COOKIE_NAME = 'vcp_session';
const DEFAULT_SESSION_TTL_HOURS = 12;

export async function getRequestMetadata() {
  const hdrs = await headers();
  const forwarded = hdrs.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : hdrs.get('x-real-ip') || 'unknown';
  const userAgent = hdrs.get('user-agent') || 'unknown';
  return { ip, userAgent };
}

export async function logAuditEvent(params: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  eventType: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}) {
  const meta = params.ip ? { ip: params.ip, userAgent: params.userAgent } : await getRequestMetadata();
  await supabaseAdmin.from('auth_audit_logs').insert({
    actor_user_id: params.actorUserId ?? null,
    target_user_id: params.targetUserId ?? null,
    event_type: params.eventType,
    details: params.details ?? {},
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  });
}

export async function createUserSession(userUuid: string) {
  const { rawToken, tokenHash } = generateSessionToken();
  const meta = await getRequestMetadata();
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000);

  const { error } = await supabaseAdmin.from('user_sessions').insert({
    user_uuid: userUuid,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  });

  if (error) throw new Error('Failed to create user session');

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function revokeAllUserSessions(userUuid: string) {
  await supabaseAdmin
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_uuid', userUuid)
    .is('revoked_at', null);
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    await supabaseAdmin
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', tokenHash);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const { data: session } = await supabaseAdmin
    .from('user_sessions')
    .select('id, user_uuid, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) {
    return null;
  }

  const { data: user } = await supabaseAdmin
    .from('app_users')
    .select('id, user_id, full_name, role, is_super_user, must_change_pin, is_active, last_login_at')
    .eq('id', session.user_uuid)
    .maybeSingle();

  if (!user || !user.is_active) {
    return null;
  }

  return user as AuthenticatedUser;
}

export async function requireApiAuth(requiredModule?: AppModule): Promise<
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: 'Authentication required.' };
  }
  if (user.must_change_pin) {
    return { ok: false, status: 403, error: 'Initial PIN change required before accessing modules.' };
  }
  if (requiredModule && !canAccessModule(user.role, requiredModule)) {
    await logAuditEvent({
      actorUserId: user.user_id,
      eventType: 'ACCESS_DENIED',
      details: { requiredModule, role: user.role },
    });
    return { ok: false, status: 403, error: 'Access denied for your assigned role.' };
  }
  return { ok: true, user };
}