import { NextResponse } from 'next/server';
import { requireApiAuth, logAuditEvent, revokeAllUserSessions } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateSecurePin, hashPin } from '@/lib/auth/crypto';
import { canManageTargetUser, UserRole } from '@/lib/auth/rbac';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const body = await request.json();

  const { data: target } = await supabaseAdmin
    .from('app_users')
    .select('id, user_id, full_name, role, is_super_user, is_active')
    .eq('id', id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
  }

  const requestedRole = body.role as UserRole | undefined;
  const perm = canManageTargetUser(auth.user, target, requestedRole);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.reason }, { status: 403 });
  }

  // Action A: Reset PIN (generates CSPRNG PIN, invalidates active sessions, enforces first-login change)
  if (body.action === 'reset_pin') {
    const newPin = generateSecurePin();
    const newHash = await hashPin(newPin);

    await supabaseAdmin
      .from('app_users')
      .update({
        pin_hash: newHash,
        must_change_pin: true,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('id', target.id);

    await revokeAllUserSessions(target.id);

    await logAuditEvent({
      actorUserId: auth.user.user_id,
      targetUserId: target.user_id,
      eventType: 'PIN_RESET',
      details: { sessions_revoked: true },
    });

    return NextResponse.json({
      user_id: target.user_id,
      full_name: target.full_name,
      oneTimePin: newPin,
    });
  }

  // Action B: Update User Details / Role / Active Status
  const updates: Record<string, unknown> = {};

  if (typeof body.full_name === 'string' && body.full_name.trim().length >= 2) {
    updates.full_name = body.full_name.trim();
  }

  if (requestedRole && requestedRole !== target.role) {
    updates.role = requestedRole;
  }

  if (typeof body.is_active === 'boolean' && body.is_active !== target.is_active) {
    // Safeguard: never deactivate the last remaining Administrator
    if (!body.is_active && target.role === 'Administrator') {
      const { count } = await supabaseAdmin
        .from('app_users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'Administrator')
        .eq('is_active', true);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot deactivate the last active Administrator account.' },
          { status: 400 }
        );
      }
    }
    updates.is_active = body.is_active;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid changes provided.' }, { status: 400 });
  }

  await supabaseAdmin.from('app_users').update(updates).eq('id', target.id);

  // Immediately revoke sessions if deactivated or role changed
  if (updates.is_active === false || updates.role) {
    await revokeAllUserSessions(target.id);
  }

  await logAuditEvent({
    actorUserId: auth.user.user_id,
    targetUserId: target.user_id,
    eventType: updates.role ? 'ROLE_CHANGED' : 'USER_UPDATED',
    details: updates,
  });

  return NextResponse.json({ ok: true });
}