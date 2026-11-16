const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const MASTER_PATH = path.join(DATA_DIR, 'master.xlsx');
const LEGACY_EXCEL_PATH = path.join(DATA_DIR, 'Copy of Book5.xlsx');
const DB_PATH = path.join(__dirname, 'db', 'audit_db.json');
const REPORTS_DIR = path.join(__dirname, 'public', 'reports');

if (!fs.existsSync(path.join(__dirname, 'db'))) fs.mkdirSync(path.join(__dirname, 'db'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ audit_records: {}, plant_status: {}, settings: {} }));
}

// مسیر فایل مادر: اگر فایل آپلودشده وجود نداشته باشد از فایل قدیمی استفاده میشود
function getExcelPath() {
    return fs.existsSync(MASTER_PATH) ? MASTER_PATH : LEGACY_EXCEL_PATH;
}

// خواندن تنظیمات (ستونهای انتخابی + ستونهای کلیدی)
function getSettings() {
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    return db.settings || {};
}

// ذخیره تنظیمات
function saveSettings(settings) {
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    db.settings = settings;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// تنظیمات پیشفرض ستونها
const DEFAULT_SETTINGS = {
    plantColumn: 'پلنت محل تجهیز',
    nameColumn: 'شرح مرکز هزینه تجهیز',
    materialColumn: 'شماره متریال تجهیز',
    materialPrefix: '9000',
    columns: [
        'شرح کارت دارایی',
        'شماره اموال تجهیز',
        'شماره سریال کارت دارایی'
    ]
};

function getEffectiveSettings() {
    const s = getSettings();
    return {
        plantColumn: s.plantColumn || DEFAULT_SETTINGS.plantColumn,
        nameColumn: s.nameColumn || DEFAULT_SETTINGS.nameColumn,
        materialColumn: s.materialColumn || DEFAULT_SETTINGS.materialColumn,
        materialPrefix: s.materialPrefix || DEFAULT_SETTINGS.materialPrefix,
        columns: Array.isArray(s.columns) && s.columns.length ? s.columns : DEFAULT_SETTINGS.columns
    };
}

const transporter = nodemailer.createTransport({
    host: 'mail.haftstores.ir',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

function sendTelegramNotification(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.log('[Telegram] Not configured, skipping notification.');
        return;
    }
    const data = JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' });
    const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            if (res.statusCode !== 200) console.error('[Telegram] Error:', body);
            else console.log('[Telegram] Notification sent.');
        });
    });
    req.on('error', e => console.error('[Telegram] Request error:', e.message));
    req.write(data);
    req.end();
}

function cleanExcelCode(code) {
    if (!code || code === '-') return '-';
    return String(code).replace(/[-–\s]/g, '').trim();
}

function buildReportRows(auditItems) {
    return Object.values(auditItems).map(item => ({
        'شرح کارت دارایی (مدل دستگاه)': item.desc || '',
        'شماره اموال تجهیز': item.assetNo || '',
        'شماره سریال': item.serial || '',
        'کد اموال جدید': item.newAsset || '-',
        'وضعیت تایید': item.checked ? 'تایید شده' : 'بررسی نشده',
        'وضعیت موجودی': item.status === 'missing' ? 'فاقد' : 'موجود'
    }));
}

function writeReportFile(plant, auditItems) {
    const rows = buildReportRows(auditItems);
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'پیام': 'هنوز تجهیزی ثبت نشده است.' }]);
    ws['!dir'] = 'rtl';
    ws['!cols'] = [{ wch: 45 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'گزارش انبارگردانی');
    const fileName = `Audit_Report_Store_${plant}.xlsx`;
    XLSX.writeFile(wb, path.join(REPORTS_DIR, fileName));
    return fileName;
}

// استخراج ستونهای فایل مادر
function getMasterColumns() {
    const workbook = XLSX.readFile(getExcelPath());
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    return firstRow.filter(h => h && String(h).trim());
}

