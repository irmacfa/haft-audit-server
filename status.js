// نمایش وضعیت سرورهای سامانه انبارگردانی هفت
const http = require('http');
require('dotenv').config();

const services = [
    { name: 'پنل انبارگردان (کاربر)', port: Number(process.env.PORT || 2030), url: 'http://localhost:' + (process.env.PORT || 2030) },
    { name: 'پنل مدیریت', port: Number(process.env.ADMIN_PORT || 2031), url: 'http://localhost:' + (process.env.ADMIN_PORT || 2031) }
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
                    resolve({ service, ok: false, error: 'پاسخ نامعتبر' });
                }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve({ service, ok: false, error: 'timeout' }); });
        req.on('error', e => resolve({ service, ok: false, error: e.code || e.message }));
    });
}

(async () => {
    console.log('==================================================');
    console.log('  وضعیت سرورهای سامانه انبارگردانی هفت');
    console.log('==================================================\n');

    const results = await Promise.all(services.map(check));
    results.forEach(r => {
        console.log(`${r.ok ? '[RUNNING]' : '[STOPPED]'} ${r.service.name}`);
        console.log(`          آدرس: ${r.service.url}`);
        if (r.ok) {
            const i = r.info;
            console.log(`          زمان اجرا: ${i.uptimeSeconds} ثانیه`);
            console.log(`          فایل مادر: ${i.cache.masterFileReady ? 'آماده' : 'یافت نشد'}`);
            console.log(`          کش اکسل: ${i.cache.workbookCached ? 'فعال' : 'غیرفعال'}`);
            console.log(`          کش فروشگاهها: ${i.cache.storeCount !== null ? i.cache.storeCount + ' فروشگاه' : 'غیرفعال'}`);
            console.log(`          مناطق: ${(i.regions || []).join('، ')}`);
        } else {
            console.log(`          خطا: ${r.error}`);
        }
        console.log('');
    });

    const allUp = results.every(r => r.ok);
    console.log(allUp ? '✅ هر دو سرور در حال اجرا هستند.' : '⚠️ برخی سرورها در حال اجرا نیستند. فایل start.bat را اجرا کنید.');
})();
