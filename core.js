const path = require('path');
const fs = require('fs');
const https = require('https');
const XLSX = require('xlsx');

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

// ===================== کش数据进行 =====================
let _workbook = null;
let _stores = null;
let _equipment = null;
let _settings = null;

function invalidateCache() {
    _workbook = null;
    _stores = null;
    _equipment = null;
    _settings = null;
    console.log('[Cache] Cleared.');
}

function getExcelPath() {
    return fs.existsSync(MASTER_PATH) ? MASTER_PATH : LEGACY_EXCEL_PATH;
}

function readDb() {
    return JSON.parse(fs.readFileSync(DB_PATH));
}

function writeDb(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const DEFAULT_SETTINGS = {
    plantColumn: 'پلنت محل تجهیز',
    nameColumn: 'شرح مرکز هزینه تجهیز',
    materialColumn: 'شماره متریال تجهیز',
    materialPrefix: '9000',
    columns: ['شرح کارت دارایی', 'شماره اموال تجهیز', 'شماره سریال کارت دارایی'],
    regions: [
        { name: 'تهران', ranges: [[1000, 1499], [7000, 7099]] },
        { name: 'گیلان', ranges: [[2000, 2200], [5500, 5599]] },
        { name: 'مازندران', ranges: [[2500, 2600]] },
        { name: 'همدان', ranges: [[3000, 3200]] },
        { name: 'کرمانشاه', ranges: [[3500, 3600], [8500, 8599]] },
        { name: 'مشهد', ranges: [[4000, 4099]] },
        { name: 'کرمان', ranges: [[5000, 5099], [8000, 8099]] }
    ]
};

function getSettings() {
    if (_settings) return _settings;
    _settings = readDb().settings || {};
    return _settings;
}

function getEffectiveSettings() {
    const s = getSettings();
    return {
        plantColumn: s.plantColumn || DEFAULT_SETTINGS.plantColumn,
        nameColumn: s.nameColumn || DEFAULT_SETTINGS.nameColumn,
        materialColumn: s.materialColumn || DEFAULT_SETTINGS.materialColumn,
        materialPrefix: s.materialPrefix || DEFAULT_SETTINGS.materialPrefix,
        columns: Array.isArray(s.columns) && s.columns.length ? s.columns : DEFAULT_SETTINGS.columns,
        regions: Array.isArray(s.regions) && s.regions.length ? s.regions : DEFAULT_SETTINGS.regions
    };
}

// تعیین منطقه بر اساس کد فروشگاه
function getRegion(plant) {
    const code = Number(String(plant).replace(/\D/g, ''));
    const regions = getEffectiveSettings().regions;
    const region = regions.find(r => {
        if (Array.isArray(r.ranges)) {
            return r.ranges.some(([from, to]) => code >= from && code <= to);
        }
        return code >= r.from && code <= r.to;
    });
    return region ? region.name : 'سایر';
}

function saveSettings(settings) {
    const db = readDb();
    // حفظ مناطق در صورتی که تنظیمات ستونها به تنهایی ذخیره شود
    db.settings = { ...(db.settings || {}), ...settings };
    if (!Array.isArray(db.settings.regions) || !db.settings.regions.length) {
        db.settings.regions = DEFAULT_SETTINGS.regions;
    }
    writeDb(db);
    invalidateCache();
    _settings = db.settings;
    return getEffectiveSettings();
}

// خواندن اکسل یک بار و نگه داشتن در حافظه
function getWorkbook() {
    if (_workbook) return _workbook;
    const t = Date.now();
    _workbook = XLSX.readFile(getExcelPath());
    console.log('[Cache] Workbook loaded in', Date.now() - t, 'ms');
    return _workbook;
}

function getMasterColumns() {
    const sheet = getWorkbook().Sheets[getWorkbook().SheetNames[0]];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const cols = firstRow.filter(h => h && String(h).trim());
    // اگر فایل/setup دوم ستون کمتری داشت، از برگه دوم هم اضافه کن
    if (cols.length < 10 && getWorkbook().SheetNames.length > 1) {
        const sheet2 = getWorkbook().Sheets[getWorkbook().SheetNames[1]];
        const row2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 })[0] || [];
        row2.forEach(h => { if (h && String(h).trim() && !cols.includes(h)) cols.push(h); });
    }
    return cols;
}