// استخراج فروشگاهها از فایل مادر بر اساس تنظیمات
function getStoresFromMaster() {
    const settings = getEffectiveSettings();
    const workbook = XLSX.readFile(getExcelPath());
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headers = rawData[0];
    const plantIdx = headers.indexOf(settings.plantColumn);
    const nameIdx = headers.indexOf(settings.nameColumn);

    const stores = {};
    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        const plant = plantIdx >= 0 && row[plantIdx] ? String(row[plantIdx]).trim() : null;
        if (plant && plant !== 'Equipment Maintenance Plant') {
            stores[plant] = nameIdx >= 0 && row[nameIdx] ? String(row[nameIdx]).trim() : 'نامشخص';
        }
    }
    return stores;
}

// ===================== پنل مدیریت: فایل مادر و تنظیمات =====================

const masterUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, DATA_DIR),
        filename: (req, file, cb) => cb(null, 'master.xlsx')
    }),
    limits: { fileSize: 200 * 1024 * 1024 }
});

app.post('/api/admin/upload-master', masterUpload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'فایلی آپلود نشد.' });
        const columns = getMasterColumns();
        res.json({ success: true, fileName: req.file.originalname, columns: columns, count: columns.length });
    } catch (e) {
        console.error('Upload Error:', e);
        res.status(500).json({ error: 'خطا در پردازش فایل آپلود شده: ' + e.message });
    }
});

