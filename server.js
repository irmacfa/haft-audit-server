const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const core = require('./core');
const auth = require('./auth');
const regionAccess = require('./region-access');
const activity = require('./live-activity');

const app = express();
const PORT = process.env.PORT || 2030;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// جلوگیری از کش شدن پاسخهای API و مانیتورینگ؛ یک کاربر نباید لیست قدیمی فروشگاهها را ببیند
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/monitoring.html') {
        res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    }
    next();
});

// احراز هویت (محلی یا اکتیو دایرکتوری) قبل از تمام مسیرها و فایلهای استاتیک
auth.install(app);

// اطلاعات انبارگردان از نشست لاگین گرفته میشود، نه از ورودی کلاینت
function getAuditor(req) {
    const u = req.user || {};
    return {
        name: u.n || u.u || 'کاربر ناشناس',
        email: u.m || '',
        username: u.u || ''
    };
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// APIهای کش قبل از static تا پاسخ JSON تضمین شود
app.get('/api/cache/status', (req, res) => {
    res.json(core.getCacheStatus());
});

app.post('/api/cache/warmup', async (req, res) => {
    try {
        core.ensureMasterCache().catch(e => console.error('[Warmup]', e.message));
        res.json({ started: true, ...core.getCacheStatus() });
    } catch (e) {
        res.status(500).json({ started: false, error: e.message, ...core.getCacheStatus() });
    }
});

app.post('/api/reload', (req, res) => {
    core.invalidateCache();
    core.ensureMasterCache().catch(e => console.error('[Reload warmup]', e.message));
    res.json({ success: true, ...core.getCacheStatus() });
});

app.use(express.static(path.join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    host: 'mail.haftstores.ir',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// تنظیمات عمومی پورتها (برای ساخت لینکهای بین پنلها در شبکه داخلی)
app.get('/api/public-config', (req, res) => {
    res.json({
        userPort: Number(PORT),
        adminPort: Number(process.env.ADMIN_PORT || 2031)
    });
});

// محدوده دسترسی کاربر فعلی (مناطق لینکشده / دسترسی کل)
app.get('/api/my-access', (req, res) => {
    res.json(regionAccess.getAccess(req.user));
});

// وضعیت سلامت سرور
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        service: 'user-panel',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
        regions: core.getEffectiveSettings().regions.map(r => r.name),
        cache: core.getCacheStatus()
    });
});

// تجهیزات: فقط فروشگاه درخواستی برای جلوگیری از payload بزرگ
app.get('/api/equipment', async (req, res) => {
    try {
        if (!require('fs').existsSync(core.getExcelPath())) {
            return res.status(404).json({ error: 'فایل مادر یافت نشد.' });
        }
        const plant = String(req.query.plant || '').trim();
        if (!plant) {
            return res.status(400).json({ error: 'پارامتر plant الزامی است.', code: 'PLANT_REQUIRED' });
        }
        if (!regionAccess.isPlantAllowed(req.user, plant)) {
            return res.status(403).json({ error: 'شما به منطقهٔ این فروشگاه دسترسی ندارید.', code: 'REGION_FORBIDDEN' });
        }

        const progress = core.getCacheProgress();
        if (!progress.ready) {
            core.ensureMasterCache().catch(e => console.error('[Equipment warmup]', e.message));
            return res.status(202).json({ loading: true, message: 'فایل مادر در حال پردازش است...', progress: core.getCacheProgress() });
        }

        const equipment = core.getEquipmentData();
        const data = equipment.data.filter(i => i.plant === plant);
        res.json({ total: data.length, columns: equipment.columns, data, cache: core.getCacheProgress() });
    } catch (e) {
        if (e.code === 'CACHE_LOADING') {
            core.ensureMasterCache().catch(() => {});
            return res.status(202).json({ loading: true, message: 'فایل مادر در حال پردازش است...', progress: core.getCacheProgress() });
        }
        console.error(e);
        res.status(500).json({ error: 'خطا: ' + e.message });
    }
});

