// Fails the build if the production output could break the strict CSP (default-src 'self') or
// needs the internet: inline <script>/<style>, style="" attributes, data: URLs, external URLs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const problems = [];
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push('index.html has an inline <script>');
if (/<style[\s>]/i.test(html)) problems.push('index.html has a <style> tag');
if (/\sstyle\s*=/i.test(html)) problems.push('index.html has a style="" attribute');

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(html|css|js)$/.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (name.endsWith('.js') && /\beval\(|new Function\(/.test(text))
        problems.push(`${name}: eval/new Function`);
      if (/url\(\s*['"]?data:/i.test(text) || /src=["']data:/i.test(text))
        problems.push(`${name}: data: URL`);
      if (
        /url\(\s*['"]?https?:\/\//i.test(text) ||
        /<(script|link)[^>]+(src|href)=["']https?:\/\//i.test(text)
      ) {
        problems.push(`${name}: external URL`);
      }
    }
  }
}
walk(dist);
if (problems.length > 0) {
  console.error(`CSP/offline check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('CSP/offline check passed: no inline script/style, no eval, no data: or external URLs.');
