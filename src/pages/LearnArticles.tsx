import { useState } from 'react';
import './LearnArticles.css';

interface LearnCard {
  id: string;
  emoji: string;
  title: string;
  summary: string;
  difficulty: '入門' | '初級' | '進階';
  content: string;
}

const LEARN_CARDS: LearnCard[] = [
  {
    id: '1',
    emoji: '📈',
    title: '什麼是股票？',
    summary: '買股票就像成為一間公司的小老闆！',
    difficulty: '入門',
    content: `想像你最喜歡的飲料店，如果你能成為這間店的「小老闆」，當這間店賺錢的時候，你也能分到一些錢，那不是很棒嗎？

股票就是這樣的概念！當你買了一間公司的「股票」，你就成為了這間公司的「小股東」（小老闆的意思）。

🏪 舉個例子：
假設台積電（就是做手機和電腦裡面「大腦」的公司）一共分成了 1000 個小份量（股票），你買了 1 個份量，你就擁有了台積電的千分之一！

當台積電賣出很多晶片賺了錢，他們可能就會分紅利給你～這就叫做「股利」！

💡 記住：
• 股票 = 公司的一小份所有權
• 買股票 = 成為公司的小股東
• 公司賺錢 → 你可能也能分到錢（股利）
• 股價會上下變動，所以投資有風險喔！`
  },
  {
    id: '2',
    emoji: '💰',
    title: '什麼是股利？',
    summary: '公司賺錢分紅給你，像收到紅包一樣！',
    difficulty: '入門',
    content: `還記得過年的時候會收到紅包嗎？股利就像是公司給你的「紅包」！🧧

當一間公司去年賺了很多錢，他們可能會決定：「把一部分錢分給股東們吧！」這些分的錢就叫做「股利」。

📦 股利有兩種：
1. 💵 現金股利：直接給你現金！就像收到紅包一樣。
2. 🔄 股票股利：不是給現金，而是多給你幾股股票，就像你的股票寶寶又生了小寶寶！

🎯 舉個例子：
如果你有 100 股的中華電（打電話和上網的公司），它宣布每股配 5 元現金股利，你就能收到 100 × 5 = 500 元！

💡 小提醒：
• 不是每間公司都會發股利
• 有些公司會把錢留下來做更多投資
• 殖利率 = 股利 ÷ 股價，越高表示「紅包」越大方！`
  },
  {
    id: '3',
    emoji: '🔢',
    title: '什麼是本益比？',
    summary: '幫你判斷股票值不值得買的工具！',
    difficulty: '初級',
    content: `你去買東西的時候，會不會看看價格覺得「這個值不值得買」呢？本益比就是幫你判斷股票值不值得的工具！

📐 本益比 = 股價 ÷ 每股盈餘（公司每年賺的錢）

簡單來說，本益比告訴你：「如果公司每年賺的錢都不變，你要幾年才能把投資的錢賺回來？」

🍎 舉個例子：
一顆蘋果如果要 15 年的零用錢才買得起 vs 25 年的零用錢才買得起，你會選哪個？
→ 當然是 15 年的比較划算啊！

💡 一般來說：
• 本益比 < 15：比較「便宜」，可能是好機會 🤑
• 本益比 15-25：「合理」的價格 😊
• 本益比 > 25：比較「貴」，要想清楚再買 🤔

⚠️ 但是要注意！
有些成長很快的公司（像科技公司）本益比會比較高，不代表一定是壞事。就像潛力很大的球員，轉會費也會比較高！`
  },
  {
    id: '4',
    emoji: '📊',
    title: '什麼是殖利率？',
    summary: '每年能拿回多少零用錢的比率！',
    difficulty: '初級',
    content: `如果你把 100 元放進銀行，一年後銀行給你 2 元利息，這個利率就是 2%。殖利率的概念差不多！

💸 殖利率 = 每股股利 ÷ 股價 × 100%

它告訴你：「投資這支股票，每年大概能拿回多少比率的股利？」

🎯 舉個例子：
- 股價 100 元的股票，每年配 5 元股利
- 殖利率 = 5 ÷ 100 = 5%
- 意思是你投資 100 元，每年能拿回 5 元！

💡 一般來說：
• 殖利率 > 5%：很不錯！紅包很大方 🎁
• 殖利率 3-5%：還可以 😊
• 殖利率 < 3%：紅包比較小，但公司可能在拼成長

📌 小知識：
台灣很多「定存股」（適合長期持有的股票）殖利率都在 4-6% 左右，比銀行的定存利率高很多喔！`
  },
  {
    id: '5',
    emoji: '🕵️',
    title: '外資和投信是什麼？',
    summary: '投資世界的「大人們」，跟著聰明錢走！',
    difficulty: '進階',
    content: `在投資的世界裡，也有「大人」和「小孩」的分別！

🌍 外資（外國投資人）：
就像是「國外的投資大人」。他們管理的錢非常多（可能是幾千億！），所以他們的買賣會影響股價。

🏢 投信（投信公司）：
就像是「台灣的投資專家」。他們幫很多人管理錢，集合大家的錢一起投資。

🏦 自營商（券商自己的投資部門）：
就像是「證券公司自己也在投資」。

💡 為什麼要看這些？
因為這些「大人們」有專業的分析團隊，他們的買賣動向常常代表一種趨勢。

🐻 PPBear 小技巧：
• 看外資/投信的「成本」：如果他們的成本比現在的股價高，表示他們覺得這支股票值更多錢！
• 如果外資和投信都在買 → 可能是好訊號
• 如果都在賣 → 要小心，他們可能知道什麼`
  },
  {
    id: '6',
    emoji: '📉',
    title: '什麼是技術面？',
    summary: '看股票的成績單，預測未來走勢！',
    difficulty: '進階',
    content: `技術面分析就像是看一個學生「過去的考試成績」，來猜他下次會不會考好。

📊 技術面看什麼？
主要是看股票的「歷史價格走勢」和「成交量」。

🕯️ K線（蠟燭圖）：
每天的股價就像一根蠟燭：
• 紅色蠟燭 = 今天漲了（開心！）
• 綠色蠟燭 = 今天跌了（加油！）
• 蠟燭的長短 = 漲跌的幅度

📈 趨勢：
• 上升趨勢 = 一山比一山高（像爬樓梯往上）
• 下降趨勢 = 一山比一山低（像溜滑梯往下）
• 盤整 = 在差不多的範圍來來去去

💡 記住：
• 技術面只是參考，不是一定準
• 過去的表現不代表未來
• 要和基本面一起看才更完整！`
  },
];

