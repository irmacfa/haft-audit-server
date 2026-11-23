// Show the status of both Haft Audit services.
const http = require('http');
require('dotenv').config();

const services = [
    { name: 'User panel (audit)', port: Number(process.env.PORT || 2030), url: 'http://localhost:' + (process.env.PORT || 2030) },
    { name: 'Admin panel', port: Number(process.env.ADMIN_PORT || 2031), url: 'http://localhost:' + (process.env.ADMIN_PORT || 2031) }
];

function check(service) {
    return new Promise(resolve => {
        const req = http.get(service.url + '/api/health', { timeout: 3000 }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve({ service, ok: res.statusCode === 200, info: JSON.parse(data) });
                } catch (e) {
                    resolve({ service, ok: false, error: 'Invalid response' });
                }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve({ service, ok: false, error: 'timeout' }); });
        req.on('error', e => resolve({ service, ok: false, error: e.code || e.message }));
    });
}

(async () => {
    console.log('==================================================');
    console.log('  HAFT AUDIT SERVER STATUS');
    console.log('==================================================\n');

    const results = await Promise.all(services.map(check));
    results.forEach(r => {
        console.log(`${r.ok ? '[RUNNING]' : '[STOPPED]'} ${r.service.name}`);
        console.log(`          URL: ${r.service.url}`);
        if (r.ok) {
            const i = r.info;
            console.log(`          Uptime: ${i.uptimeSeconds} seconds`);
            console.log(`          Master file: ${i.cache.masterFileReady ? 'Ready' : 'Not found'}`);
            console.log(`          Excel cache: ${i.cache.workbookCached ? 'Active' : 'Inactive'}`);
            console.log(`          Store cache: ${i.cache.storeCount !== null ? i.cache.storeCount + ' stores' : 'Inactive'}`);
            console.log(`          Regions: ${(i.regions || []).join(', ')}`);
        } else {
            console.log(`          Error: ${r.error}`);
        }
        console.log('');
    });

    const allUp = results.every(r => r.ok);
    console.log(allUp ? '✅ Both servers are running.' : '⚠️ Some servers are not running. Run start.bat to start them.');
})();
