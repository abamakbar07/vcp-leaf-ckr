-- 1. Application Users Table
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Administrator', 'Admin', 'Management', 'Checker', 'FD')),
  is_super_user BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT NOT NULL,
  must_change_pin BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  last_login_at TIMESTAMPTZ NULL,
  last_login_ip TEXT NULL,
  pin_changed_at TIMESTAMPTZ NULL,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_user_id_lower
  ON public.app_users (LOWER(user_id));

-- 2. Server-Side Sessions Table (stores SHA-256 hash of session cookie)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_uuid ON public.user_sessions(user_uuid);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions(expires_at);

-- 3. Security & Administrative Audit Logs
CREATE TABLE IF NOT EXISTS public.auth_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT NULL,
  target_user_id TEXT NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON public.auth_audit_logs(created_at DESC);

-- 4. System Security Configuration (Administrator Level 1 only)
CREATE TABLE IF NOT EXISTS public.app_security_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_security_settings (key, value)
VALUES
  ('max_failed_attempts', '5'::jsonb),
  ('lockout_minutes', '15'::jsonb),
  ('session_ttl_hours', '12'::jsonb),
  ('enforce_first_login_pin_change', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5. Updated-at Trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON public.app_users;
CREATE TRIGGER trg_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Strict Row Level Security (Block all direct client/anon access)
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_security_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.auth_audit_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_security_settings FROM anon, authenticated;