// يبني ملف المولّد النهائي (ملف HTML واحد) بدمج مكتبة قراءة QR ومولّد QR
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..', 'www');
let t = fs.readFileSync(path.join(__dirname, 'generator.template.html'), 'utf8');
const lib = fs.readFileSync(path.join(root, 'vendor', 'html5-qrcode.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
let qr = fs.readFileSync(path.join(root, 'js', 'license', 'qr.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
t = t.split('/*__HTML5QRCODE__*/').join(lib).split('/*__BOUTIKQR__*/').join(qr);
fs.writeFileSync(path.join(__dirname, 'boutika-license-generator.html'), t);
console.log('built', (t.length / 1024).toFixed(0) + ' KB');
