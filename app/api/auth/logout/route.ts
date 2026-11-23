import { NextResponse } from 'next/server';
import { destroyCurrentSession, getCurrentUser, logAuditEvent } from '@/lib/auth/session';

// export const runtime = 'nodejs';

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await logAuditEvent({
      actorUserId: user.user_id,
      eventType: 'LOGOUT',
    });
  }
  await destroyCurrentSession();
  return NextResponse.json({ ok: true });
}