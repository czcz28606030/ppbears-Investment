import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ReviewAction = 'approve' | 'reject';

type ReviewBody = {
  type?: 'withdrawal' | 'redemption';
  requestId?: string;
  action?: ReviewAction;
  note?: string;
};

type UserRow = {
  id: string;
  role: 'parent' | 'child';
  available_balance?: number | string;
};

type WithdrawalRow = {
  id: string;
  child_id: string;
  parent_id: string;
  amount: number | string;
  status: 'pending' | 'approved' | 'rejected';
};

type RedemptionRow = {
  id: string;
  child_id: string;
  parent_id: string;
  shop_item_id: string;
  item_name: string;
  cost_coins: number | string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
};

type ShopItemRow = {
  item_type: 'cash' | 'product' | 'experience' | 'invest_bonus';
  cash_value: number | string | null;
};

type WalletRow = {
  balance: number | string;
  frozen: number | string;
  total_spent: number | string;
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

async function readBody(req: VercelRequest): Promise<ReviewBody> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as ReviewBody;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  return raw.trim() ? JSON.parse(raw) as ReviewBody : {};
}

async function loadParent(
  supabase: ReturnType<typeof getAdminClient>,
  token: string,
): Promise<{ parent?: UserRow; status?: number; error?: string }> {
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { status: 401, error: '登入狀態已失效，請重新登入' };
  }

  const { data: parent, error: parentError } = await supabase
    .from('users')
    .select('id,role')
    .eq('id', authData.user.id)
    .maybeSingle<UserRow>();

  if (parentError) return { status: 500, error: parentError.message };
  if (!parent || parent.role !== 'parent') {
    return { status: 403, error: '只有主帳號可以審核' };
  }

  return { parent };
}

async function handleWithdrawal(
  supabase: ReturnType<typeof getAdminClient>,
  parent: UserRow,
  requestId: string,
  action: ReviewAction,
  res: VercelResponse,
) {
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
    .maybeSingle<UserRow>();
  if (childError) return res.status(500).json({ error: childError.message });
  if (!child) return res.status(404).json({ error: '找不到副帳號' });

  const oldBalance = Number(child.available_balance || 0);
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
  if (tradeError) return res.status(500).json({ error: tradeError.message });

  return res.status(200).json({ status: 'approved', balance: newBalance });
}

