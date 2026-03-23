import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function findInDir(dir, search) {
  try {
    const files = readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const p = join(dir, f.name);
      if (f.isDirectory() && !f.name.includes('node_modules')) {
        findInDir(p, search);
      } else if (f.name.endsWith('.js') || f.name.endsWith('.mjs')) {
        const content = readFileSync(p, 'utf8');
        if (content.includes(search)) {
          console.log('=== File:', p, '===');
          const idx = content.indexOf(search);
          const start = Math.max(0, idx - 500);
          const end = Math.min(content.length, idx + 2000);
          console.log(content.slice(start, end));
          console.log('---END---');
        }
      }
    }
  } catch(e) {}
}

findInDir('node_modules/@zerodev/sdk', 'getPluginEnableSignature');
