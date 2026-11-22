/**
 * ردیابی زنده فعالیت انبارگردانها (فروشگاه در حال انبارگردانی + مدت زمان صرفشده).
 * دادهها در db/live_activity.json ذخیره میشوند تا سرور کاربر (2030) آن را بنویسد
 * و سرور_admin (2031) همان را بخواند. رکوردهای قدیمیتر از ۲ دقیقه بیهوش حذف میشوند.
 */
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'db', 'live_activity.json');
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

function start(session, plant, storeName) {
    const key = keyOf(session);
    if (!key) return null;
    const all = readAll();
    const now = Date.now();
    const previous = all[key];
    all[key] = {
        username: key,
        displayName: (session && session.n) || key,
        plant: String(plant || ''),
        storeName: String(storeName || ''),
        startedAt: (previous && previous.plant === String(plant || '')) ? previous.startedAt : now,
        lastSeen: now,
        checked: 0,
        total: 0
    };
    writeAll(all);
    return all[key];
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

module.exports = { start, heartbeat, stop, list };
