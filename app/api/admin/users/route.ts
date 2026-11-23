import { NextResponse } from 'next/server';
import { requireApiAuth, logAuditEvent } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateSecurePin } from '@/lib/auth/crypto';
import { canManageTargetUser, UserRole } from '@/lib/auth/rbac';

// export const runtime = 'nodejs';

const VALID_ROLES: UserRole[] = ['Administrator', 'Admin', 'Management', 'Checker', 'FD'];

export async function GET() {
  const auth = await requireApiAuth('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Never select pin_hash
  const { data: users, error } = await supabaseAdmin
    .from('app_users')
    .select(
      'id, user_id, full_name, role, is_super_user, must_change_pin, is_active, failed_attempts, locked_until, last_login_at, created_at'
    )
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load users.' }, { status: 500 });
  }

  const { data: auditLogs } = await supabaseAdmin
    .from('auth_audit_logs')
    .select('id, actor_user_id, target_user_id, event_type, details, ip_address, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ users: users ?? [], auditLogs: auditLogs ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth('admin');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const userId = String(body.user_id || '').trim();
  const fullName = String(body.full_name || '').trim();
  const role = String(body.role || '') as UserRole;

  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(userId)) {
    return NextResponse.json(
      { error: 'User ID must be 2–32 alphanumeric characters (letters, numbers, ., _, -).' },
      { status: 400 }
    );
  }
  if (fullName.length < 2 || fullName.length > 80) {
    return NextResponse.json({ error: 'Full Name must be 2–80 characters.' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 });
  }

  const perm = canManageTargetUser(auth.user, { user_id: userId, role }, role);
  if (!perm.allowed) {
    return NextResponse.json({ error: perm.reason }, { status: 403 });
  }

  const { data: existing } = await supabaseAdmin
    .from('app_users')
    .select('id')
    .ilike('user_id', userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: `User ID "${userId}" already exists.` }, { status: 409 });
  }

  const initialPin = generateSecurePin();

  const { data: created, error } = await supabaseAdmin
    .from('app_users')
    .insert({
      user_id: userId,
      full_name: fullName,
      role,
      pin: initialPin,
      must_change_pin: true,
      is_active: true,
      created_by: auth.user.user_id,
    })
    .select('id, user_id, full_name, role, must_change_pin, is_active, created_at')
    .single();

  if (error || !created) {
    return NextResponse.json({ error: 'Failed to create user.' }, { status: 500 });
  }

  await logAuditEvent({
    actorUserId: auth.user.user_id,
    targetUserId: created.user_id,
    eventType: 'USER_CREATED',
    details: { role: created.role, full_name: created.full_name },
  });

  // Return initialPin ONCE for secure administrator distribution
  return NextResponse.json({
    user: created,
    oneTimePin: initialPin,
  });
}