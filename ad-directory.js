/**
 * لیست اعضای گروه IT از اکتیو دایرکتوری + ذخیره لینک اعضا به مناطق برنامه
 * اتصال با حساب دامنهای است که سرویس تحت آن اجرا میشود (نیاز به رمز جداگانه ندارد).
 * هیچ تغییری در گروههای اکتیو دایرکتوری ایجاد نمیشود؛ لینکها فقط داخل برنامه ذخیره میشوند.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GROUP = process.env.LDAP_ALLOWED_GROUP || 'Oshanak-ITSUP';
const LINKS_PATH = path.join(__dirname, 'db', 'region_members.json');
const CACHE_MS = 5 * 60 * 1000;

let membersCache = { at: 0, data: [] };

function normalizeList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function listMembers() {
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
                    console.error('[AD Members] پاسخ نامعتبر', e.message);
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
}

module.exports = { GROUP, listMembers, getLinks, setLink, invalidate };
