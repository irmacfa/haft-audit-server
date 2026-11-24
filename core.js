const path = require('path');
const fs = require('fs');
const https = require('https');
const { Worker } = require('worker_threads');
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

// ===================== کش داده‌ها + وضعیت پیشرفت =====================
let _stores = null;
let _equipment = null;
let _masterColumns = null;
let _settings = null;
let _cachePromise = null;
let _cacheProgress = { state: 'idle', percent: 0, message: 'کش آماده نیست', detail: '', ready: false, error: null, updatedAt: Date.now() };

function setCacheProgress(patch) {
    _cacheProgress = { ..._cacheProgress, ...patch, updatedAt: Date.now() };
}

function getCacheProgress() {
    return { ..._cacheProgress, ready: !!_equipment };
}

function invalidateCache() {
    _stores = null;
    _equipment = null;
    _masterColumns = null;
    _settings = null;
    _cachePromise = null;
    setCacheProgress({ state: 'idle', percent: 0, message: 'کش پاک شد، نیاز به بارگذاری مجدد', detail: '', ready: false, error: null });
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

function normalizeColumn(c) {
    if (c && typeof c === 'object' && !Array.isArray(c)) {
        const key = String(c.key || c.name || c.column || '').trim();
        const label = String(c.label || c.title || key).trim();
        return key ? { key, label: label || key } : null;
    }
    const key = String(c || '').trim();
    return key ? { key, label: key } : null;
}

function normalizeColumns(cols, fallback = []) {
    const src = Array.isArray(cols) && cols.length ? cols : fallback;
    const out = [];
    const seen = new Set();
    for (const c of src) {
        const n = normalizeColumn(c);
        if (!n || seen.has(n.key)) continue;
        seen.add(n.key);
        out.push(n);
    }
    return out;
}

function getEffectiveSettings() {
    const s = getSettings();
    return {
        plantColumn: s.plantColumn || DEFAULT_SETTINGS.plantColumn,
        nameColumn: s.nameColumn || DEFAULT_SETTINGS.nameColumn,
        materialColumn: s.materialColumn || DEFAULT_SETTINGS.materialColumn,
        materialPrefix: s.materialPrefix || DEFAULT_SETTINGS.materialPrefix,
        columns: normalizeColumns(s.columns, DEFAULT_SETTINGS.columns),
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
    const incoming = { ...(settings || {}) };
    if (incoming.columns !== undefined) incoming.columns = normalizeColumns(incoming.columns, DEFAULT_SETTINGS.columns);
    // حفظ مناطق در صورتی که تنظیمات ستونها به تنهایی ذخیره شود
    db.settings = { ...(db.settings || {}), ...incoming };
    if (!Array.isArray(db.settings.regions) || !db.settings.regions.length) {
        db.settings.regions = DEFAULT_SETTINGS.regions;
    }
    writeDb(db);
    invalidateCache();
    _settings = db.settings;
    return getEffectiveSettings();
}

function ensureMasterCache(force = false) {
    if (_equipment && !force) {
        setCacheProgress({ state: 'ready', percent: 100, message: 'کش آماده است', detail: `${_equipment.total} تجهیز`, ready: true, error: null });
        return Promise.resolve({ stores: _stores, columns: getDisplayColumns(), equipment: _equipment });
    }
    if (_cachePromise && !force) return _cachePromise;

    const excelPath = getExcelPath();
    if (!fs.existsSync(excelPath)) {
        const err = new Error('فایل مادر یافت نشد.');
        err.consoleMessage = 'Master file not found.';
        setCacheProgress({ state: 'error', percent: 0, message: err.message, detail: '', ready: false, error: err.message });
        return Promise.reject(err);
    }

    const settings = getEffectiveSettings();
    setCacheProgress({ state: 'loading', percent: 1, message: 'در حال آماده‌سازی پردازش فایل مادر...', detail: path.basename(excelPath), ready: false, error: null });

    _cachePromise = new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'cache-worker.js'), {
            workerData: { excelPath, settings }
        });

        worker.on('message', (msg) => {
            if (msg.type === 'progress') {
                setCacheProgress({
                    state: 'loading',
                    percent: Math.max(1, Math.min(99, Number(msg.percent) || 1)),
                    message: msg.message || 'در حال پردازش...',
                    detail: msg.detail || '',
                    ready: false,
                    error: null
                });
                return;
            }
            if (msg.type === 'result') {
                _stores = msg.stores;
                _masterColumns = msg.columns;
                _equipment = msg.equipment;
                updateMasterFileMeta({
                    columns: _masterColumns,
                    columnCount: _masterColumns.length,
                    storeCount: Object.keys(_stores).length,
                    equipmentCount: _equipment.total,
                    processing: false
                });
                setCacheProgress({ state: 'ready', percent: 100, message: 'کش آماده است', detail: `${_equipment.total} تجهیز در ${Object.keys(_stores).length} فروشگاه`, ready: true, error: null });
                console.log('[Cache] Ready:', _equipment.total, 'rows');
                resolve({ stores: _stores, columns: getDisplayColumns(), equipment: _equipment });
                return;
            }
            if (msg.type === 'error') {
                const err = new Error(msg.error || 'خطا در پردازش فایل مادر');
                err.consoleMessage = 'Master file processing failed.';
                setCacheProgress({ state: 'error', percent: 0, message: err.message, detail: '', ready: false, error: err.message });
                reject(err);
            }
        });

        worker.on('error', (err) => {
            setCacheProgress({ state: 'error', percent: 0, message: err.message, detail: '', ready: false, error: err.message });
            reject(err);
        });

        worker.on('exit', (code) => {
            if (code !== 0 && !_equipment) {
                const err = new Error(`پردازش فایل مادر با کد ${code} متوقف شد`);
                err.consoleMessage = `Master file processing exited with code ${code}.`;
                setCacheProgress({ state: 'error', percent: 0, message: err.message, detail: '', ready: false, error: err.message });
                reject(err);
            }
        });
    }).finally(() => {
        if (_equipment) _cachePromise = Promise.resolve({ stores: _stores, columns: getDisplayColumns(), equipment: _equipment });
        else _cachePromise = null;
    });

    return _cachePromise;
}

