const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const XLSX = require('xlsx');
const compression = require('compression');
require('dotenv').config();
const core = require('./core');
const auth = require('./auth');
const directory = require('./ad-directory');
const activity = require('./live-activity');
const regionAccess = require('./region-access');

const app = express();
const PORT = process.env.ADMIN_PORT || 2031;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// جلوگیری از کش شدن پاسخهای API و صفحه مانیتورینگ در پنل مدیریت
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/monitoring.html') {
        res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    }
    next();
});

// احراز هویت (محلی یا اکتیو دایرکتوری) قبل از تمام مسیرها و فایلهای استاتیک
auth.install(app);

// تمام تنظیمات و عملیات مدیریتی فقط برای حساب مدیر (در حالت محلی: پرچم admin)
app.use((req, res, next) => {
    const p = req.path;
    const adminOnly = p === '/' || p === '/index.html' || p.startsWith('/api/admin') ||
        p === '/api/reload' || p.startsWith('/api/cache/') ||
        p === '/monitoring.html' || p.startsWith('/api/monitoring/');
    if (!adminOnly) return next();
    if (auth.isAdminUser(req.user)) return next();
    if (p.startsWith('/api/')) {
        return res.status(403).json({ error: 'دسترسی فقط برای حساب مدیر است.', code: 'FORBIDDEN' });
    }
    const adminLabel = auth.IS_LOCAL ? 'حساب مدیر محلی (ساختهشده با --admin)' : auth.ADMIN_USERNAME;
    return res.status(403).type('html').send(
        '<meta charset="utf-8"><div dir="rtl" style="font-family:tahoma;padding:40px">' +
        'دسترسی به پنل مدیریت فقط برای <b>' + adminLabel + '</b> است.' +
        '<br><a href="/login.html">بازگشت به صفحه ورود</a></div>'
    );
});

app.use(express.static(path.join(__dirname, 'public', 'admin')));

// مانیتورینگ کامل همه فروشگاهها فقط روی پنل مدیریت در دسترس است
app.get('/monitoring.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'monitoring.html'));
});

app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts')));
app.use('/style.css', express.static(path.join(__dirname, 'public', 'style.css')));
app.use('/vibefarsi.css', express.static(path.join(__dirname, 'public', 'vibefarsi.css')));
app.use('/vf-apply.js', express.static(path.join(__dirname, 'public', 'vf-apply.js')));
app.use('/tailwind-cdn.js', express.static(path.join(__dirname, 'public', 'tailwind-cdn.js')));
app.use('/auth-ui.js', express.static(path.join(__dirname, 'public', 'auth-ui.js')));
app.use('/logo.webp', express.static(path.join(__dirname, 'public', 'logo.webp')));
app.use('/design.css', express.static(path.join(__dirname, 'public', 'design.css')));
app.use('/panel-theme.css', express.static(path.join(__dirname, 'public', 'panel-theme.css')));

// تازه کردن کش (پس از آپلود فایل مادر یا تغییر تنظیمات)
app.post('/api/reload', (req, res) => {
    core.invalidateCache();
    core.ensureMasterCache().catch(e => console.error('[Admin reload warmup]', e.message));
    res.json({ success: true, ...core.getCacheStatus() });
});

app.get('/api/cache/status', (req, res) => res.json(core.getCacheStatus()));
app.post('/api/cache/warmup', (req, res) => {
    core.ensureMasterCache().catch(e => console.error('[Admin warmup]', e.message));
    res.json({ started: true, ...core.getCacheStatus() });
});

// تنظیمات عمومی پورتها (برای ساخت لینکهای بین پنلها در شبکه داخلی)
app.get('/api/public-config', (req, res) => {
    res.json({
        userPort: Number(process.env.PORT || 2030),
        adminPort: Number(PORT)
    });
});

// وضعیت سلامت سرورمدیریت
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        service: 'admin-panel',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
        regions: core.getEffectiveSettings().regions.map(r => r.name),
        cache: core.getCacheStatus()
    });
});

// سطح دسترسی کاربر فعلی (برای نمایش محدوده مانیتورینگ)
app.get('/api/my-access', (req, res) => {
    res.json(regionAccess.getAccess(req.user));
});

// ارتباط با سرور کاربر برای تازه کردن کش آن بعد از آپلود/تغییر تنظیمات
function notifyUserServer() {
    const req = http.request({
        host: 'localhost', port: process.env.PORT || 2030, path: '/api/reload', method: 'POST',
        headers: { 'x-internal-token': process.env.INTERNAL_TOKEN || '' }
    }, res => res.resume());
    req.on('error', e => console.error('[Reload] User server not reachable:', e.message));
    req.end();
}

// آپلود فایل مادر
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, core.DATA_DIR),
        filename: (req, file, cb) => cb(null, 'master.xlsx')
    }),
    limits: { fileSize: 200 * 1024 * 1024 }
});

