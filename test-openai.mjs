import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const check = async () => {
  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `測試`
      }
    ],
    max_tokens: 10
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.VITE_OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Body:', text);
  } catch (err) {
    console.error('Network Error:', err);
  }
};
check();