function getDisplayColumns() {
    return getEffectiveSettings().columns;
}

function getMasterColumns() {
    if (_masterColumns) return _masterColumns;
    if (_cacheProgress.state === 'loading') throw Object.assign(new Error('CACHE_LOADING'), { code: 'CACHE_LOADING' });
    // fallback sync for rare admin paths
    const wb = XLSX.readFile(getExcelPath());
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    _masterColumns = firstRow.filter(h => h && String(h).trim());
    return _masterColumns;
}

function getStores() {
    if (_stores) return _stores;
    if (_cacheProgress.state === 'loading') throw Object.assign(new Error('CACHE_LOADING'), { code: 'CACHE_LOADING' });
    ensureMasterCache();
    throw Object.assign(new Error('CACHE_LOADING'), { code: 'CACHE_LOADING' });
}

function getEquipmentData() {
    if (_equipment) return _equipment;
    if (_cacheProgress.state === 'loading') throw Object.assign(new Error('CACHE_LOADING'), { code: 'CACHE_LOADING' });
    ensureMasterCache();
    throw Object.assign(new Error('CACHE_LOADING'), { code: 'CACHE_LOADING' });
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
        workbookCached: !!_equipment,
        storesCached: !!_stores,
        equipmentCached: !!_equipment,
        storeCount: _stores ? Object.keys(_stores).length : null,
        equipmentCount: _equipment ? _equipment.total : null,
        progress: getCacheProgress()
    };
}

// ===================== متادیتای فایل مادر آپلودشده =====================
// این اطلاعات در db/audit_db.json ذخیره میشوند تا بعد از استارت مجدد سرور هم نمایش داده شوند.
function updateMasterFileMeta(patch) {
    try {
        const db = readDb();
        db.masterFile = { ...(db.masterFile || {}), ...(patch || {}), updatedAt: new Date().toISOString() };
        writeDb(db);
    } catch (e) {
        console.error('[Master meta]', e.message);
    }
}

function getMasterFileMeta() {
    const saved = readDb().masterFile || {};
    const columns = (_masterColumns && _masterColumns.length)
        ? _masterColumns
        : (Array.isArray(saved.columns) ? saved.columns : []);
    const masterPath = getExcelPath();
    const masterExists = fs.existsSync(masterPath);
    let fileSize = null;
    let fileModifiedAt = null;
    try {
        const stat = fs.statSync(masterPath);
        fileSize = stat.size;
        fileModifiedAt = stat.mtime.toISOString();
    } catch (e) { /* فایل مادر هنوز آپلود نشده است */ }
    return {
        originalName: masterExists ? path.basename(masterPath) : '',
        extension: masterExists ? path.extname(masterPath).slice(1).toUpperCase() : '',
        mimeType: '',
        sizeBytes: null,
        ...saved,
        columns,
        columnCount: columns.length,
        fileSize,
        fileModifiedAt,
        masterReady: masterExists,
        cached: !!_equipment,
        storeCount: _stores ? Object.keys(_stores).length : null,
        equipmentCount: _equipment ? _equipment.total : null
    };
}

function saveMasterFileMeta(meta) {
    updateMasterFileMeta({ ...(meta || {}), processing: true, columns: [], columnCount: 0, uploadedAt: new Date().toISOString() });
    return getMasterFileMeta();
}

module.exports = {
    DATA_DIR, MASTER_PATH, LEGACY_EXCEL_PATH, DB_PATH, REPORTS_DIR, DEFAULT_SETTINGS,
    invalidateCache, ensureMasterCache, getExcelPath, readDb, writeDb,
    getSettings, getEffectiveSettings, saveSettings, getRegion,
    getMasterColumns, getDisplayColumns, getStores, getEquipmentData,
    writeReportFile, sendTelegramNotification, getCacheStatus, getCacheProgress,
    getMasterFileMeta, saveMasterFileMeta
};