function cleanExcelCode(code) {
    if (!code || code === '-') return '-';
    return String(code).replace(/[-–\s]/g, '').trim();
}

// لیست فروشگاهها (کش شده)
function getStores() {
    if (_stores) return _stores;
    const settings = getEffectiveSettings();
    const wb = getWorkbook();
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headers = raw[0];
    const pIdx = headers.indexOf(settings.plantColumn);
    const nIdx = headers.indexOf(settings.nameColumn);
    const stores = {};
    for (let i = 1; i < raw.length; i++) {
        const row = raw[i];
        const plant = pIdx >= 0 && row[pIdx] ? String(row[pIdx]).trim() : null;
        if (plant && plant !== 'Equipment Maintenance Plant') {
            stores[plant] = nIdx >= 0 && row[nIdx] ? String(row[nIdx]).trim() : 'نامشخص';
        }
    }
    _stores = stores;
    return stores;
}

// تجهیزات سری متریال (کش شده)
function getEquipmentData() {
    if (_equipment) return _equipment;
    const settings = getEffectiveSettings();
    const wb = getWorkbook();
    const dataRows = [];
    const seen = new Set();

    wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (raw.length < 2) return;
        const headers = raw[0];
        const mIdx = headers.indexOf(settings.materialColumn);
        const pIdx = headers.indexOf(settings.plantColumn);
        const nIdx = headers.indexOf(settings.nameColumn);

        for (let i = 1; i < raw.length; i++) {
            const row = raw[i];
            const material = mIdx >= 0 ? String(row[mIdx] || '') : '';
            if (!material.startsWith(settings.materialPrefix)) continue;

            const plant = pIdx >= 0 ? String(row[pIdx] || '').trim() : '';
            const storeName = nIdx >= 0 ? String(row[nIdx] || '').trim() : `فروشگاه ${plant}`;
            const allValues = {};
            headers.forEach((h, idx) => {
                if (h) allValues[h] = row[idx] === undefined || row[idx] === null ? '' : String(row[idx]);
            });
            // فقط ستونهای انتخابشده را به کلاینت میفرستیم (کاهش حجم پاسخ)
            const fields = {};
            settings.columns.forEach(c => { fields[c] = allValues[c] !== undefined ? allValues[c] : ''; });

            // کلید پایدار بدون شماره ردیف تا ردیفهای تکراری واقعاً حذف شوند
            const uniqueKey = `${plant}_${allValues['شماره اموال تجهیز'] || ''}_${allValues['شماره سریال کارت دارایی'] || ''}_${allValues['شماره تجهیز'] || ''}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);

            dataRows.push({
                plant,
                storeName,
                eqId: allValues['شماره تجهیز'] || '',
                desc: allValues['شرح کارت دارایی'] || allValues['شرح تجهیز'] || 'بدون شرح',
                assetNo: cleanExcelCode(allValues['شماره اموال تجهیز'] || '-'),
                serial: cleanExcelCode(allValues['شماره سریال کارت دارایی'] || '-'),
                fields
            });
        }
    });

    _equipment = { total: dataRows.length, columns: settings.columns, data: dataRows };
    return _equipment;
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

// وضعیت کش و فایل مادر (برای endpoint سلامت سرور)
function getCacheStatus() {
    const fsAvailable = require('fs').existsSync(getExcelPath());
    return {
        masterFile: getExcelPath(),
        masterFileReady: fsAvailable,
        workbookCached: !!_workbook,
        storesCached: !!_stores,
        equipmentCached: !!_equipment,
        storeCount: _stores ? Object.keys(_stores).length : null,
        equipmentCount: _equipment ? _equipment.total : null
    };
}

module.exports = {
    DATA_DIR, MASTER_PATH, LEGACY_EXCEL_PATH, DB_PATH, REPORTS_DIR,
    invalidateCache, getExcelPath, readDb, writeDb,
    getSettings, getEffectiveSettings, saveSettings, getRegion,
    getWorkbook, getMasterColumns, getStores, getEquipmentData,
    writeReportFile, sendTelegramNotification, getCacheStatus
};
