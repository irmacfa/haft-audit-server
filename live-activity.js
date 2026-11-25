/**
 * ردیابی زنده فعالیت انبارگردانها (فروشگاه در حال انبارگردانی + مدت زمان صرفشده).
 * دادهها در db/live_activity.json ذخیره میشوند تا سرور کاربر (2030) آن را بنویسد
 * و سرور_admin (2031) همان را بخواند. رکوردهای قدیمیتر از ۲ دقیقه بیهوش حذف میشوند.
 */
const fs = require('fs');
const path = require('path');

// ACTIVITY_FILE به تستها اجازه میدهد از فایل موقتی استفاده کنند و داده زنده سرور دست نخورده بماند.
const FILE_PATH = process.env.ACTIVITY_FILE
    ? path.resolve(process.env.ACTIVITY_FILE)
    : path.join(__dirname, 'db', 'live_activity.json');
const STALE_MS = 2 * 60 * 1000;

function readAll() {
    try {
        const value = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) {
        return {};
    }
}

function writeAll(all) {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(all, null, 2));
}

function keyOf(session) {
    return String((session && session.u) || '').trim().toLowerCase();
}

function getActiveByPlant(plant, excludeUsername) {
    const p = String(plant || '').trim();
    const ex = String(excludeUsername || '').trim().toLowerCase();
    if (!p) return null;
    const active = list();
    return active.find(rec => String(rec.plant || '').trim() === p && String(rec.username || '').toLowerCase() !== ex) || null;
}

/** رکورد فعال خود کاربر (اختیاری محدود به یک فروشگاه)؛ رکوردهای منقضی قبل از جستجو پاک میشوند. */
function getActiveFor(session, plant) {
    const key = keyOf(session);
    if (!key) return null;
    const p = plant == null ? null : String(plant).trim();
    return list().find(rec =>
        String(rec.username || '').toLowerCase() === key &&
        (!p || String(rec.plant || '').trim() === p)
    ) || null;
}

function start(session, plant, storeName) {
    const key = keyOf(session);
    if (!key) return { ok: false, error: 'نشست نامعتبر است.' };
    const p = String(plant || '').trim();
    const conflict = getActiveByPlant(p, key);
    if (conflict) {
        return {
            ok: false,
            conflict: true,
            active: {
                username: conflict.username,
                displayName: conflict.displayName || conflict.username,
                plant: conflict.plant,
                storeName: conflict.storeName,
                startedAt: conflict.startedAt,
                lastSeen: conflict.lastSeen
            }
        };
    }
    const all = readAll();
    const now = Date.now();
    const previous = all[key];
    all[key] = {
        username: key,
        displayName: (session && session.n) || key,
        plant: p,
        storeName: String(storeName || ''),
        startedAt: (previous && previous.plant === p) ? previous.startedAt : now,
        lastSeen: now,
        checked: 0,
        total: 0
    };
    writeAll(all);
    return { ok: true, activity: all[key] };
}

function heartbeat(session, plant, checked, total) {
    const key = keyOf(session);
    if (!key) return false;
    const all = readAll();
    const rec = all[key];
    if (!rec) return false;
    rec.lastSeen = Date.now();
    if (plant && rec.plant === String(plant)) {
        if (Number.isFinite(Number(checked))) rec.checked = Number(checked);
        if (Number.isFinite(Number(total))) rec.total = Number(total);
    }
    writeAll(all);
    return true;
}

function stop(session) {
    const key = keyOf(session);
    if (!key) return;
    const all = readAll();
    if (all[key]) {
        delete all[key];
        writeAll(all);
    }
}

function list() {
    const all = readAll();
    const now = Date.now();
    let changed = false;
    const active = [];
    Object.keys(all).forEach(key => {
        const rec = all[key];
        if (!rec || now - Number(rec.lastSeen || 0) > STALE_MS) {
            delete all[key];
            changed = true;
            return;
        }
        const elapsedSeconds = Math.max(0, Math.round((now - Number(rec.startedAt || now)) / 1000));
        const progress = rec.total > 0 ? Math.round((rec.checked / rec.total) * 100) : 0;
        active.push({ ...rec, elapsedSeconds, progress });
    });
    if (changed) writeAll(all);
    return active.sort((a, b) => a.startedAt - b.startedAt);
}

module.exports = { start, heartbeat, stop, list, getActiveByPlant, getActiveFor };
