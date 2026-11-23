/**
 * کاربران محلی برای اجرای آفلاین (بدون اکتیو دایرکتوری)
 * رمزها با scrypt و نمک تصادفی ذخیره میشوند. فایل db/local_users.json در .gitignore است.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_PATH = process.env.LOCAL_USERS_PATH
    ? path.resolve(process.env.LOCAL_USERS_PATH)
    : path.join(__dirname, 'db', 'local_users.json');

const DEFAULT_ADMIN_USER = process.env.LOCAL_ADMIN_USER || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || 'admin123';

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
    try {
        const actual = crypto.scryptSync(String(password), parts[1], 64);
        const expected = Buffer.from(parts[2], 'hex');
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (_) {
        return false;
    }
}

function writeStore(store) {
    const dir = path.dirname(USERS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function seedStore() {
    const store = {
        users: [{
            username: normalizeUsername(DEFAULT_ADMIN_USER),
            displayName: 'مدیر سامانه',
            mail: '',
            admin: true,
            passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD)
        }]
    };
    writeStore(store);
    if (!process.env.LOCAL_ADMIN_PASSWORD) {
        console.warn(`[LocalUsers] Default admin account created: ${DEFAULT_ADMIN_USER} / ${DEFAULT_ADMIN_PASSWORD}`);
        console.warn('[LocalUsers] Change the password with: npm run create-user -- <username> <password>');
    }
    return store;
}

function readStore() {
    try {
        const parsed = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
        if (parsed && Array.isArray(parsed.users)) return parsed;
    } catch (e) {
        if (e.code !== 'ENOENT') console.error('[LocalUsers] Could not read the users file:', e.message);
    }
    return null;
}

function getStore() {
    return readStore() || seedStore();
}

function publicUser(user) {
    return {
        username: user.username,
        displayName: user.displayName || user.username,
        mail: user.mail || '',
        admin: user.admin === true
    };
}

function findRaw(username) {
    const key = normalizeUsername(username);
    return getStore().users.find(u => normalizeUsername(u.username) === key) || null;
}

function listUsers() {
    return getStore().users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
}

function authenticate(username, password) {
    const user = findRaw(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        throw Object.assign(new Error('نام کاربری یا رمز عبور اشتباه است.'), { code: 'INVALID_CREDENTIALS' });
    }
    return { ...publicUser(user), dn: 'LOCAL' };
}

// فقط حسابهای دارای پرچم admin بهعنوان کاربر محلی پذیرفته میشوند؛ بقیه باید از اکتیو دایرکتوری بیایند.
function authenticateAdmin(username, password) {
    const user = findRaw(username);
    if (!user || user.admin !== true) return null;
    if (!verifyPassword(password, user.passwordHash)) {
        throw Object.assign(new Error('نام کاربری یا رمز عبور اشتباه است.'), { code: 'INVALID_CREDENTIALS' });
    }
    return { ...publicUser(user), dn: 'LOCAL' };
}

function upsertUser({ username, password, displayName, mail, admin } = {}) {
    const key = normalizeUsername(username);
    if (!key) throw new Error('نام کاربری الزامی است.');
    if (admin !== true && admin !== false && admin != null) throw new Error('مقدار admin نامعتبر است.');

    const store = getStore();
    const existing = store.users.find(u => normalizeUsername(u.username) === key);
    if (existing) {
        if (password) existing.passwordHash = hashPassword(password);
        if (displayName) existing.displayName = String(displayName).trim();
        if (mail != null) existing.mail = String(mail).trim();
        if (typeof admin === 'boolean') existing.admin = admin;
    } else {
        if (!password) throw new Error('برای کاربر تازه رمز عبور الزامی است.');
        store.users.push({
            username: key,
            displayName: String(displayName || key).trim(),
            mail: String(mail || '').trim(),
            admin: admin === true,
            passwordHash: hashPassword(password)
        });
    }
    writeStore(store);
    return publicUser(store.users.find(u => normalizeUsername(u.username) === key));
}

function removeUser(username) {
    const store = getStore();
    const key = normalizeUsername(username);
    const target = store.users.find(u => normalizeUsername(u.username) === key);
    if (!target) throw new Error('کاربر یافت نشد.');
    if (target.admin && store.users.filter(u => u.admin).length === 1) {
        throw new Error('نمیتوان تنها حساب مدیر را حذف کرد.');
    }
    store.users = store.users.filter(u => normalizeUsername(u.username) !== key);
    writeStore(store);
    return { success: true, username: key };
}

module.exports = {
    USERS_PATH,
    listUsers,
    authenticate,
    authenticateAdmin,
    upsertUser,
    removeUser,
    hashPassword,
    verifyPassword
};
