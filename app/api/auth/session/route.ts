import { NextResponse } from 'next/server';
import { getCurrentUser, logAuditEvent } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isValidPinFormat, isWeakPin, verifyPin } from '@/lib/auth/crypto';

// export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const body = await request.json();

  if (body.action === 'change_pin') {
    const currentPin = String(body.currentPin || '').trim();
    const newPin = String(body.newPin || '').trim();

    if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin)) {
      return NextResponse.json({ error: 'PINs must be exactly 6 numeric digits.' }, { status: 400 });
    }
    if (currentPin === newPin) {
      return NextResponse.json(
        { error: 'New PIN must be different from your current PIN.' },
        { status: 400 }
      );
    }
    if (isWeakPin(newPin)) {
      return NextResponse.json(
        { error: 'Choose a stronger PIN (avoid sequential or repeated digits like 123456 or 111111).' },
        { status: 400 }
      );
    }

    const { data: dbUser } = await supabaseAdmin
      .from('app_users')
      .select('pin')
      .eq('id', user.id)
      .single();

    if (!verifyPin(currentPin, dbUser?.pin ?? null)) {
      return NextResponse.json({ error: 'Current PIN is incorrect.' }, { status: 401 });
    }

    await supabaseAdmin
      .from('app_users')
      .update({
        pin: newPin,
        must_change_pin: false,
        pin_changed_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    await logAuditEvent({
      actorUserId: user.user_id,
      targetUserId: user.user_id,
      eventType: 'PIN_CHANGED',
      details: { forced_initial_change: user.must_change_pin },
    });

    return NextResponse.json({ ok: true });
  }

  if (body.action === 'update_profile') {
    const fullName = String(body.fullName || '').trim();
    if (fullName.length < 2 || fullName.length > 80) {
      return NextResponse.json({ error: 'Full Name must be 2–80 characters.' }, { status: 400 });
    }

    await supabaseAdmin
      .from('app_users')
      .update({ full_name: fullName })
      .eq('id', user.id);

    await logAuditEvent({
      actorUserId: user.user_id,
      targetUserId: user.user_id,
      eventType: 'PROFILE_UPDATED',
      details: { full_name: fullName },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid profile action.' }, { status: 400 });
}