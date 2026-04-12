import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf-8');
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

// Mock vite environment structure
global.import = { meta: { env: process.env } };

import { getOrGenerateKidFriendlyDesc } from './src/api.js';

const run = async () => {
    // 8046 南電, 全球主要高階..., 電子零組件
    console.log('Testing 8046...');
    const result = await getOrGenerateKidFriendlyDesc('8046', '南電', '全球主要高階IC載板製造商', '電子零組件', (text) => {
       console.log('chunk:', text);
    });
    console.log('Result:', result);
};
run();
