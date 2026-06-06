import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type CreateChildBody = {
  email?: string;
  password?: string;
  displayName?: string;
  avatar?: string;
  initialBalance?: number;
};

type UserRow = {
  id: string;
  email: string;
  role: 'parent' | 'child';
  tier: 'free' | 'premium';
  is_admin: boolean;
  subscription_expires_at: string | null;
  broker_fee_rate?: number | null;
  broker_min_fee?: number | null;
  broker_tax_rate?: number | null;
  stop_loss_alert_pct?: number | null;
};

type AuthUser = {
  id: string;
  email?: string;
};

const DEFAULT_FREE_MAX_CHILD_ACCOUNTS = 2;

function getAdminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase server configuration');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readBody(req: VercelRequest): Promise<CreateChildBody> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as CreateChildBody;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  return raw.trim() ? JSON.parse(raw) as CreateChildBody : {};
}

async function findAuthUserByEmail(
  supabase: ReturnType<typeof getAdminClient>,
  email: string
) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data.users as AuthUser[];
    const found = users.find(user => user.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 1000) break;
  }
  return null;
}

function isPremium(parent: UserRow): boolean {
  if (parent.is_admin) return true;
  if (parent.tier !== 'premium') return false;
  if (!parent.subscription_expires_at) return true;
  return new Date(parent.subscription_expires_at) > new Date();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: '請先登入主帳號' });
  }

  try {
    const supabase = getAdminClient();
    const body = await readBody(req);
    const email = body.email?.trim().toLowerCase();
    const password = body.password || '';
    const displayName = body.displayName?.trim();
    const avatar = body.avatar || '🐼';
    const initialBalance = Number(body.initialBalance) || 0;

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: '請填寫 Email、密碼與暱稱' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密碼至少需要 6 個字元' });
    }
    if (initialBalance < 0) {
      return res.status(400).json({ error: '初始零用錢不能小於 0' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(401).json({ error: '登入狀態已失效，請重新登入' });
    }

    const { data: parent, error: parentError } = await supabase
      .from('users')
      .select('id,email,role,tier,is_admin,subscription_expires_at,broker_fee_rate,broker_min_fee,broker_tax_rate,stop_loss_alert_pct')
      .eq('id', authData.user.id)
      .maybeSingle<UserRow>();

    if (parentError) return res.status(500).json({ error: parentError.message });
    if (!parent || parent.role !== 'parent') {
      return res.status(403).json({ error: '只有主帳號可以建立副帳號' });
    }

    const { count: childCount, error: countError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent.id);
    if (countError) return res.status(500).json({ error: countError.message });

    const { data: maxSetting } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'free_max_child_accounts')
      .maybeSingle();

    const freeMax = Number(maxSetting?.setting_value) || DEFAULT_FREE_MAX_CHILD_ACCOUNTS;
    if (!isPremium(parent) && (childCount || 0) >= freeMax) {
      return res.status(403).json({
        error: `免費帳號最多只能建立 ${freeMax} 個副帳號！\n升級 Premium 可解鎖更多副帳號 💎`,
      });
    }

    const existingAuthUser = await findAuthUserByEmail(supabase, email);
    if (existingAuthUser) {
      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('users')
        .select('id,email,role,parent_id')
        .eq('id', existingAuthUser.id)
        .maybeSingle();

      if (existingProfileError) {
        return res.status(500).json({ error: existingProfileError.message });
      }

      if (existingProfile) {
        if (existingProfile.role === 'child' && existingProfile.parent_id === parent.id) {
          return res.status(200).json({ repaired: false, alreadyLinked: true });
        }
        return res.status(409).json({ error: '此 Email 已經被其他帳號使用了' });
      }

      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        { password, email_confirm: true }
      );
      if (updateAuthError) {
        return res.status(500).json({ error: updateAuthError.message });
      }

      const { error: repairError } = await supabase.from('users').insert([{
        id: existingAuthUser.id,
        email,
        display_name: displayName,
        avatar,
        role: 'child',
        parent_id: parent.id,
        available_balance: initialBalance,
        initial_balance: initialBalance,
        broker_fee_rate: parent.broker_fee_rate ?? 0.001425,
        broker_min_fee: parent.broker_min_fee ?? 20,
        broker_tax_rate: parent.broker_tax_rate ?? 0.003,
        stop_loss_alert_pct: parent.stop_loss_alert_pct ?? 20,
      }]);
      if (repairError) return res.status(500).json({ error: repairError.message });
      return res.status(200).json({ repaired: true });
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return res.status(400).json({ error: createError?.message || '無法建立副帳號' });
    }

    const { error: insertError } = await supabase.from('users').insert([{
      id: created.user.id,
      email,
      display_name: displayName,
      avatar,
      role: 'child',
      parent_id: parent.id,
      available_balance: initialBalance,
      initial_balance: initialBalance,
      broker_fee_rate: parent.broker_fee_rate ?? 0.001425,
      broker_min_fee: parent.broker_min_fee ?? 20,
      broker_tax_rate: parent.broker_tax_rate ?? 0.003,
      stop_loss_alert_pct: parent.stop_loss_alert_pct ?? 20,
    }]);

    if (insertError) {
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => undefined);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(200).json({ repaired: false });
  } catch (error) {
    console.error('create-child-account error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '建立副帳號失敗',
    });
  }
}
