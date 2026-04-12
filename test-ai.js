import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf-8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const check = async () => {
  console.log('API Key available:', !!process.env.VITE_OPENAI_API_KEY);
  
  // Check Supabase
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.from('stock_profiles').select('kid_description').eq('stock_code', '8046').maybeSingle();
  console.log('Supabase check for 8046:', { data, error });
  
  if (data) {
     console.log('8046 Content:', data.kid_description);
  }
};
check();
