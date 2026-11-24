import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyPin, isValidPinFormat } from '@/lib/auth/crypto';
import { createUserSession, getRequestMetadata, logAuditEvent } from '@/lib/auth/session';
import { ROLE_DEFAULT_HOME, UserRole } from '@/lib/auth/rbac';

// export const runtime = 'nodejs';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawUserId = String(body?.userId || '').trim();
    const pin = String(body?.pin || '').trim();
    const meta = await getRequestMetadata();

    if (!rawUserId || !isValidPinFormat(pin)) {
      return NextResponse.json(
        { error: 'Please enter a valid User ID and 6-digit numeric PIN.' },
        { status: 400 }
      );
    }

    const { data: user } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .ilike('user_id', rawUserId)
      .maybeSingle();

    if (!user) {
      verifyPin(pin, null);
      await logAuditEvent({
        actorUserId: rawUserId,
        eventType: 'LOGIN_FAILED',
        details: { reason: 'unknown_user_id' },
        ...meta,
      });
      return NextResponse.json({ error: 'Invalid User ID or PIN.' }, { status: 401 });
    }

    if (!user.is_active) {
      await logAuditEvent({
        actorUserId: user.user_id,
        eventType: 'LOGIN_FAILED',
        details: { reason: 'account_inactive' },
        ...meta,
      });
      return NextResponse.json(
        { error: 'This account has been deactivated. Contact an Administrator.' },
        { status: 403 }
      );
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMs = new Date(user.locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return NextResponse.json(
        {
          error: `Account temporarily locked due to repeated failed attempts. Try again in ${remainingMin} minute(s).`,
        },
        { status: 429 }
      );
    }

    const isValid = verifyPin(pin, user.pin);

    if (!isValid) {
      const nextAttempts = (user.failed_attempts || 0) + 1;
      const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;

      await supabaseAdmin
        .from('app_users')
        .update({
          failed_attempts: nextAttempts,
          locked_until: lockedUntil,
        })
        .eq('id', user.id);

      await logAuditEvent({
        actorUserId: user.user_id,
        eventType: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        details: { failed_attempts: nextAttempts, locked: shouldLock },
        ...meta,
      });

      if (shouldLock) {
        return NextResponse.json(
          {
            error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
          },
          { status: 429 }
        );
      }

      return NextResponse.json({ error: 'Invalid User ID or PIN.' }, { status: 401 });
    }

    await supabaseAdmin
      .from('app_users')
      .update({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
        last_login_ip: meta.ip,
      })
      .eq('id', user.id);

    await createUserSession(user.id);

    await logAuditEvent({
      actorUserId: user.user_id,
      eventType: 'LOGIN_SUCCESS',
      details: { role: user.role, must_change_pin: user.must_change_pin },
      ...meta,
    });

    const role = user.role as UserRole;
    const redirectTo = user.must_change_pin
      ? '/login?mode=change-pin'
      : ROLE_DEFAULT_HOME[role] || '/';

    return NextResponse.json({
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        role: user.role,
        must_change_pin: user.must_change_pin,
      },
      redirectTo,
    });
  } catch {
    return NextResponse.json({ error: 'Authentication service error.' }, { status: 500 });
  }
}