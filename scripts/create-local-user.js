#!/usr/bin/env node
/**
 * ساخت، ویرایش یا فهرست کردن کاربران محلی
 * در حالت پیشفرض hybrid فقط حسابهای --admin محلی پذیرفته میشوند؛ بقیه از دامین میآیند.
 * در حالت AUTH_MODE=local میشود کاربر عادی هم ساخت.
 *
 * نمونهها:
 *   npm run create-user -- admin R4ndomPass "مدیر سامانه" --admin
 *   npm run create-user -- --list
 */
const users = require('../local-users');

const args = process.argv.slice(2);
const list = args.includes('--list');
const admin = args.includes('--admin');
const positional = args.filter(a => a !== '--admin' && a !== '--list');

if (list) {
    console.log('کاربران محلی:');
    console.table(users.listUsers());
    process.exit(0);
}

const [username, password, displayName, mail] = positional;

if (!username || !password) {
    console.error('استفاده: npm run create-user -- <username> <password> [displayName] [mail] [--admin]');
    console.error('مثال:   npm run create-user -- admin MySecret123 "مدیر سامانه" --admin');
    process.exit(1);
}

try {
    const user = users.upsertUser({ username, password, displayName, mail, admin });
    console.log('کاربر ذخیره شد:', user);
    console.log('برای اعمال لینک مناطق، وارد پنل مدیریت شوید: اعضا و مناطق');
} catch (e) {
    console.error('خطا:', e.message);
    process.exit(1);
}