// جستجوی سراسری پس از آماده شدن کش
app.get('/api/equipment/search', (req, res) => {
    try {
        const q = String(req.query.q || '').replace(/[-–\s]/g, '').trim();
        if (q.length < 4) return res.json({ data: [] });
        const progress = core.getCacheProgress();
        if (!progress.ready) return res.status(202).json({ loading: true, progress });
        const access = regionAccess.getAccess(req.user);
        const allowedRegions = access.all ? null : new Set(access.regions);
        const equipment = core.getEquipmentData();
        const data = equipment.data.filter(item => {
            if (allowedRegions && !allowedRegions.has(core.getRegion(item.plant))) return false;
            const a = String(item.assetNo || '').replace(/[-–\s]/g, '');
            const s = String(item.serial || '').replace(/[-–\s]/g, '');
            return a === q || s === q || a.includes(q) || s.includes(q);
        }).slice(0, 50);
        res.json({ total: data.length, data });
    } catch (e) {
        if (e.code === 'CACHE_LOADING') return res.status(202).json({ loading: true, progress: core.getCacheProgress() });
        res.status(500).json({ error: e.message });
    }
});

// وضعیت فروشگاهها (برای نمای خانهای سمت کاربر)
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
            const items = Object.values(db.audit_records[plant] || {});
            return {
                plant,
                region: core.getRegion(plant),
                storeName: stores[plant],
                isLocked: status?.isLocked || false,
                auditDate: status?.auditDate || null,
                auditor: status?.auditor || null,
                equipmentCount: items.length,
                checkedCount: items.filter(i => i.checked).length,
                missingCount: items.filter(i => i.status === 'missing').length
            };
        });
        // هر کاربر فقط فروشگاههای مناطق لینکشدهاش را میبیند؛ حساب مدیر و «دسترسی کل» همه را میبینند.
        res.json(regionAccess.filterStores(req.user, result));
    } catch (e) {
        if (e.code === 'CACHE_LOADING') return res.status(202).json({ loading: true, progress: core.getCacheProgress() });
        res.status(500).json({ error: e.message });
    }
});

function requirePlantAccess(req, res, plant) {
    if (!regionAccess.isPlantAllowed(req.user, plant)) {
        res.status(403).json({ error: 'شما به منطقهٔ این فروشگاه دسترسی ندارید.', code: 'REGION_FORBIDDEN' });
        return false;
    }
    return true;
}

app.get('/api/audit/:plant', (req, res) => {
    if (!requirePlantAccess(req, res, req.params.plant)) return;
    const db = core.readDb();
    res.json({
        statusData: db.plant_status[req.params.plant] || { isLocked: false, auditDate: null, auditor: null },
        auditItems: db.audit_records[req.params.plant] || {}
    });
});