app.get('/api/admin/settings', (req, res) => {
    try {
        res.json({ settings: getEffectiveSettings(), columns: getMasterColumns() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/settings', (req, res) => {
    try {
        saveSettings(req.body);
        res.json({ success: true, settings: getEffectiveSettings() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===================== تجهیزات (فایل مادر) =====================

app.get('/api/equipment', (req, res) => {
    try {
        const excelPath = getExcelPath();
        if (!fs.existsSync(excelPath)) {
            return res.status(404).json({ error: 'فایل مادر روی سرور یافت نشد! لطفاً از پنل مدیریت آپلود کنید.' });
        }

        const settings = getEffectiveSettings();
        const workbook = XLSX.readFile(excelPath);
        let dataRows = [];
        let seenItems = new Set();

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonSheet = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (jsonSheet.length < 2) return;

            const headers = jsonSheet[0];
            const materialIdx = headers.indexOf(settings.materialColumn);
            const plantIdx = headers.indexOf(settings.plantColumn);
            const nameIdx = headers.indexOf(settings.nameColumn);

            for (let i = 1; i < jsonSheet.length; i++) {
                const row = jsonSheet[i];
                const material = materialIdx >= 0 ? String(row[materialIdx] || '') : '';
                if (!material.startsWith(settings.materialPrefix)) continue;

                const plant = plantIdx >= 0 ? String(row[plantIdx] || '').trim() : '';
                const storeName = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : `فروشگاه ${plant}`;

                // مقادیر تمام ستونها را به عنوان فیلدهای دینامیک نگه میداریم
                const fields = {};
                headers.forEach((h, idx) => {
                    if (h) fields[h] = row[idx] === undefined || row[idx] === null ? '' : String(row[idx]);
                });

                const uniqueKey = `${plant}_${fields['شماره اموال تجهیز'] || ''}_${fields['شماره سریال کارت دارایی'] || ''}_${i}`;
                if (seenItems.has(uniqueKey)) continue;
                seenItems.add(uniqueKey);

                dataRows.push({
                    plant: plant,
                    storeName: storeName,
                    eqId: fields['شماره تجهیز'] || '',
                    desc: fields['شرح کارت دارایی'] || fields['شرح تجهیز'] || 'بدون شرح',
                    assetNo: cleanExcelCode(fields['شماره اموال تجهیز'] || '-'),
                    serial: cleanExcelCode(fields['شماره سریال کارت دارایی'] || '-'),
                    fields: fields
                });
            }
        });

        res.json({ total: dataRows.length, columns: settings.columns, data: dataRows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'خطا در پردازش فایل مادر: ' + error.message });
    }
});

// ===================== مانیتورینگ و پنل مدیریت =====================

app.get('/api/monitoring/status', (req, res) => {
    try {
        const excelPath = getExcelPath();
        if (!fs.existsSync(excelPath)) return res.status(404).json({ error: 'فایل مادر یافت نشد' });

        const db = JSON.parse(fs.readFileSync(DB_PATH));
        const stores = getStoresFromMaster();

        const result = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const history = status?.history || [];
            const auditItems = db.audit_records[plant] || {};
            const items = Object.values(auditItems);
            return {
                plant: plant,
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
        console.error('Monitoring Error:', e);
        res.status(500).json({ error: 'خطای سرور: ' + e.message });
    }
});

app.get('/api/monitoring/export', (req, res) => {
    try {
        const excelPath = getExcelPath();
        if (!fs.existsSync(excelPath)) return res.status(404).json({ error: 'فایل مادر یافت نشد' });

        const db = JSON.parse(fs.readFileSync(DB_PATH));
        const stores = getStoresFromMaster();

        const rows = Object.keys(stores).map(plant => {
            const status = db.plant_status[plant];
            const auditItems = db.audit_records[plant] || {};
            const items = Object.values(auditItems);
            return {
                'کد فروشگاه': plant,
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

app.get('/api/audit/:plant', (req, res) => {
    const plant = req.params.plant;
    const db = JSON.parse(fs.readFileSync(DB_PATH));
    res.json({
        statusData: db.plant_status[plant] || { isLocked: false, auditDate: null, auditor: null },
        auditItems: db.audit_records[plant] || {}
    });
});

app.get('/api/audit/report-exists/:plant', (req, res) => {
    const filePath = path.join(REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    res.json({ exists: fs.existsSync(filePath) });
});

app.get('/api/audit/download/:plant', (req, res) => {
    const filePath = path.join(REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'گزارشی یافت نشد.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Audit_Report_Store_${req.params.plant}.xlsx"`);
    fs.createReadStream(filePath).pipe(res);
});

app.post('/api/audit/draft', (req, res) => {
    try {
        const { plant, auditItems, storeName, auditorName } = req.body;
        const db = JSON.parse(fs.readFileSync(DB_PATH));
        db.audit_records[plant] = auditItems;
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        const fileName = writeReportFile(plant, auditItems);

        sendTelegramNotification(
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
        const db = JSON.parse(fs.readFileSync(DB_PATH));

        const now = new Date();
        const currentDate = now.toLocaleString('fa-IR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const auditMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const auditor = auditorName || 'کارشناس IT';
        const existing = db.plant_status[plant] || {};
        const history = existing.history || [];
        history.push({
            date: currentDate,
            month: auditMonth,
            auditor: auditor,
            equipmentCount: Object.keys(auditItems).length,
            missingCount: Object.values(auditItems).filter(i => i.status === 'missing').length
        });

        db.audit_records[plant] = auditItems;
        db.plant_status[plant] = {
            isLocked: true,
            auditDate: currentDate,
            lastMonth: auditMonth,
            auditor: auditor,
            history: history
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

        const fileName = writeReportFile(plant, auditItems);
        const reportPath = path.join(REPORTS_DIR, fileName);

        const mailOptions = {
            from: '"سامانه انبارگردانی هفت" <audit-system@haftstores.ir>',
            to: managerEmail || 'manager@haftstores.ir',
            subject: `گزارش انبارگردانی نهایی - فروشگاه ${plant} (${storeName})`,
            html: `
                <div dir="rtl" style="font-family: Tahoma, sans-serif; padding: 20px; background-color: #f4f4f4;">
                    <h2 style="color: #d97706;">گزارش انبارگردانی تجهیزات انفورماتیک</h2>
                    <p><b>کد فروشگاه:</b> ${plant}</p>
                    <p><b>نام فروشگاه:</b> ${storeName}</p>
                    <p><b>تاریخ ثبت:</b> ${currentDate}</p>
                    <p><b>ماه انبارگردانی:</b> ${auditMonth}</p>
                    <p><b>انبارگردان:</b> ${auditor}</p>
                    <hr>
                    <p>فایل کامل گزارش به این ایمیل پیوست شده است.</p>
                </div>
            `,
            attachments: [{ filename: fileName, path: reportPath }]
        };
        try {
            await transporter.sendMail(mailOptions);
        } catch (mailErr) {
            // خطای ایمیل نباید مانع ثبت انبارگردانی و نوتیفیکیشن شود
            console.error('Mail Error:', mailErr.message);
        }

        sendTelegramNotification(
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
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'خطا در ثبت نهایی یا ارسال ایمیل.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
