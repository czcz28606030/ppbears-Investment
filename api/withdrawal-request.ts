import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type WithdrawalAction = 'approve' | 'reject';

type WithdrawalBody = {
  requestId?: string;
  action?: WithdrawalAction;
};

type UserRow = {
  id: string;
  role: 'parent' | 'child';
};

type WithdrawalRow = {
  id: string;
  child_id: string;
  parent_id: string;
  amount: number | string;
  status: 'pending' | 'approved' | 'rejected';
};

type ChildBalanceRow = {
  available_balance: number | string;
};

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

async function readBody(req: VercelRequest): Promise<WithdrawalBody> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as WithdrawalBody;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  return raw.trim() ? JSON.parse(raw) as WithdrawalBody : {};
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
    const requestId = body.requestId?.trim();
    const action = body.action;

    if (!requestId || (action !== 'approve' && action !== 'reject')) {
      return res.status(400).json({ error: '缺少出金申請或操作類型' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(401).json({ error: '登入狀態已失效，請重新登入' });
    }

    const { data: parent, error: parentError } = await supabase
      .from('users')
      .select('id,role')
      .eq('id', authData.user.id)
      .maybeSingle<UserRow>();

    if (parentError) return res.status(500).json({ error: parentError.message });
    if (!parent || parent.role !== 'parent') {
      return res.status(403).json({ error: '只有主帳號可以審核出金' });
    }

    const { data: request, error: requestError } = await supabase
      .from('withdrawal_requests')
      .select('id,child_id,parent_id,amount,status')
      .eq('id', requestId)
      .maybeSingle<WithdrawalRow>();

    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request || request.parent_id !== parent.id) {
      return res.status(404).json({ error: '找不到此出金申請' });
    }
    if (request.status !== 'pending') {
      return res.status(200).json({ status: request.status, alreadyResolved: true });
    }

    const reviewedAt = new Date().toISOString();

    if (action === 'reject') {
      const { error: rejectError } = await supabase
        .from('withdrawal_requests')
        .update({ status: 'rejected', reviewed_at: reviewedAt })
        .eq('id', requestId)
        .eq('status', 'pending');
      if (rejectError) return res.status(500).json({ error: rejectError.message });
      return res.status(200).json({ status: 'rejected' });
    }

    const amount = Number(request.amount);
    const { data: child, error: childError } = await supabase
      .from('users')
      .select('available_balance')
      .eq('id', request.child_id)
      .maybeSingle<ChildBalanceRow>();
    if (childError) return res.status(500).json({ error: childError.message });
    if (!child) return res.status(404).json({ error: '找不到副帳號' });

    const oldBalance = Number(child.available_balance);
    if (oldBalance < amount) {
      return res.status(400).json({ error: '副帳號餘額不足，無法出金' });
    }

    const { error: approveError } = await supabase
      .from('withdrawal_requests')
      .update({ status: 'approved', reviewed_at: reviewedAt })
      .eq('id', requestId)
      .eq('status', 'pending');
    if (approveError) return res.status(500).json({ error: approveError.message });

    const newBalance = oldBalance - amount;
    const { error: balanceError } = await supabase
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', request.child_id);
    if (balanceError) {
      await Promise.resolve(supabase
        .from('withdrawal_requests')
        .update({ status: 'pending', reviewed_at: null })
        .eq('id', requestId))
        .catch(() => undefined);
      return res.status(500).json({ error: balanceError.message });
    }

    const { error: tradeError } = await supabase.from('trades').insert([{
      user_id: request.child_id,
      stock_code: 'WD',
      stock_name: '提款出金',
      trade_type: 'withdraw',
      quantity: 1,
      price: amount,
      total_amount: amount,
      reason: '家長已核准提款',
      timestamp: Date.now(),
    }]);
    if (tradeError) {
      return res.status(500).json({ error: tradeError.message });
    }

    return res.status(200).json({ status: 'approved', balance: newBalance });
  } catch (error) {
    console.error('withdrawal-request error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '出金審核失敗',
    });
  }
}