export default function LearnArticles() {
  const [selectedCard, setSelectedCard] = useState<LearnCard | null>(null);

  const difficultyColor = (d: string) => {
    switch (d) {
      case '入門': return 'badge-buy';
      case '初級': return 'badge-hold';
      case '進階': return 'badge-sell';
      default: return 'badge-neutral';
    }
  };

  return (
    <div className="learn">
      <div className="page-header">
        <h1 className="page-title">📚 投資小百科</h1>
      </div>

      {/* PPBear 介紹 */}
      <div className="learn-intro card">
        <img src="/ppbear.png" alt="PPBear" className="learn-bear animate-float" />
        <div className="learn-intro-text">
          <div className="learn-intro-title">PPBear 教你投資！</div>
          <div className="learn-intro-desc">
            跟著小熊一起學習投資的基礎知識吧！從最簡單的開始，慢慢變成投資小達人 🌟
          </div>
        </div>
      </div>

      {/* 學習進度 */}
      <div className="learn-progress">
        <span className="learn-progress-label">🎯 學習進度</span>
        <span className="learn-progress-count">共 {LEARN_CARDS.length} 堂課</span>
      </div>

      {/* 課程列表 */}
      <div className="learn-list">
        {LEARN_CARDS.map((card, index) => (
          <div
            key={card.id}
            className="learn-card"
            onClick={() => setSelectedCard(card)}
          >
            <div className="learn-card-number">{index + 1}</div>
            <div className="learn-card-emoji">{card.emoji}</div>
            <div className="learn-card-info">
              <div className="learn-card-title">{card.title}</div>
              <div className="learn-card-summary">{card.summary}</div>
              <span className={`badge ${difficultyColor(card.difficulty)}`}>
                {card.difficulty}
              </span>
            </div>
            <div className="learn-card-arrow">→</div>
          </div>
        ))}
      </div>

      {/* 課程內容 Modal */}
      {selectedCard && (
        <div className="modal-overlay" onClick={() => setSelectedCard(null)}>
          <div className="modal-content learn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <div className="learn-modal-header">
              <span className="learn-modal-emoji">{selectedCard.emoji}</span>
              <h2 className="learn-modal-title">{selectedCard.title}</h2>
              <span className={`badge ${difficultyColor(selectedCard.difficulty)}`}>
                {selectedCard.difficulty}
              </span>
            </div>
            <div className="learn-modal-content">
              {selectedCard.content.split('\n\n').map((paragraph, i) => (
                <p key={i} className="learn-paragraph">{paragraph}</p>
              ))}
            </div>
            <button className="btn btn-primary btn-block" onClick={() => setSelectedCard(null)}>
              我學會了！ 🎉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
