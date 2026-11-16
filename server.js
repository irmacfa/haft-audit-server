const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const core = require('./core');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    host: 'mail.haftstores.ir',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// تجهیزات از فایل مادر (کش شده)
app.get('/api/equipment', (req, res) => {
    try {
        if (!require('fs').existsSync(core.getExcelPath())) {
            return res.status(404).json({ error: 'فایل مادر یافت نشد.' });
        }
        res.json(core.getEquipmentData());
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطا: ' + e.message });
    }
});

// وضعیت فروشگاهها (برای نمای خانهای سمت کاربر)
app.get('/api/monitoring/status', (req, res) => {
    try {
        const db = core.readDb();
        const stores = core.getStores();
        const result = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const items = Object.values(db.audit_records[plant] || {});
            return {
                plant,
                storeName: stores[plant],
                isLocked: status?.isLocked || false,
                auditDate: status?.auditDate || null,
                auditor: status?.auditor || null,
                equipmentCount: items.length,
                checkedCount: items.filter(i => i.checked).length,
                missingCount: items.filter(i => i.status === 'missing').length
            };
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/audit/:plant', (req, res) => {
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
        const rows = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const items = Object.values(db.audit_records[plant] || {});
            return {
                'کد فروشگاه': plant, 'نام فروشگاه': stores[plant],
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
        const { plant, auditItems, storeName, auditorName } = req.body;
        const db = core.readDb();
        db.audit_records[plant] = auditItems;
        core.writeDb(db);
        const fileName = core.writeReportFile(plant, auditItems);
        core.sendTelegramNotification(
            `💾 <b>ذخیره موقت انبارگردانی</b>\nفروشگاه: ${plant} (${storeName || 'نامشخص'})\n` +
            `انبارگردان: ${auditorName || db.plant_status[plant]?.auditor || 'کارشناس IT'}\n` +
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
        const { plant, storeName, auditItems, auditorName, managerEmail } = req.body;
        const db = core.readDb();
        const now = new Date();
        const currentDate = now.toLocaleString('fa-IR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const auditMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const auditor = auditorName || 'کارشناس IT';
        const history = (db.plant_status[plant] || {}).history || [];
        history.push({
            date: currentDate, month: auditMonth, auditor,
            equipmentCount: Object.keys(auditItems).length,
            missingCount: Object.values(auditItems).filter(i => i.status === 'missing').length
        });
        db.audit_records[plant] = auditItems;
        db.plant_status[plant] = {
            isLocked: true, auditDate: currentDate, lastMonth: auditMonth, auditor, history
        };
        core.writeDb(db);

        const fileName = core.writeReportFile(plant, auditItems);
        const mailOptions = {
            from: '"سامانه انبارگردانی هفت" <audit-system@haftstores.ir>',
            to: managerEmail || 'manager@haftstores.ir',
            subject: `گزارش انبارگردانی نهایی - فروشگاه ${plant} (${storeName})`,
            html: `
                <div dir="rtl" style="font-family: Tahoma, sans-serif; padding: 20px; background-color: #f4f4f4;">
                    <h2 style="color: #d97706;">گزارش انبارگردانی تجهیزات انفورماتیک</h2>
                    <p><b>کد فروشگاه:</b> ${plant}</p><p><b>نام فروشگاه:</b> ${storeName}</p>
                    <p><b>تاریخ ثبت:</b> ${currentDate}</p><p><b>ماه انبارگردانی:</b> ${auditMonth}</p>
                    <p><b>انبارگردان:</b> ${auditor}</p><hr>
                    <p>فایل کامل گزارش به این ایمیل پیوست شده است.</p>
                </div>
            `,
            attachments: [{ filename: fileName, path: path.join(core.REPORTS_DIR, fileName) }]
        };
        try { await transporter.sendMail(mailOptions); }
        catch (mailErr) { console.error('Mail Error:', mailErr.message); }

        core.sendTelegramNotification(
            `✅ <b>تکمیل انبارگردانی</b>\nفروشگاه: ${plant} (${storeName})\n` +
            `ماه: ${auditMonth}\nتاریخ: ${currentDate}\nانبارگردان: ${auditor}\n` +
            `تجهیزات: ${Object.keys(auditItems).length} مورد`
        );
        res.json({
            success: true,
            message: `انبارگردانی فروشگاه ${plant} (${storeName}) قفل و گزارش ایمیل شد.`,
            auditDate: currentDate,
            downloadLink: `/reports/${fileName}`
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'خطا در ثبت نهایی.' });
    }
});

app.listen(PORT, () => {
    console.log(`[USER PANEL] http://localhost:${PORT}`);
});
