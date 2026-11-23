// Validate the master Excel file before replacing it.
// Run: node qa/validate-master.js "D:\path\to\real-file.xlsx"
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const file = process.argv[2];
if (!file) {
    console.log('Usage: node qa/validate-master.js "path\\to\\file.xlsx"');
    process.exit(1);
}
if (!fs.existsSync(file)) {
    console.log('File not found:', file);
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
console.log('Validating master file:', path.basename(file), `(${sizeMB} MB)`);
console.log('==================================================\n');

let wb;
try { wb = XLSX.readFile(file); }
catch (e) { console.log('❌ Could not read file:', e.message); process.exit(1); }

console.log('Sheets:', wb.SheetNames.join(', '));
const issues = [];

wb.SheetNames.forEach((name, idx) => {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    const headers = raw[0] || [];
    console.log(`\n[${name}] rows: ${raw.length}, columns: ${headers.length}`);
    const found = [expected.plant, expected.name, expected.material].filter(h => headers.includes(h));
    console.log('Key columns found:', found.length ? found.join(', ') : 'none');

    const pIdx = headers.indexOf(expected.plant);
    const mIdx = headers.indexOf(expected.material);
    const nIdx = headers.indexOf(expected.name);
    if (pIdx < 0) issues.push(`Store code column ("${expected.plant}") not found - set it in Settings`);
    if (mIdx < 0) issues.push(`Material column ("${expected.material}") not found - the ${expected.prefix} filter will not work`);
    if (nIdx < 0) issues.push(`Store name column ("${expected.name}") not found`);

    if (pIdx >= 0) {
        const plants = new Set();
        for (let i = 1; i < raw.length; i++) {
            const p = raw[i][pIdx] ? String(raw[i][pIdx]).trim() : '';
            if (p && p !== 'Equipment Maintenance Plant') plants.add(p);
        }
        console.log('Unique stores:', plants.size);
        if (idx === 0 && plants.size < 10 && raw.length > 100) {
            issues.push('Too few stores found - the wrong column may be selected');
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
        if (other.length) console.log(`Codes outside current regions ("Other"): ${other.length}, examples: ${other.slice(0, 8).join(', ')}`);
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
        console.log(`Equipment with prefix ${expected.prefix}: ${matched}`);
        if (matched === 0) issues.push(`No material found with prefix ${expected.prefix} - check Settings`);
        if (matched > keys.size) console.log(`Potential duplicate rows: ${matched - keys.size}`);
    }
});

console.log('\n==================================================');
if (issues.length) {
    console.log('⚠️ Items that need attention:');
    issues.forEach((x, i) => console.log(`${i + 1}. ${x}`));
    console.log('\nAfter uploading, re-check the columns in Admin Panel -> Master File and Columns.');
} else {
    console.log('✅ The file structure matches the current settings.');
}
console.log('==================================================');
