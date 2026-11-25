/**
 * لیست اعضای گروه IT از اکتیو دایرکتوری + ذخیره لینک اعضا به مناطق برنامه
 * اتصال با حساب دامنهای است که سرویس تحت آن اجرا میشود (نیاز به رمز جداگانه ندارد).
 * هیچ تغییری در گروههای اکتیو دایرکتوری ایجاد نمیشود؛ لینکها فقط داخل برنامه ذخیره میشوند.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const localUsers = require('./local-users');

const IS_LOCAL = (process.env.AUTH_MODE || 'ldap').toLowerCase() === 'local';
const GROUP = process.env.LDAP_ALLOWED_GROUP || 'Oshanak-ITSUP';
const LINKS_PATH = path.join(__dirname, 'db', 'region_members.json');
const CACHE_MS = 5 * 60 * 1000;
// مقدار ویژه «دسترسی کل منطقه»: کاربر تمام فروشگاهها را میبیند
const ALL_REGIONS = '*';

let membersCache = { at: 0, data: [] };
let groupMailCache = { at: 0, value: '' };

function getGroupMail() {
    const envTo = String(process.env.AUDIT_NOTIFY_TO || '').trim();
    if (envTo) return Promise.resolve(envTo);

    if (IS_LOCAL) return Promise.resolve('');

    if (Date.now() - groupMailCache.at < CACHE_MS && groupMailCache.value) {
        return Promise.resolve(groupMailCache.value);
    }

    const safeGroup = GROUP.replace(/'/g, "''");
    const ps = [
        'Import-Module ActiveDirectory; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
        `Get-ADGroup -Identity '${safeGroup}' -Properties mail,displayName | ` +
        'Select-Object mail,displayName | ConvertTo-Json -Compress -Depth 2'
    ];

    return new Promise((resolve) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps[0]],
            { timeout: 15000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    console.warn('[AD Group Mail]', err.message || err);
                    return resolve(groupMailCache.value || '');
                }
                try {
                    const raw = JSON.parse((stdout || '').toString().trim() || 'null');
                    const obj = Array.isArray(raw) ? raw[0] : raw;
                    const mail = String((obj && obj.mail) || '').trim();
                    groupMailCache = { at: Date.now(), value: mail };
                    resolve(mail);
                } catch (e) {
                    console.warn('[AD Group Mail] parse:', e.message);
                    resolve(groupMailCache.value || '');
                }
            });
    });
}

function normalizeList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function listMembers() {
    // فقط در حالت local فهرست کاربران از فایل local_users.json میآید.
    // در حالت پیشفرض hybrid لیست اعضا باید از اکتیو دایرکتوری خوانده شود.
    if (IS_LOCAL) return Promise.resolve(localUsers.listUsers());

    if (Date.now() - membersCache.at < CACHE_MS && membersCache.data.length) {
        return Promise.resolve(membersCache.data);
    }
    const safeGroup = String(GROUP).replace(/['"]/g, '');
    const ps = [
        'Import-Module ActiveDirectory',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
        `Get-ADGroupMember -Identity '${safeGroup}' -Recursive | Where-Object objectClass -eq 'user' | ` +
        'ForEach-Object { Get-ADUser $_.DistinguishedName -Properties displayName,mail,sAMAccountName | ' +
        'Select-Object sAMAccountName,displayName,mail } | ConvertTo-Json -Compress -Depth 3'
    ].join('; ');

    return new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
            (err, stdout, stderr) => {
                if (err) {
                    console.error('[AD Members]', err.message, String(stderr || '').slice(0, 300));
                    // در صورت خطا، آخرین لیست معتبر را برگردان
                    return resolve(membersCache.data);
                }
                try {
                    const raw = normalizeList(JSON.parse(stdout));
                    const data = raw.map(u => ({
                        username: String(u.sAMAccountName || '').trim(),
                        displayName: String(u.displayName || u.sAMAccountName || '').trim(),
                        mail: String(u.mail || '').trim()
                    })).filter(u => u.username).sort((a, b) => a.displayName.localeCompare(b.displayName));
                    membersCache = { at: Date.now(), data };
                    resolve(data);
                } catch (e) {
                    console.error('[AD Members] Invalid response', e.message);
                    resolve(membersCache.data);
                }
            });
    });
}

function readLinks() {
    try {
        return JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeLinks(links) {
    if (!fs.existsSync(path.dirname(LINKS_PATH))) fs.mkdirSync(path.dirname(LINKS_PATH), { recursive: true });
    fs.writeFileSync(LINKS_PATH, JSON.stringify(links, null, 2));
}

function getLinks() {
    return readLinks();
}

function getRegionsForUser(username) {
    const key = String(username || '').trim().toLowerCase();
    const value = readLinks()[key];
    return Array.isArray(value) ? value.slice() : [];
}

function setLink(username, region, assigned) {
    const user = String(username || '').trim().toLowerCase();
    const reg = String(region || '').trim();
    if (!user || !reg) throw Object.assign(new Error('کاربر و منطقه الزامی است.'), { code: 'MISSING_FIELDS' });
    const links = readLinks();
    if (!links[user]) links[user] = [];
    if (assigned) {
        if (!links[user].includes(reg)) links[user].push(reg);
    } else {
        links[user] = links[user].filter(r => r !== reg);
        if (!links[user].length) delete links[user];
    }
    writeLinks(links);
    return links;
}

function invalidate() {
    membersCache = { at: 0, data: [] };
    groupMailCache = { at: 0, value: '' };
}

module.exports = { GROUP, ALL_REGIONS, IS_LOCAL, listMembers, getGroupMail, getLinks, getRegionsForUser, setLink, invalidate };
