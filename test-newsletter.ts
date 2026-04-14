import handler from './api/cron-newsletter.ts';
import fs from 'fs';

const req = {
  headers: {
    authorization: `Bearer ${process.env.CRON_SECRET}`
  },
  query: {
    force: 'true'
  }
};

const res = {
  status: (code) => {
    console.log('Status code:', code);
    return {
      json: (data) => console.log('Response JSON:', data)
    };
  }
};

// 由於我們要攔截寄出的 HTML 並存檔，我們可以稍微改寫這個測試腳本的行為
// 其實直接修改剛剛寫好的 handler 中的 resend 是一件麻煩事
// 沒關係，我們會讓它真實的寄送，但在寄送前如果能印出 HTML 就好
// 不過在測試環境我們沒有 RESEND API KEY (只有正式機有)
// 所以我只需要讓 cron-newsletter 的 sendError 被 catch，然後我可以在那裡 mock。

console.log('Running test-newsletter...');
handler(req as any, res as any).then(() => {
  console.log('Finished testing');
}).catch(console.error);
