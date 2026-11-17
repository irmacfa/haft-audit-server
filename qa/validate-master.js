// بررسی فایل اکسل مادر قبل از جایگزینی
// اجرا: node qa/validate-master.js "D:\path\to\real-file.xlsx"
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const file = process.argv[2];
if (!file) {
    console.log('استفاده: node qa/validate-master.js "مسیر\\فایل.xlsx"');
    process.exit(1);
}
if (!fs.existsSync(file)) {
    console.log('فایل یافت نشد:', file);
    process.exit(1);
}

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'audit_db.json')));
const s = db.settings || {};
const expected = {
    plant: s.plantColumn || 'پلنت محل تجهیز',
    name: s.nameColumn || 'شرح مرکز هزینه تجهیز',
    material: s.materialColumn || 'شماره متریال تجهیز',
    prefix: s.materialPrefix || '9000'
};

const sizeMB = (fs.statSync(file).size / 1048576).toFixed(1);
console.log('==================================================');
console.log('بررسی فایل مادر:', path.basename(file), `(${sizeMB} MB)`);
console.log('==================================================\n');

let wb;
try { wb = XLSX.readFile(file); }
catch (e) { console.log('❌ خواندن فایل ناموفق:', e.message); process.exit(1); }

console.log('برگهها:', wb.SheetNames.join('، '));
const issues = [];

wb.SheetNames.forEach((name, idx) => {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    const headers = raw[0] || [];
    console.log(`\n[${name}] ردیفها: ${raw.length}، ستونها: ${headers.length}`);
    const found = [expected.plant, expected.name, expected.material].filter(h => headers.includes(h));
    console.log('ستونهای کلیدی یافتشده:', found.length ? found.join('، ') : 'هیچکدام');

    const pIdx = headers.indexOf(expected.plant);
    const mIdx = headers.indexOf(expected.material);
    const nIdx = headers.indexOf(expected.name);
    if (pIdx < 0) issues.push(`ستون کد فروشگاه («${expected.plant}») یافت نشد — باید در تنظیمات مشخص شود`);
    if (mIdx < 0) issues.push(`ستون متریال («${expected.material}») یافت نشد — فیلتر ${expected.prefix} کار نخواهد کرد`);
    if (nIdx < 0) issues.push(`ستون نام فروشگاه («${expected.name}») یافت نشد`);

    if (pIdx >= 0) {
        const plants = new Set();
        for (let i = 1; i < raw.length; i++) {
            const p = raw[i][pIdx] ? String(raw[i][pIdx]).trim() : '';
            if (p && p !== 'Equipment Maintenance Plant') plants.add(p);
        }
        console.log('تعداد فروشگاههای منحصربهفرد:', plants.size);
        if (idx === 0 && plants.size < 10 && raw.length > 100) {
            issues.push('تعداد فروشگاهها خیلی کم است — احتمالاً ستون اشتباهی انتخاب شده');
        }
        const regions = s.regions || [
            { name: 'تهران', ranges: [[1000, 1499], [7000, 7099]] },
            { name: 'گیلان', ranges: [[2000, 2200], [5500, 5599]] },
            { name: 'مازندران', ranges: [[2500, 2600]] },
            { name: 'همدان', ranges: [[3000, 3200]] },
            { name: 'کرمانشاه', ranges: [[3500, 3600], [8500, 8599]] },
            { name: 'مشهد', ranges: [[4000, 4099]] },
            { name: 'کرمان', ranges: [[5000, 5099], [8000, 8099]] }
        ];
        const other = [...plants].filter(p => {
            const code = Number(String(p).replace(/\D/g, ''));
            return !regions.some(r => (r.ranges || [[r.from, r.to]]).some(([f, t]) => code >= f && code <= t));
        });
        if (other.length) console.log(`کدهای خارج از مناطق فعلی (برچسب «سایر»): ${other.length} عدد، مثال: ${other.slice(0, 8).join('، ')}`);
    }
    if (mIdx >= 0) {
        let matched = 0;
        const keys = new Set();
        for (let i = 1; i < raw.length; i++) {
            const m = raw[i][mIdx] ? String(raw[i][mIdx]) : '';
            if (m.startsWith(expected.prefix)) {
                matched++;
                keys.add(`${raw[i][pIdx] || ''}_${raw[i][headers.indexOf('شماره اموال تجهیز')] || ''}_${raw[i][headers.indexOf('شماره سریال کارت دارایی')] || ''}`);
            }
        }
        console.log(`تجهیزات دارای پیشوند ${expected.prefix}: ${matched}`);
        if (matched === 0) issues.push(`هیچ متریالی با پیشوند ${expected.prefix} یافت نشد — تنظیمات را چک کنید`);
        if (matched > keys.size) console.log(`ردیفهای تکراری بالقوه: ${matched - keys.size}`);
    }
});

console.log('\n==================================================');
if (issues.length) {
    console.log('⚠️ موارد نیاز به اقدام:');
    issues.forEach((x, i) => console.log(`${i + 1}. ${x}`));
    console.log('\nپس از آپلود، از پنل管理者 → «فایل مادر و ستونها» ستونها را دوباره تیک بزنید.');
} else {
    console.log('✅ ساختار فایل با تنظیمات فعلی سازگار است.');
}
console.log('==================================================');
