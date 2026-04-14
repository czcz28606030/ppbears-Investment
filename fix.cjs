const fs = require('fs');
let c = fs.readFileSync('api/cron-newsletter.ts', 'utf8');
c = c.replace(/\\\'/g, '`');
fs.writeFileSync('api/cron-newsletter.ts', c);

