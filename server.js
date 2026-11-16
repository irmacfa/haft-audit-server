const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EXCEL_PATH = path.join(__dirname, 'data', 'Copy of Book5.xlsx');
const DB_PATH = path.join(__dirname, 'db', 'audit_db.json');
const REPORTS_DIR = path.join(__dirname, 'public', 'reports');

if (!fs.existsSync(path.join(__dirname, 'db'))) {
    fs.mkdirSync(path.join(__dirname, 'db'));
}
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ audit_records: {}, plant_status: {} }));
}

const transporter = nodemailer.createTransport({
    host: 'mail.haftstores.ir',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function cleanExcelCode(code) {
    if (!code || code === '-') return '-';
    return String(code).replace(/[-–\s]/g, '').trim();
}

// ساخت داده‌های گزارش به صورت آرایه‌ای از اشیاء
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

// ساخت و ذخیره فایل اکسل گزارش
function writeReportFile(plant, auditItems) {
    const rows = buildReportRows(auditItems);
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'پیام': 'هنوز تجهیزی ثبت نشده است.' }]);
    ws['!dir'] = 'rtl';
    ws['!cols'] = [
        { wch: 45 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 16 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'گزارش انبارگردانی');
    const fileName = `Audit_Report_Store_${plant}.xlsx`;
    XLSX.writeFile(wb, path.join(REPORTS_DIR, fileName));
    return fileName;
}

// خواندن متریال‌های سری 9000، اسکن نام فروشگاه و حذف موارد تکراری
app.get('/api/equipment', (req, res) => {
    try {
        if (!fs.existsSync(EXCEL_PATH)) {
            return res.status(404).json({ error: 'فایل اکسل روی سرور یافت نشد!' });
        }

        const workbook = XLSX.readFile(EXCEL_PATH);
        let combinedRows = [];
        let seenItems = new Set();

        workbook.SheetNames.forEach((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonSheet = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonSheet.length > 1) {
                const headers = jsonSheet[0];
                for (let i = 1; i < jsonSheet.length; i++) {
                    const row = jsonSheet[i];
                    let rowObj = {};
                    headers.forEach((h, index) => {
                        rowObj[h] = row[index];
                    });

                    const materialNo = String(rowObj['شماره متریال تجهیز'] || rowObj['Equipment Material'] || '').trim();
                    if (!materialNo.startsWith('9000')) continue;

                    const eqId = String(rowObj['شماره تجهیز'] || rowObj['Equipment'] || '').trim();
                    const assetModelDesc = String(rowObj['شرح کارت دارایی'] || rowObj['Asset'] || rowObj['شرح تجهیز'] || rowObj['Equipment descript.'] || 'بدون شرح').trim();

                    let costCenterName = '';
                    const possibleKeys = [
                        'شرح مرکز هزینه تجهیز', 'شرح مرکز هزینه', 'مرکز هزینه',
                        'Cost Center Name', 'Cost Center', 'Store Name', 'نام فروشگاه', 'شرح پلنت'
                    ];

                    for (let key of possibleKeys) {
                        if (rowObj[key]) {
                            costCenterName = String(rowObj[key]).trim();
                            break;
                        }
                    }

                    if (!costCenterName) {
                        for (let k in rowObj) {
                            if (k.includes('مرکز') || k.includes('هزینه') || k.includes('Cost')) {
                                costCenterName = String(rowObj[k]).trim();
                                break;
                            }
                        }
                    }

                    const plantCode = String(rowObj['پلنت محل تجهیز'] || rowObj['Equipment Maintenance Plant'] || '').trim();
                    const finalStoreName = costCenterName || `فروشگاه ${plantCode}`;

                    const primaryAsset = cleanExcelCode(rowObj['شماره اموال تجهیز'] || rowObj['شماره اموال کارت دارایی'] || rowObj['Asset Inventory Number'] || '-');
                    const serialNo = cleanExcelCode(rowObj['شماره سریال کارت دارایی'] || rowObj['Asset Serial number'] || '-');

                    const uniqueKey = `${plantCode}_${primaryAsset}_${serialNo}`;

                    if (!seenItems.has(uniqueKey)) {
                        seenItems.add(uniqueKey);
                        combinedRows.push({
                            plant: plantCode,
                            storeName: finalStoreName,
                            eqId: eqId,
                            desc: assetModelDesc,
                            assetNo: primaryAsset,
                            serial: serialNo
                        });
                    }
                }
            }
        });

        combinedRows.sort((a, b) => a.desc.localeCompare(b.desc, 'fa'));
        res.json({ total: combinedRows.length, data: combinedRows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'خطا در پردازش فایل اکسل روی سرور' });
    }
});

app.get('/api/monitoring/status', (req, res) => {
    try {
        if (!fs.existsSync(EXCEL_PATH)) {
            return res.status(404).json({ error: 'فایل اکسل پیدا نشد' });
        }

        const db = JSON.parse(fs.readFileSync(DB_PATH));
        const workbook = XLSX.readFile(EXCEL_PATH);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const headers = rawData[0];
        const plantIdx = headers.indexOf('پلنت محل تجهیز');
        const storeIdx = headers.indexOf('شرح مرکز هزینه تجهیز');

        const stores = {};
        for (let i = 1; i < rawData.length; i++) {
            const row = rawData[i];
            const plant = row[plantIdx] ? String(row[plantIdx]).trim() : null;
            if (plant && plant !== 'Equipment Maintenance Plant') {
                stores[plant] = row[storeIdx] ? String(row[storeIdx]).trim() : 'نامشخص';
            }
        }

        const result = Object.keys(stores).map(plant => ({
            plant: plant,
            storeName: stores[plant],
            isLocked: db.plant_status[plant]?.isLocked || false,
            auditDate: db.plant_status[plant]?.auditDate || null,
            auditor: db.plant_status[plant]?.auditor || null
        }));

        res.json(result);
    } catch (e) {
        console.error("Monitoring Server Error:", e);
        res.status(500).json({ error: 'خطای سرور: ' + e.message });
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

// چک کردن وجود فایل گزارش
app.get('/api/audit/report-exists/:plant', (req, res) => {
    const filePath = path.join(REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    res.json({ exists: fs.existsSync(filePath) });
});

// دانلود فایل اکسل گزارش
app.get('/api/audit/download/:plant', (req, res) => {
    const filePath = path.join(REPORTS_DIR, `Audit_Report_Store_${req.params.plant}.xlsx`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'گزارشی برای این فروشگاه یافت نشد.' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Audit_Report_Store_${req.params.plant}.xlsx"`);
    fs.createReadStream(filePath).pipe(res);
});

app.post('/api/audit/draft', (req, res) => {
    try {
        const { plant, auditItems } = req.body;
        const db = JSON.parse(fs.readFileSync(DB_PATH));
        db.audit_records[plant] = auditItems;
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

        // ساخت فایل اکسل موقع ذخیره موقت
        const fileName = writeReportFile(plant, auditItems);

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

        const currentDate = new Date().toLocaleString('fa-IR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        db.audit_records[plant] = auditItems;
        db.plant_status[plant] = {
            isLocked: true,
            auditDate: currentDate,
            auditor: auditorName || 'کارشناس IT'
        };

        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

        // ساخت فایل اکسل نهایی
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
                    <p><b>انبارگردان:</b> ${auditorName || 'علی قنبری'}</p>
                    <hr>
                    <p>فایل کامل گزارش به این ایمیل پیوست شده است.</p>
                </div>
            `,
            attachments: [
                {
                    filename: fileName,
                    path: reportPath
                }
            ]
        };

        await transporter.sendMail(mailOptions);

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
