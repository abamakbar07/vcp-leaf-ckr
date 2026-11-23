import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { generateSecurePin, hashPin } from '../lib/auth/crypto';
import type { UserRole } from '../lib/auth/rbac';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SeedAccount {
  user_id: string;
  full_name: string;
  role: UserRole;
  is_super_user?: boolean;
}

const PREDEFINED_USERS: SeedAccount[] = [
  // Level 1 — Administrator
  { user_id: 'Admin', full_name: 'Admin', role: 'Administrator' },
  { user_id: 'Akbar', full_name: 'Akbar', role: 'Administrator', is_super_user: true },

  // Level 3 — Management (Dashboard Only)
  { user_id: 'Seno', full_name: 'Seno', role: 'Management' },
  { user_id: 'Sugeng', full_name: 'Sugeng', role: 'Management' },
  { user_id: 'Gultom', full_name: 'Gultom', role: 'Management' },
  { user_id: 'Customer', full_name: 'Customer', role: 'Management' },

  // Level 2 — Admin (Operational + Dashboard + Admin)
  { user_id: 'Denny', full_name: 'Denny', role: 'Admin' },
  { user_id: 'Rama', full_name: 'Rama', role: 'Admin' },
  { user_id: 'Fauji', full_name: 'Fauji', role: 'Admin' },

  // Level 4 — Checker (Operational + Dashboard)
  { user_id: 'Sukarna', full_name: 'Sukarna', role: 'Checker' },
  { user_id: 'Hamid', full_name: 'Hamid', role: 'Checker' },
  { user_id: 'Aris', full_name: 'Aris', role: 'Checker' },
  { user_id: 'Irfan', full_name: 'Irfan', role: 'Checker' },
  { user_id: 'Gozali', full_name: 'Gozali', role: 'Checker' },

  // Level 5 — FD (Operational + Dashboard)
  { user_id: 'Andra', full_name: 'Andra', role: 'FD' },
  { user_id: 'Agus', full_name: 'Agus', role: 'FD' },
  { user_id: 'Shobar', full_name: 'Shobar', role: 'FD' },
  { user_id: 'Syaifur', full_name: 'Syaifur', role: 'FD' },
  { user_id: 'Kemmy', full_name: 'Kemmy', role: 'FD' },
  { user_id: 'Ade', full_name: 'Ade', role: 'FD' },
  { user_id: 'Anan', full_name: 'Anan', role: 'FD' },
  { user_id: 'Aziz', full_name: 'Aziz', role: 'FD' },
  { user_id: 'Triyadi', full_name: 'Triyadi', role: 'FD' },
  { user_id: 'Taher', full_name: 'Taher', role: 'FD' },
  { user_id: 'Maizun', full_name: 'Maizun', role: 'FD' },
  { user_id: 'Yoga', full_name: 'Yoga', role: 'FD' },
];

async function seedUsers() {
  const issuedPins = new Set<string>();
  const credentialSheet: Array<{ user_id: string; full_name: string; role: string; initial_pin: string }> = [];

  for (const acct of PREDEFINED_USERS) {
    const { data: existing } = await supabase
      .from('app_users')
      .select('id')
      .ilike('user_id', acct.user_id)
      .maybeSingle();

    if (existing) {
      console.log(`[SKIP] ${acct.user_id} already exists.`);
      continue;
    }

    const pin = generateSecurePin(issuedPins);
    issuedPins.add(pin);
    const pinHash = await hashPin(pin);

    const { error } = await supabase.from('app_users').insert({
      user_id: acct.user_id,
      full_name: acct.full_name,
      role: acct.role,
      is_super_user: Boolean(acct.is_super_user),
      pin_hash: pinHash,
      must_change_pin: true,
      is_active: true,
      created_by: 'SYSTEM_SEED',
    });

    if (error) {
      console.error(`[ERROR] Failed to seed ${acct.user_id}:`, error.message);
      continue;
    }

    credentialSheet.push({
      user_id: acct.user_id,
      full_name: acct.full_name,
      role: acct.role,
      initial_pin: pin,
    });
  }

  console.log('\n=== ONE-TIME INITIAL CREDENTIALS (DISTRIBUTE INDIVIDUALLY & CLEAR TERMINAL) ===');
  console.table(credentialSheet);
}

seedUsers();