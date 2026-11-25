// بررسی کاتالوگ متریال ادغامشده از دو تب فایل اکسل.
// اجرا: npm run test:materials
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog', 'materials.json'), 'utf8'));
const items = catalog.items || [];
const codes = items.map(i => i.material);

const results = [];
function check(name, fn) {
    try { fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}

check('both sheets are merged', () => {
    assert.equal(catalog.sourceSheets.length, 2);
    assert.deepEqual(catalog.sourceSheets.map(s => s.name).sort(), ['IT6000', 'IT9000']);
});

check('catalog has all 619 unique materials', () => {
    assert.equal(items.length, 619);
    assert.equal(new Set(codes).size, codes.length);
});

check('no incomplete rows', () => {
    for (const item of items) {
        assert.ok(item.material && item.description, `incomplete row: ${JSON.stringify(item)}`);
    }
});

check('representative codes from both sheets exist', () => {
    const byCode = Object.fromEntries(items.map(i => [i.material, i.description]));
    assert.ok(byCode['6000021'], 'missing IT6000 code');
    assert.ok(byCode['9000011'], 'missing IT9000 code');
});

const summary = {
    date: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    results
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
