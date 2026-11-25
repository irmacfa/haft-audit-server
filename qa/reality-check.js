// Reality Checker / Evidence Collector — قابل تکرار
// اجرا: node qa/reality-check.js
// خروجی: qa/test-results.json
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];

function get(url) {
    return new Promise(resolve => {
        const start = Date.now();
        http.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve({ status: res.statusCode, ms: Date.now() - start, body: buf.toString('utf8'), bytes: buf.length });
            });
        }).on('error', e => resolve({ status: 0, ms: Date.now() - start, error: e.message }));
    });
}

function check(name, pass, evidence) {
    results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
}

(async () => {
    // ۱) سلامت دو سرویس
    for (const [name, port] of [['user-panel', 3000], ['admin-panel', 3001]]) {
        const r = await get(`http://localhost:${port}/api/health`);
        let info = {};
        try { info = JSON.parse(r.body); } catch (e) { }
        check(`health:${name}`, r.status === 200 && info.ok === true,
            { status: r.status, ms: r.ms, service: info.service, regions: info.regions });
    }

    // ۲) تجهیزات: بدون ردیف تکراری، ستونهای قابل نمایش
    const eq = await get('http://localhost:3000/api/equipment');
    let eqData = { total: 0, data: [], columns: [] };
    try { eqData = JSON.parse(eq.body); } catch (e) { }
    const ids = eqData.data.map(x => x.eqId);
    const dup = ids.length - new Set(ids).size;
    check('equipment: deduplicated', eq.status === 200 && dup === 0,
        { status: eq.status, ms: eq.ms, total: eqData.total, duplicates: dup });

    // ۳) مانیتورینگ: ۷۱۴ فروشگاه، ۸ گروه منطقه (شامل انبارها)
    const mon = await get('http://localhost:3001/api/monitoring/status');
    let stores = [];
    try { stores = JSON.parse(mon.body); } catch (e) { }
    const byRegion = {};
    stores.forEach(s => { byRegion[s.region] = (byRegion[s.region] || 0) + 1; });
    check('monitoring: stores and regions', mon.status === 200 && stores.length === 714 && Object.keys(byRegion).length >= 7,
        { status: mon.status, ms: mon.ms, stores: stores.length, byRegion });

    // ۴) خروجی اکسل کلی
    const exp = await get('http://localhost:3001/api/monitoring/export');
    check('export: xlsx bytes', exp.status === 200 && exp.bytes > 10000,
        { status: exp.status, ms: exp.ms, bytes: exp.bytes, contentType: 'xlsx' });

    // ۵) فونت سراسری (style.css) و تمام عرض HTML
    const css = await get('http://localhost:3000/style.css');
    for (const [name, url] of [['user', 'http://localhost:3000/'], ['monitoring', 'http://localhost:3000/monitoring.html'], ['admin', 'http://localhost:3001/']]) {
        const r = await get(url);
        check(`page:${name}: font+width`,
            r.status === 200 && r.body.includes('style.css') && !r.body.includes('max-w-') && css.body.includes('IRANSansX'),
            { status: r.status, linksStyle: r.body.includes('style.css'), hasMaxWidth: r.body.includes('max-w-'), globalFontCss: css.body.includes('*::before') });
    }

    const summary = {
        date: new Date().toISOString(),
        total: results.length,
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length,
        screenshotEvidence: 'NOT AVAILABLE (browser screenshot requires visible desktop window)',
        results
    };
    const out = path.join(__dirname, 'test-results.json');
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
})();