app.get('/api/audit/report-exists/:plant', (req, res) => {
    const filePath = path.join(core.REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    res.json({ exists: require('fs').existsSync(filePath) });
});

app.get('/api/audit/download/:plant', (req, res) => {
    const fs = require('fs');
    const filePath = path.join(core.REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'گزارشی یافت نشد.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Audit_Report_Store_${req.params.plant}.xlsx"`);
    fs.createReadStream(filePath).pipe(res);
});

app.post('/api/reload', (req, res) => {
    core.invalidateCache();
    res.json({ success: true });
});

app.get('/api/monitoring/export', (req, res) => {
    try {
        const XLSX = require('xlsx');
        const db = core.readDb();
        const stores = core.getStores();
        const rows = Object.keys(stores)
            .filter(plant => regionAccess.isRegionAllowed(req.user, core.getRegion(plant)))
            .map(plant => {
                const status = db.plant_status[plant];
                const items = Object.values(db.audit_records[plant] || {});
                return {
                    'کد فروشگاه': plant, 'منطقه': core.getRegion(plant), 'نام فروشگاه': stores[plant],
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
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'وضعیت انبارگردانی');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Audit_Overview.xlsx"');
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/audit/draft', (req, res) => {
    try {
        const { plant, auditItems, storeName } = req.body;
        if (!requirePlantAccess(req, res, plant)) return;
        const auditor = getAuditor(req);
        const db = core.readDb();
        db.audit_records[plant] = auditItems;
        core.writeDb(db);
        const fileName = core.writeReportFile(plant, auditItems);
        core.sendTelegramNotification(
            `💾 <b>ذخیره موقت انبارگردانی</b>\nفروشگاه: ${plant} (${storeName || 'نامشخص'})\n` +
            `انبارگردان: ${auditor.name}${auditor.email ? ` (${auditor.email})` : ''}\n` +
            `تجهیزات ثبت شده: ${Object.keys(auditItems).length}`
        );
        res.json({ success: true, downloadLink: `/reports/${fileName}` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false });
    }
});

app.post('/api/audit/finalize', async (req, res) => {
    try {
        const { plant, storeName, auditItems, managerEmail } = req.body;
        if (!requirePlantAccess(req, res, plant)) return;
        const auditorInfo = getAuditor(req);
        const auditor = auditorInfo.name;
        const db = core.readDb();
        const now = new Date();
        const currentDate = now.toLocaleString('fa-IR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const auditMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const history = (db.plant_status[plant] || {}).history || [];
        history.push({
            date: currentDate, month: auditMonth, auditor, auditorEmail: auditorInfo.email,
            equipmentCount: Object.keys(auditItems).length,
            missingCount: Object.values(auditItems).filter(i => i.status === 'missing').length
        });
        db.audit_records[plant] = auditItems;
        db.plant_status[plant] = {
            isLocked: true, auditDate: currentDate, lastMonth: auditMonth, auditor,
            auditorEmail: auditorInfo.email, history
        };
        core.writeDb(db);

        const fileName = core.writeReportFile(plant, auditItems);
        const mailOptions = {
            from: '"سامانه انبارگردانی هفت" <audit-system@haftstores.ir>',
            to: managerEmail || 'manager@haftstores.ir',
            replyTo: auditorInfo.email || undefined,
            subject: `گزارش انبارگردانی نهایی - فروشگاه ${plant} (${storeName})`,
            html: `
                <div dir="rtl" style="font-family: Tahoma, sans-serif; padding: 20px; background-color: #f4f4f4;">
                    <h2 style="color: #d97706;">گزارش انبارگردانی تجهیزات انفورماتیک</h2>
                    <p><b>کد فروشگاه:</b> ${plant}</p><p><b>نام فروشگاه:</b> ${storeName}</p>
                    <p><b>تاریخ ثبت:</b> ${currentDate}</p><p><b>ماه انبارگردانی:</b> ${auditMonth}</p>
                    <p><b>انبارگردان:</b> ${escapeHtml(auditor)}</p>
                    <p><b>ایمیل انبارگردان:</b> ${escapeHtml(auditorInfo.email || '-')}</p><hr>
                    <p>فایل کامل گزارش به این ایمیل پیوست شده است.</p>
                </div>
            `,
            attachments: [{ filename: fileName, path: path.join(core.REPORTS_DIR, fileName) }]
        };
        let mailSent = true;
        try { await transporter.sendMail(mailOptions); }
        catch (mailErr) {
            mailSent = false;
            console.error('Mail Error:', mailErr.message);
        }

        core.sendTelegramNotification(
            `✅ <b>تکمیل انبارگردانی</b>\nفروشگاه: ${plant} (${storeName})\n` +
            `ماه: ${auditMonth}\nتاریخ: ${currentDate}\nانبارگردان: ${auditor}${auditorInfo.email ? ` (${auditorInfo.email})` : ''}\n` +
            `تجهیزات: ${Object.keys(auditItems).length} مورد`
        );
        res.json({
            success: true,
            message: mailSent
                ? `انبارگردانی فروشگاه ${plant} (${storeName}) قفل و گزارش ایمیل شد.`
                : `انبارگردانی فروشگاه ${plant} (${storeName}) قفل و فایل گزارش ذخیره شد، اما ارسال ایمیل ناموفق بود.`,
            mailSent,
            auditDate: currentDate,
            downloadLink: `/reports/${fileName}`
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطا در ثبت نهایی.' });
    }
});

// ===================== فعالیّت زنده انبارگردانها =====================
app.post('/api/activity/start', (req, res) => {
    const { plant, storeName } = req.body || {};
    if (!plant) return res.status(400).json({ error: 'کد فروشگاه الزامی است.' });
    if (!requirePlantAccess(req, res, plant)) return;
    res.json({ ok: true, activity: activity.start(req.user, plant, storeName) });
});

app.post('/api/activity/heartbeat', (req, res) => {
    const { plant, checked, total } = req.body || {};
    activity.heartbeat(req.user, plant, checked, total);
    res.json({ ok: true });
});

app.post('/api/activity/stop', (req, res) => {
    activity.stop(req.user);
    res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[USER PANEL] http://localhost:${PORT}  |  http://${require('os').hostname()}:${PORT}`);
    // پیش‌بارگذاری در پس‌زمینه تا اولین کاربر منتظر نماند
    core.ensureMasterCache().catch(e => console.error('[Startup warmup]', e.message));
});
