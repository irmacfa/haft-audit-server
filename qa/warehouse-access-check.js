// تست تفکیک دسترسی انبارها:
// - لینک فقط کد 9104 => فقط همان انبار
// - لینک «انبارها» => تمام انبارها
// - لینک «*» یا حساب مدیر => تمام مناطق و انبارها
// اجرا: npm run test:warehouse
const assert = require('assert/strict');
const core = require('../core');
const directory = require('../ad-directory');
const access = require('../region-access');

// اعمال تستی بدون نوشتن در db/region_members.json
let links = {};
directory.getLinks = () => links;
directory.getRegionsForUser = username => links[String(username).toLowerCase()] || [];
directory.listMembers = () => [];

const user = name => ({ u: name, n: name, m: '', g: 'Oshanak-ITSUP', a: false, exp: Date.now() + 60000 });
const admin = { u: 'qa-admin', n: 'QA Admin', m: '', g: 'Oshanak-ITSUP', a: true, exp: Date.now() + 60000 };

const results = [];
async function check(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}

(async () => {
    await check('warehouse codes are detected by the configured region', () => {
        assert.equal(core.isWarehousePlant('9104'), true);
        assert.equal(core.isWarehousePlant('9101'), true);
        assert.equal(core.isWarehousePlant('3502'), false);
    });

    await check('single warehouse link grants only that warehouse', () => {
        links = { ali: ['9104'] };
        const s = user('ali');
        assert.equal(access.isPlantAllowed(s, '9104'), true);
        assert.equal(access.isPlantAllowed(s, '9101'), false);
        assert.equal(access.isPlantAllowed(s, '3502'), false);
    });

    await check('all-warehouses link grants every warehouse but no store', () => {
        links = { ali: ['انبارها'] };
        const s = user('ali');
        for (const p of ['9101', '9102', '9104', '9105', '9107', '9108', '9109']) {
            assert.equal(access.isPlantAllowed(s, p), true, p);
        }
        assert.equal(access.isPlantAllowed(s, '3502'), false);
    });

    await check('ordinary region link does not expose warehouses', () => {
        links = { ali: ['تهران'] };
        const s = user('ali');
        assert.equal(access.isPlantAllowed(s, '1000'), true);
        assert.equal(access.isPlantAllowed(s, '9104'), false);
    });

    await check('global link exposes everything', () => {
        links = { ali: ['*'] };
        const s = user('ali');
        assert.equal(access.isPlantAllowed(s, '9104'), true);
        assert.equal(access.isPlantAllowed(s, '3502'), true);
    });

    await check('admin session exposes everything', () => {
        links = {};
        assert.equal(access.isPlantAllowed(admin, '9104'), true);
        assert.equal(access.isPlantAllowed(admin, '3502'), true);
    });

    await check('monitoring store list is filtered per warehouse link', () => {
        links = { ali: ['9104'] };
        const stores = [
            { plant: '9104', region: 'انبارها' },
            { plant: '9101', region: 'انبارها' },
            { plant: '3502', region: 'کرمانشاه' }
        ];
        const filtered = access.filterStores(user('ali'), stores);
        assert.deepEqual(filtered.map(s => s.plant), ['9104']);
    });

    await check('global search uses the same per-plant rule', () => {
        links = { ali: ['9104'] };
        const cachedAccess = access.getAccess(user('ali'));
        assert.equal(access.isPlantAllowedForAccess(cachedAccess, '9104'), true);
        assert.equal(access.isPlantAllowedForAccess(cachedAccess, '9101'), false);
        assert.equal(access.isPlantAllowedForAccess(cachedAccess, '3502'), false);
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
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