async function handleRedemption(
  supabase: ReturnType<typeof getAdminClient>,
  parent: UserRow,
  requestId: string,
  action: ReviewAction,
  note: string | null,
  res: VercelResponse,
) {
  const { data: request, error: requestError } = await supabase
    .from('redemption_requests')
    .select('id,child_id,parent_id,shop_item_id,item_name,cost_coins,status')
    .eq('id', requestId)
    .maybeSingle<RedemptionRow>();

  if (requestError) return res.status(500).json({ error: requestError.message });
  if (!request || request.parent_id !== parent.id) {
    return res.status(404).json({ error: '找不到此兌換申請' });
  }
  if (request.status !== 'pending') {
    return res.status(200).json({ status: request.status, alreadyResolved: true });
  }

  const { data: wallet, error: walletError } = await supabase
    .from('learning_wallet')
    .select('balance,frozen,total_spent')
    .eq('user_id', request.child_id)
    .maybeSingle<WalletRow>();

  if (walletError) return res.status(500).json({ error: walletError.message });
  if (!wallet) return res.status(404).json({ error: '找不到學習幣錢包' });

  const costCoins = Number(request.cost_coins);
  const frozen = Number(wallet.frozen);
  if (frozen < costCoins) {
    return res.status(400).json({ error: '凍結學習幣不足，請先檢查此申請狀態' });
  }

  const resolvedAt = new Date().toISOString();

  if (action === 'reject') {
    const { error: walletUpdateError } = await supabase
      .from('learning_wallet')
      .update({
        balance: Number(wallet.balance) + costCoins,
        frozen: frozen - costCoins,
        updated_at: resolvedAt,
      })
      .eq('user_id', request.child_id);
    if (walletUpdateError) return res.status(500).json({ error: walletUpdateError.message });

    const { error: requestUpdateError } = await supabase
      .from('redemption_requests')
      .update({ status: 'rejected', parent_note: note, resolved_at: resolvedAt })
      .eq('id', requestId)
      .eq('status', 'pending');
    if (requestUpdateError) return res.status(500).json({ error: requestUpdateError.message });

    const { error: txError } = await supabase.from('wallet_transactions').insert([{
      user_id: request.child_id,
      amount: costCoins,
      tx_type: 'refund',
      source: requestId,
      description: `退款：${request.item_name}`,
      parent_message: note,
    }]);
    if (txError) return res.status(500).json({ error: txError.message });

    return res.status(200).json({ status: 'rejected' });
  }

  const { data: shopItem, error: shopItemError } = await supabase
    .from('reward_shop_items')
    .select('item_type,cash_value')
    .eq('id', request.shop_item_id)
    .maybeSingle<ShopItemRow>();

  if (shopItemError) return res.status(500).json({ error: shopItemError.message });
  if (!shopItem) return res.status(404).json({ error: '找不到兌換商品設定' });

  const { error: walletUpdateError } = await supabase
    .from('learning_wallet')
    .update({
      frozen: frozen - costCoins,
      total_spent: Number(wallet.total_spent) + costCoins,
      updated_at: resolvedAt,
    })
    .eq('user_id', request.child_id);
  if (walletUpdateError) return res.status(500).json({ error: walletUpdateError.message });

  const { error: requestUpdateError } = await supabase
    .from('redemption_requests')
    .update({ status: 'approved', parent_note: note, resolved_at: resolvedAt })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (requestUpdateError) return res.status(500).json({ error: requestUpdateError.message });

  const { error: txError } = await supabase.from('wallet_transactions').insert([{
    user_id: request.child_id,
    amount: -costCoins,
    tx_type: 'redeem',
    source: requestId,
    description: `兌換：${request.item_name}`,
    parent_message: note,
  }]);
  if (txError) return res.status(500).json({ error: txError.message });

  const cashValue = Number(shopItem.cash_value || 0);
  if ((shopItem.item_type === 'cash' || shopItem.item_type === 'invest_bonus') && cashValue > 0) {
    const { data: child, error: childError } = await supabase
      .from('users')
      .select('id,available_balance')
      .eq('id', request.child_id)
      .maybeSingle<UserRow>();
    if (childError) return res.status(500).json({ error: childError.message });
    if (!child) return res.status(404).json({ error: '找不到副帳號' });

    const newBalance = Number(child.available_balance || 0) + cashValue;
    const { error: balanceError } = await supabase
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', request.child_id);
    if (balanceError) return res.status(500).json({ error: balanceError.message });

    const { error: tradeError } = await supabase.from('trades').insert([{
      user_id: request.child_id,
      stock_code: 'CASH',
      stock_name: shopItem.item_type === 'invest_bonus' ? '學習獎勵投資加碼' : '學習獎勵現金',
      trade_type: 'deposit',
      quantity: 1,
      price: cashValue,
      total_amount: cashValue,
      reason: `學習商城兌換入帳：${request.item_name} (${requestId})`,
      timestamp: Date.now(),
    }]);
    if (tradeError) return res.status(500).json({ error: tradeError.message });

    return res.status(200).json({ status: 'approved', cashValue, balance: newBalance });
  }

  return res.status(200).json({ status: 'approved', cashValue: 0 });
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
      return res.status(400).json({ error: '缺少申請或操作類型' });
    }

    const parentResult = await loadParent(supabase, token);
    if (!parentResult.parent) {
      return res.status(parentResult.status || 500).json({ error: parentResult.error || '審核權限驗證失敗' });
    }

    if (body.type === 'redemption') {
      return handleRedemption(
        supabase,
        parentResult.parent,
        requestId,
        action,
        body.note?.trim() || null,
        res,
      );
    }

    return handleWithdrawal(supabase, parentResult.parent, requestId, action, res);
  } catch (error) {
    console.error('request review error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : '審核失敗',
    });
  }
}
