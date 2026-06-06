import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONEYDJ_CACHE_VERSION = new Date('2026-06-03T12:20:00+08:00').getTime();
const MONEYDJ_BASE = 'https://www.moneydj.com';

type MoneyDjProfile = {
  sourceUrl: string;
  title: string;
  facts: string;
};

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h1|h2|h3|td|th)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

function toMoneyDjUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${MONEYDJ_BASE}${pathOrUrl}`;
  return `${MONEYDJ_BASE}/KMDJ/Wiki/${pathOrUrl}`;
}

function makeTitleCandidates(name: string): string[] {
  const cleanName = normalizeSpace(name).replace(/\s*\(.+?\)\s*/g, '');
  const candidates = [
    cleanName,
    `${cleanName}科技股份有限公司`,
    `${cleanName}股份有限公司`,
    `${cleanName}電子股份有限公司`,
    `${cleanName}工業股份有限公司`,
    `${cleanName}電機股份有限公司`,
  ];
  return [...new Set(candidates.filter(title => title.length >= 2))];
}

function extractReferenceUrl(html: string): string | null {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, labelHtml] of links) {
    const label = normalizeSpace(stripHtml(labelHtml));
    if (href.toLowerCase().includes('wikiviewer.aspx') && label.includes('股份有限公司')) {
      return toMoneyDjUrl(href);
    }
  }
  return null;
}

function extractTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return normalizeSpace(stripHtml(h1));
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return normalizeSpace(stripHtml(title).replace('- MoneyDJ理財網', ''));
}

function extractMoneyDjFacts(html: string): string {
  const text = normalizeSpace(stripHtml(html));
  const startMarks = ['(一) 公司簡介', '公司簡介'];
  let start = -1;
  for (const mark of startMarks) {
    start = text.indexOf(mark);
    if (start >= 0) break;
  }
  if (start < 0) return '';

  const endMarks = ['推薦新聞', '分類主題', '本文由', '本刊內容僅供參考'];
  let end = text.length;
  for (const mark of endMarks) {
    const idx = text.indexOf(mark, start + 20);
    if (idx >= 0) end = Math.min(end, idx);
  }

  return text
    .slice(start, end)
    .replace(/圖片來源：[^ ]+/g, ' ')
    .replace(/資料來源：[^ ]+/g, ' ')
    .slice(0, 5200)
    .trim();
}

function hasUsableMoneyDjFacts(profile: MoneyDjProfile, name: string): boolean {
  const facts = profile.facts;
  return facts.length > 180 && facts.includes(name.slice(0, 2)) && (
    facts.includes('主要產品') ||
    facts.includes('營業項目') ||
    facts.includes('產品與技術') ||
    facts.includes('產品營收') ||
    facts.includes('主要業務')
  );
}

async function fetchMoneyDjHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 PPBearsInvestment/1.0',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (err) {
    console.warn('MoneyDJ fetch error:', err);
    return null;
  }
}

async function fetchMoneyDjProfile(name: string): Promise<MoneyDjProfile | null> {
  const tried = new Set<string>();

  for (const title of makeTitleCandidates(name)) {
    const url = `${MONEYDJ_BASE}/KMDJ/Wiki/WikiViewer.aspx?Title=${encodeURIComponent(title)}`;
    if (tried.has(url)) continue;
    tried.add(url);

    const html = await fetchMoneyDjHtml(url);
    if (!html) continue;

    const referenceUrl = extractReferenceUrl(html);
    const finalUrl = referenceUrl && !tried.has(referenceUrl) ? referenceUrl : url;
    const finalHtml = referenceUrl ? await fetchMoneyDjHtml(referenceUrl) : html;
    if (!finalHtml) continue;

    const profile = {
      sourceUrl: finalUrl,
      title: extractTitle(finalHtml),
      facts: extractMoneyDjFacts(finalHtml),
    };

    if (hasUsableMoneyDjFacts(profile, name)) return profile;
  }

  return null;
}

function sourceKeywords(...parts: Array<string | undefined | null>): string[] {
  const text = normalizeSpace(parts.filter(Boolean).join(' '));
  const rawTokens = text
    .split(/[\s,，、;；/／｜|()（）:：]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
  const important = [
    '電源管理', '功率元件', '功率半導體', 'Power MOSFET', 'MOSFET',
    '類比IC', 'IC設計', '分離式元件', '電晶體', '控制IC',
    '半導體', '晶片', '封裝', '被動元件', '濾波器', '電感', '電容',
    '記憶體', '伺服器', '資料中心', '網通', '光通訊', '面板',
    '金融', '銀行', '保險', '航運', '鋼鐵', '水泥', '食品', '電信',
  ].filter(keyword => text.includes(keyword));
  return [...new Set([...important, ...rawTokens])]
    .filter(token => !['公司', '台灣', '股份有限公司', '電子', '科技', '主要產品', '主要業務'].includes(token));
}

function descriptionMatchesSource(description: string, name: string, status?: string, industry?: string, facts?: string): boolean {
  const desc = normalizeSpace(description);
  if (!desc.includes(name) && !desc.includes(name.slice(0, 2))) return false;

  const keywords = sourceKeywords(status, industry, facts);
  if (keywords.length === 0) return true;

  const strongKeywords = keywords.filter(keyword =>
    keyword.length >= 3 ||
    /IC|MOSFET|電源|功率|晶片|半導體|電晶體|濾波器|電感|電容|銀行|保險|航運|鋼鐵|水泥|食品|電信/.test(keyword)
  );
  const candidates = strongKeywords.length > 0 ? strongKeywords : keywords;
  return candidates.some(keyword => desc.includes(keyword));
}

function buildConservativeDescription(code: string, name: string, status?: string, industry?: string): string {
  const profile = normalizeSpace(status || '');
  const category = normalizeSpace(industry || '');
  const sourceText = `${profile} ${category}`;

  if (/電源管理|功率元件|功率半導體|MOSFET|類比IC|分離式元件|電晶體/i.test(sourceText)) {
    return `${code} ${name} 是一間做電源管理與功率元件的半導體公司，產品包含類比 IC、分離式元件與電晶體。它們常用在電腦、手機、車用電子或各種需要穩定供電的設備裡，幫電流轉換、控制和保護電路。`;
  }

  if (category) {
    return `${code} ${name} 是一間和「${category.split(/[,，、]/)[0]}」相關的台灣公司。目前可確認的公開分類是：${category}。PPBear 會用保守方式介紹，避免在公司資料不足時把不是主業的產品講成主業。`;
  }

  if (profile) {
    return `${code} ${name} 是一間台灣公司。目前可確認的公司概況是：${profile}。PPBear 需要更多正式產品資料才能講得更細，所以先保守介紹，不自行猜測主力產品。`;
  }

  return `${code} ${name} 的公司產品資料暫時不足，PPBear 需要更多正式來源才能準確介紹。`;
}

function normalizeDescriptionTerms(description: string): string {
  return description
    .replace(/金氧半場效電晶體/g, '金氧半導體場效電晶體')
    .replace(/功率金氧半場效電晶體/g, '功率金氧半導體場效電晶體')
    .replace(/Power\s*MOSFET/gi, '功率 MOSFET');
}

function shouldTrustCached(description: string, name: string, status?: string, industry?: string, createdAt?: string | null): boolean {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  return Number.isFinite(time)
    && time >= MONEYDJ_CACHE_VERSION
    && descriptionMatchesSource(description, name, status, industry);
}

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
      .select('kid_description, created_at')
      .eq('stock_code', code)
      .maybeSingle();

    if (cached?.kid_description && shouldTrustCached(cached.kid_description, name, status, industry, cached.created_at)) {
      const description = normalizeDescriptionTerms(cached.kid_description);
      return new Response(
        JSON.stringify({ description }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 沒有新版快取 → 優先抓 MoneyDJ 公司百科，讓 AI 只負責轉成小朋友能懂的說法。
    const moneyDjProfile = await fetchMoneyDjProfile(name);

    // 3. MoneyDJ 找不到時，只用確定的產業/概況保守生成，避免 AI 猜錯主業。
    if (!moneyDjProfile) {
      const description = normalizeDescriptionTerms(buildConservativeDescription(code, name, status, industry));
      const { error: upsertErr } = await supabase
        .from('stock_profiles')
        .upsert(
          { stock_code: code, kid_description: description, created_at: new Date().toISOString() },
          { onConflict: 'stock_code' }
        );

      if (upsertErr) {
        console.warn('Cache upsert error (non-fatal):', upsertErr.message);
      }

      return new Response(
        JSON.stringify({ description, source: 'conservative-fallback', sourceUrl: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. 呼叫 GPT-4o：只有 MoneyDJ 有可用公司百科時才讓 AI 改寫。
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
        model: 'gpt-4o-mini',
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
6. 保持活潑生動但直接切入重點，可以適度使用 Emoji 輔助。
7. 如果有 MoneyDJ 公司資料，必須以 MoneyDJ 的產品、營收結構、用途、客戶或應用場景為準；不能只看產業標籤就把小業務寫成主業。
8. 優先說明營收佔比最高、最核心的產品與應用；非主業、新事業或投資項目只能簡短補充，不能放在第一句，也不能讓人誤會那是主業。
9. 如果資料提到營收佔比，必須用它判斷主業。例如某產品佔 90% 以上，就要把它放在最前面。
10. 不要自行發明客戶、規格、產品或市佔率；資料沒有提到就不要寫。`,
          },
          {
            role: 'user',
            content: moneyDjProfile
              ? `公司名稱：${name} (${code})。
MoneyDJ 頁面標題：${moneyDjProfile.title}
MoneyDJ 來源：${moneyDjProfile.sourceUrl}
MoneyDJ 公司資料：
${moneyDjProfile.facts}

補充產業標籤（僅供輔助，不能取代 MoneyDJ 主業描述）：${industry || '不明'}
補充公司概況：${status || '無'}

請根據 MoneyDJ 公司資料，直接介紹這家公司最重要的產品服務與厲害之處，50到180字以內。`
              : `公司名稱：${name} (${code})。所屬產業：${industry || '不明'}。公司概況：${status || '無'}。MoneyDJ 暫時查不到可用公司百科，請保守說明，不要誇大產業標籤。請遵守規則：直接介紹產品服務、舉生活例子、50到200字以內、拒絕任何客套話。`,
          },
        ],
        temperature: moneyDjProfile ? 0.35 : 0.55,
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
    let description: string = openaiData.choices?.[0]?.message?.content?.trim() || '';

    if (!description) {
      return new Response(
        JSON.stringify({ error: 'Empty response from OpenAI' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
      );
    }

    if (!descriptionMatchesSource(description, name, status, industry, moneyDjProfile.facts)) {
      description = buildConservativeDescription(code, name, status, industry);
    }
    description = normalizeDescriptionTerms(description);

    // 5. 存入新版快取（upsert 避免重複 key 錯誤）
    const { error: upsertErr } = await supabase
      .from('stock_profiles')
      .upsert(
        { stock_code: code, kid_description: description, created_at: new Date().toISOString() },
        { onConflict: 'stock_code' }
      );

    if (upsertErr) {
      console.warn('Cache upsert error (non-fatal):', upsertErr.message);
    }

    return new Response(
      JSON.stringify({ description, source: moneyDjProfile ? 'moneydj' : 'fallback', sourceUrl: moneyDjProfile?.sourceUrl || null }),
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
