import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf-8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const check = async () => {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
  
  const { data: d1 } = await supabase.from('stock_profiles').select('kid_description').eq('stock_code', '3583').maybeSingle();
  console.log('3583:', d1);

  const { data: d2 } = await supabase.from('stock_profiles').select('kid_description').eq('stock_code', '8046').maybeSingle();
  console.log('8046:', d2);
  
  // also get count of all Fallback rows in db
  const { data: all } = await supabase.from('stock_profiles').select('*');
  console.log('Total cached:', all?.length);
  const fallbacks = all?.filter(x => x.kid_description.includes('這是一間') && (x.kid_description.includes('好公司') || x.kid_description.includes('大公司')));
  if (fallbacks && fallbacks.length > 0) {
      console.log('Found fallbacks in DB!', fallbacks);
      // delete them
      for (const f of fallbacks) {
         await supabase.from('stock_profiles').delete().eq('stock_code', f.stock_code);
         console.log('Deleted bad cache for', f.stock_code);
      }
  }
};
check();
