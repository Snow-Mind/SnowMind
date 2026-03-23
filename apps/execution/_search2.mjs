import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function searchDir(dir, pattern) {
  try {
    const files = readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const p = join(dir, f.name);
      if (f.isDirectory() && !f.name.includes('node_modules')) {
        searchDir(p, pattern);
      } else if (f.name.includes('PluginsEnable') && f.name.endsWith('.js')) {
        console.log('=== ' + p + ' ===');
        const content = readFileSync(p, 'utf8');
        console.log(content);
        console.log('---END---');
      }
    }
  } catch(e) {}
}

searchDir('node_modules/@zerodev/sdk/_cjs/accounts', 'PluginsEnableTypedData');
