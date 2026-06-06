import type { VercelRequest, VercelResponse } from '@vercel/node';

const SOURCE_URL = 'https://www.macromicro.me/series/23204/taiwan-taiex-maintenance-margin';
const UNAVAILABLE_MARGIN = {
  date: null,
  rate: null,
  source: SOURCE_URL,
  available: false,
};

function extractLatestMargin(html: string): { date: string; rate: number } | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  const match = text.match(/(20\d{2}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return { date: match[1], rate: Number(match[2]) };
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        'user-agent': 'PPBears-Investment/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({
        ...UNAVAILABLE_MARGIN,
        error: `source ${response.status}`,
      });
    }
    const latest = extractLatestMargin(await response.text());
    if (!latest) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      return res.status(200).json({
        ...UNAVAILABLE_MARGIN,
        error: 'latest margin maintenance rate not found',
      });
    }
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      ...latest,
      source: SOURCE_URL,
      available: true,
    });
  } catch (error) {
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      ...UNAVAILABLE_MARGIN,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
