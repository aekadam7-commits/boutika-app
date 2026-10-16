// يجهّز desktop/ للبناء: ينسخ الواجهة والسيرفر داخله (يُشغَّل من CI أو يدويًا)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'desktop');
const rm = p => fs.rmSync(p, { recursive: true, force: true });
const cp = (a, b) => fs.cpSync(a, b, { recursive: true, filter: s => !/node_modules|[\\/]data([\\/]|$)/.test(s) });

rm(path.join(out, 'www')); rm(path.join(out, 'boutika-server'));
cp(path.join(root, 'www'), path.join(out, 'www'));
fs.mkdirSync(path.join(out, 'boutika-server'), { recursive: true });
cp(path.join(root, 'boutika-server', 'src'), path.join(out, 'boutika-server', 'src'));
fs.copyFileSync(path.join(root, 'boutika-server', 'package.json'), path.join(out, 'boutika-server', 'package.json'));
console.log('✅ desktop جاهز للبناء');