app.post('/api/admin/upload-master', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'فایلی آپلود نشد.' });
        core.invalidateCache();
        const originalName = req.file.originalname;
        const extension = (path.extname(originalName).toLowerCase().replace('.', '') || 'نامشخص').toUpperCase();
        core.saveMasterFileMeta({
            originalName,
            storedName: req.file.filename,
            extension,
            mimeType: req.file.mimetype || '',
            sizeBytes: req.file.size
        });
        notifyUserServer();
        core.ensureMasterCache().catch(e => console.error('[Upload warmup]', e.message));
        res.json({
            success: true,
            fileName: originalName,
            processing: true,
            masterFile: core.getMasterFileMeta(),
            progress: core.getCacheProgress()
        });
    } catch (e) {
        console.error('Upload Error:', e);
        res.status(500).json({ error: 'خطا در پردازش فایل: ' + e.message });
    }
});

// اطلاعات فایل مادر آپلودشده (نام، نوع، حجم، زمان و لیست ستونها)
app.get('/api/admin/master-file', (req, res) => {
    try {
        res.json(core.getMasterFileMeta());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/settings', (req, res) => {
    try {
        res.json({ settings: core.getEffectiveSettings(), columns: core.getMasterColumns() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// اعضای گروه ITSUP همراه مناطق لینکشده به آنها (لینکها فقط داخل برنامه ذخیره میشوند)
app.get('/api/admin/members', async (req, res) => {
    try {
        const [members, regions] = await Promise.all([directory.listMembers(), Promise.resolve(core.getEffectiveSettings().regions)]);
        const saved = directory.getLinks();
        res.json({
            group: directory.GROUP,
            regions: regions.map(r => r.name),
            members: members.map(m => ({
                ...m,
                regions: Array.isArray(saved[m.username.toLowerCase()]) ? saved[m.username.toLowerCase()] : []
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/region-links', (req, res) => {
    try {
        const { username, region, assigned } = req.body || {};
        const links = directory.setLink(username, region, assigned !== false);
        res.json({ success: true, links });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

// فعالیت زنده کاربران (فروشگاه در حال انبارگردانی + مدت زمان)
app.get('/api/admin/live-activity', (req, res) => {
    res.json(activity.list());
});

// تنظیمات پیشنهادی برای هر بخش از تنظیمات
app.get('/api/admin/suggested-settings', (req, res) => {
    res.json(core.DEFAULT_SETTINGS);
});

app.post('/api/admin/regions', (req, res) => {
    try {
        const settings = core.getSettings();
        const updated = core.saveSettings({ ...settings, regions: req.body.regions });
        notifyUserServer();
        res.json({ success: true, regions: updated.regions });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/settings', (req, res) => {
    try {
        const settings = core.saveSettings(req.body);
        notifyUserServer();
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// این مسیرها پشت middleware مخصوص مدیریت هستند، بنابراین عمداً بدون فیلتر، همه فروشگاهها را برمیگردانند.
app.get('/api/monitoring/status', async (req, res) => {
    try {
        const progress = core.getCacheProgress();
        if (!progress.ready) {
            core.ensureMasterCache().catch(e => console.error('[Monitoring warmup]', e.message));
            return res.status(202).json({ loading: true, progress: core.getCacheProgress() });
        }
        const db = core.readDb();
        const stores = core.getStores();
        const result = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const history = status?.history || [];
            const items = Object.values(db.audit_records[plant] || {});
            return {
                plant,
                region: core.getRegion(plant),
                storeName: stores[plant],
                isLocked: status?.isLocked || false,
                auditDate: status?.auditDate || null,
                auditor: status?.auditor || null,
                historyCount: history.length,
                history: history.slice(-6).reverse(),
                equipmentCount: items.length,
                checkedCount: items.filter(i => i.checked).length,
                missingCount: items.filter(i => i.status === 'missing').length
            };
        });
        res.json(result);
    } catch (e) {
        if (e.code === 'CACHE_LOADING') return res.status(202).json({ loading: true, progress: core.getCacheProgress() });
        console.error('Monitoring Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/monitoring/export', (req, res) => {
    try {
        const db = core.readDb();
        const stores = core.getStores();
        const rows = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const items = Object.values(db.audit_records[plant] || {});
            return {
                'کد فروشگاه': plant,
                'منطقه': core.getRegion(plant),
                'نام فروشگاه': stores[plant],
                'وضعیت': status?.isLocked ? 'تکمیل شده' : (status?.auditor ? 'در حال اجرا' : 'در انتظار'),
                'آخرین تاریخ انبارگردانی': status?.auditDate || '-',
                'تعداد دفعات انبارگردانی': (status?.history || []).length,
                'انبارگردان': status?.auditor || '-',
                'تعداد تجهیزات': items.length,
                'تعداد تایید شده': items.filter(i => i.checked).length,
                'تعداد فاقد': items.filter(i => i.status === 'missing').length
            };
        }).sort((a, b) => a['کد فروشگاه'].localeCompare(b['کد فروشگاه']));

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!dir'] = 'rtl';
        ws['!cols'] = [{ wch: 14 }, { wch: 35 }, { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 14 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'وضعیت انبارگردانی');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Audit_Overview.xlsx"');
        res.send(buffer);
    } catch (e) {
        console.error('Export Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ADMIN PANEL] http://localhost:${PORT}  |  http://${require('os').hostname()}:${PORT}`);
    core.ensureMasterCache().catch(e => console.error('[Admin startup warmup]', e.message));
});
