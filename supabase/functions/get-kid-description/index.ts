import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, name, status, industry } = await req.json();

    if (!code || !name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: code, name' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // 使用 service role key 操作資料庫（不受 RLS 限制）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. 先查 Supabase 快取
    const { data: cached } = await supabase
      .from('stock_profiles')
      .select('kid_description')
      .eq('stock_code', code)
      .maybeSingle();

    if (cached?.kid_description) {
      return new Response(
        JSON.stringify({ description: cached.kid_description }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 沒有快取 → 呼叫 GPT-4o
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.error('OPENAI_API_KEY secret is not set');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured on server' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `你是一隻叫 PPBear 的可愛小熊解說員。你的唯一任務是「重點介紹這間公司生產的產品與服務」。

規則（非常重要）：
1. 絕對不能有任何客套話與廢話（禁止使用「嗨大家好」「小朋友們」「快來」「一起學習」「讓未來變得更美好」「PPBear 支持你」等開場或結尾）。
2. 直接破題，必須以「[股票代碼] [公司名稱] 是一間...」做為文章第一句話的開頭（例如：6515 頎岸 是一間...）。
3. 必須使用白話文、用小朋友能輕鬆聽懂的方式說明。
4. 一定要舉出生活中看得到的實體商品或情境當作例子（例如：手機裡的晶片、超商的飲料、平常用的網路...）。
5. 全文字數必須嚴格控制在 50 到 200 字之間。
6. 保持活潑生動但直接切入重點，可以適度使用 Emoji 輔助。`,
          },
          {
            role: 'user',
            content: `公司名稱：${name} (${code})。所屬產業：${industry || '不明'}。公司概況：${status || '無'}。請遵守規則：直接介紹產品服務、舉生活例子、50到200字以內、拒絕任何客套話。`,
          },
        ],
        temperature: 0.75,
        max_tokens: 350,
      }),
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: 'OpenAI API error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
      );
    }

    const openaiData = await openaiResponse.json();
    const description: string = openaiData.choices?.[0]?.message?.content?.trim() || '';

    if (!description) {
      return new Response(
        JSON.stringify({ error: 'Empty response from OpenAI' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
      );
    }

    // 3. 存入快取（upsert 避免重複 key 錯誤）
    const { error: upsertErr } = await supabase
      .from('stock_profiles')
      .upsert({ stock_code: code, kid_description: description }, { onConflict: 'stock_code' });

    if (upsertErr) {
      console.warn('Cache upsert error (non-fatal):', upsertErr.message);
    }

    return new Response(
      JSON.stringify({ description }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
