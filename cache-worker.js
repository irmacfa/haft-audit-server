const { parentPort, workerData } = require('worker_threads');
const XLSX = require('xlsx');

function cleanExcelCode(code) {
    if (!code || code === '-') return '-';
    return String(code).replace(/[-–\s]/g, '').trim();
}

function post(percent, message, detail) {
    parentPort.postMessage({ type: 'progress', percent, message, detail: detail || '' });
}

try {
    const { excelPath, settings } = workerData;
    post(2, 'شروع بارگذاری فایل مادر...', '');

    // XLSX.readFile سینک است؛ درصد مرحله‌ای گزارش می‌دهیم
    post(8, 'در حال خواندن فایل اکسل...', excelPath);
    const wb = XLSX.readFile(excelPath);
    post(45, 'فایل اکسل خوانده شد. در حال پردازش برگه‌ها...', `${wb.SheetNames.length} برگه`);

    // ستون‌ها
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const firstRaw = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    const firstRow = firstRaw[0] || [];
    const columns = firstRow.filter(h => h && String(h).trim());
    if (columns.length < 10 && wb.SheetNames.length > 1) {
        const sheet2 = wb.Sheets[wb.SheetNames[1]];
        const row2 = (XLSX.utils.sheet_to_json(sheet2, { header: 1 })[0] || []);
        row2.forEach(h => { if (h && String(h).trim() && !columns.includes(h)) columns.push(h); });
    }

    // فروشگاه‌ها
    const pIdx = firstRow.indexOf(settings.plantColumn);
    const nIdx = firstRow.indexOf(settings.nameColumn);
    const stores = {};
    for (let i = 1; i < firstRaw.length; i++) {
        const row = firstRaw[i];
        const plant = pIdx >= 0 && row[pIdx] ? String(row[pIdx]).trim() : null;
        if (plant && plant !== 'Equipment Maintenance Plant') {
            stores[plant] = nIdx >= 0 && row[nIdx] ? String(row[nIdx]).trim() : 'نامشخص';
        }
    }
    post(55, 'فروشگاه‌ها استخراج شدند.', `${Object.keys(stores).length} فروشگاه`);

    // تجهیزات
    const dataRows = [];
    const seen = new Set();
    const totalSheets = wb.SheetNames.length || 1;

    wb.SheetNames.forEach((sheetName, si) => {
        const sheet = wb.Sheets[sheetName];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (raw.length < 2) return;
        const headers = raw[0];
        const mIdx = headers.indexOf(settings.materialColumn);
        const pIdx2 = headers.indexOf(settings.plantColumn);
        const nIdx2 = headers.indexOf(settings.nameColumn);

        for (let i = 1; i < raw.length; i++) {
            const row = raw[i];
            const material = mIdx >= 0 ? String(row[mIdx] || '') : '';
            if (!material.startsWith(settings.materialPrefix)) continue;

            const plant = pIdx2 >= 0 ? String(row[pIdx2] || '').trim() : '';
            const storeName = nIdx2 >= 0 ? String(row[nIdx2] || '').trim() : `فروشگاه ${plant}`;
            const allValues = {};
            headers.forEach((h, idx) => {
                if (h) allValues[h] = row[idx] === undefined || row[idx] === null ? '' : String(row[idx]);
            });
            const fields = {};
            const columnDefs = (Array.isArray(settings.columns) ? settings.columns : [])
                .map(c => (c && typeof c === 'object') ? String(c.key || '').trim() : String(c || '').trim())
                .filter(Boolean);
            columnDefs.forEach(c => { fields[c] = allValues[c] !== undefined ? allValues[c] : ''; });

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

        const pct = 55 + Math.round(((si + 1) / totalSheets) * 40);
        post(Math.min(pct, 95), 'در حال پردازش تجهیزات...', `برگه ${si + 1}/${totalSheets} — ${dataRows.length} تجهیز`);
    });

    post(98, 'نهایی‌سازی کش...', `${dataRows.length} تجهیز`);
    parentPort.postMessage({
        type: 'result',
        stores,
        columns,
        equipment: { total: dataRows.length, data: dataRows }
    });
} catch (err) {
    parentPort.postMessage({ type: 'error', error: err.message || String(err) });
}
