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
          role: 'system',
          content: `你是一隻叫 PPBear 的可愛小熊解說員。`
        },
        {
          role: 'user',
          content: `測試`
        }
      ],
      temperature: 0.75,
      max_tokens: 350,
      stream: true
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.VITE_OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        console.error('ERROR:', await response.text());
        return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        console.log('got chunk', done, value?.length);
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (line === '[DONE]' || !line) continue;
          
          try {
            const parsed = JSON.parse(line);
            if (parsed.choices?.[0]?.delta?.content) {
              fullText += parsed.choices[0].delta.content;
            }
          } catch (e) {
             console.log('JSON Parse Error:', line);
          }
        }
      }
    }
    
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      try {
        const parsed = JSON.parse(buffer.replace(/^data: /, '').trim());
        if (parsed.choices?.[0]?.delta?.content) fullText += parsed.choices[0].delta.content;
      } catch(e) {}
    }

    console.log('FullText:', fullText);
};
check();
