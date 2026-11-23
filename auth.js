/**
 * احراز هویت پنلهای انبارگردانی
 * حالت پیشفرض hybrid است: حساب مدیر از فایل محلی و سایر کاربران از اکتیو دایرکتوری میآیند.
 * AUTH_MODE=local یعنی همه کاربران محلی (برای ماشین کاملاً آفلاین) و AUTH_MODE=ldap یعنی همه از دامین.
 * نشست با کوکی امضاشده بین دو سرور (پورتهای پیشفرض 2030/2031) مشترک است.
 */
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
const localUsers = require('./local-users');

// hybrid (پیشفرض): مدیر محلی، کاربران عادی از اکتیو دایرکتوری
// local: همه محلی | ldap: همه از دامین
const AUTH_MODE = (process.env.AUTH_MODE || 'hybrid').toLowerCase();
const IS_LOCAL = AUTH_MODE === 'local';
const IS_HYBRID = AUTH_MODE === 'hybrid';

let LdapClient = null;
function getLdapClient() {
    if (!LdapClient) {
        try {
            LdapClient = require('ldapts').Client;
        } catch (_) {
            throw Object.assign(new Error('برای حالت ldap باید بسته ldapts نصب باشد.'), { code: 'LDAP_MODULE_MISSING' });
        }
    }
    return LdapClient;
}

const COOKIE_NAME = process.env.COOKIE_NAME || 'haft_session';
const SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-env';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LDAP_URL = process.env.LDAP_URL || 'ldaps://DC2.gbgnetwork.net:636';
const LDAP_DOMAIN = process.env.LDAP_DOMAIN || 'gbgnetwork.net';
const LDAP_BASE_DN = process.env.LDAP_BASE_DN || 'DC=gbgnetwork,DC=net';
const ALLOWED_GROUP = process.env.LDAP_ALLOWED_GROUP || 'Oshanak-ITSUP';
const NETBIOS = process.env.LDAP_NETBIOS || 'GBGNETWORK';
const UPN_SUFFIXES = (process.env.LDAP_UPN_SUFFIXES || `${LDAP_DOMAIN},oshanak.com`)
    .split(',').map(s => s.trim()).filter(Boolean);
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const REJECT_UNAUTHORIZED = process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'true';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

if (!process.env.SESSION_SECRET) {
    console.warn('[Auth] هشدار: SESSION_SECRET تنظیم نشده است. مقدار پیشفرض ناامن استفاده میشود.');
}

function escapeFilter(value) {
    return String(value).replace(/[\\*()\x00]/g, ch => '\\' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
}

function makeClient() {
    const Client = getLdapClient();
    return new Client({
        url: LDAP_URL,
        timeout: 10000,
        connectTimeout: 6000,
        tlsOptions: {
            rejectUnauthorized: REJECT_UNAUTHORIZED,
            servername: (() => { try { return new URL(LDAP_URL).hostname; } catch { return undefined; } })()
        }
    });
}

function bindCandidates(username) {
    if (username.includes('@')) return [username];
    const list = UPN_SUFFIXES.map(suffix => `${username}@${suffix}`);
    list.push(`${NETBIOS}\\${username}`);
    return [...new Set(list)];
}

function attr(entry, name) {
    const v = entry && entry[name];
    const value = Array.isArray(v) ? v[0] : v;
    return value == null ? '' : String(value);
}

function isNetworkError(err) {
    const m = String(err && err.message || '').toLowerCase();
    return /econnrefused|etimedout|enotfound|timeout|socket|connect|tls|certificate/i.test(m);
}

async function findUser(client, username, bindDn) {
    const filter = `(|(sAMAccountName=${escapeFilter(username)})(userPrincipalName=${escapeFilter(bindDn)})(mail=${escapeFilter(username)}))`;
    const { searchEntries } = await client.search(LDAP_BASE_DN, {
        scope: 'sub',
        filter,
        attributes: ['distinguishedName', 'sAMAccountName', 'displayName', 'mail'],
        sizeLimit: 2,
        timeLimit: 10
    });

    let dn = searchEntries.length ? searchEntries[0].dn : '';
    let user = {
        dn,
        username: attr(searchEntries[0], 'sAMAccountName') || username,
        displayName: attr(searchEntries[0], 'displayName'),
        mail: attr(searchEntries[0], 'mail')
    };

    if (!dn) {
        // fallback: LDAP WhoAmI (RFC 4532)
        try {
            const res = await client.exop('1.3.6.1.4.1.4203.1.11.3');
            const value = res && res.value ? res.value.toString('utf8') : '';
            const match = /^dn:\s*(.+)$/i.exec(value.trim());
            if (match) {
                dn = match[1].trim();
                user.dn = dn;
            }
        } catch (_) { /* نادیده گرفته میشود */ }
    }

    if (!dn) {
        throw Object.assign(new Error('شناسه کاربر در اکتیو دایرکتوری یافت نشد.'), { code: 'USER_DN_NOT_FOUND' });
    }
    return user;
}

async function isMemberOfGroup(client, userDn) {
    const { searchEntries: groups } = await client.search(LDAP_BASE_DN, {
        scope: 'sub',
        filter: `(&(objectClass=group)(sAMAccountName=${escapeFilter(ALLOWED_GROUP)}))`,
        attributes: ['distinguishedName'],
        sizeLimit: 2,
        timeLimit: 10
    });
    if (!groups.length) {
        throw Object.assign(new Error(`گروه «${ALLOWED_GROUP}» در اکتیو دایرکتوری یافت نشد.`), { code: 'GROUP_NOT_FOUND' });
    }
    const groupDn = groups[0].dn;

    // 1.2.840.113556.1.4.1941 = LDAP_MATCHING_RULE_IN_CHAIN (عضویت تودرتو را هم پوشش میدهد)
    const { searchEntries } = await client.search(userDn, {
        scope: 'base',
        filter: `(memberOf:1.2.840.113556.1.4.1941:=${groupDn})`,
        attributes: ['distinguishedName'],
        sizeLimit: 1,
        timeLimit: 10
    });
    return searchEntries.length > 0;
}

async function authenticate(username, password) {
    const raw = String(username || '').trim();
    if (!raw || !password) {
        throw Object.assign(new Error('نام کاربری و رمز عبور الزامی است.'), { code: 'MISSING_FIELDS' });
    }

    if (IS_LOCAL || IS_HYBRID) {
        // در hybrid فقط حساب مدیر محلی از اینجا میآید؛ بقیه اعضا از دامین میآیند.
        const localUser = IS_LOCAL
            ? localUsers.authenticate(raw, password)
            : localUsers.authenticateAdmin(raw, password);
        if (localUser) {
            console.log(`[Auth] ورود موفق (محلی): ${localUser.username}`);
            return localUser;
        }
    }

    let boundClient = null;
    let bindDn = '';
    for (const candidate of bindCandidates(raw)) {
        const client = makeClient();
        try {
            await client.bind(candidate, password);
            boundClient = client;
            bindDn = candidate;
            break;
        } catch (err) {
            await client.unbind().catch(() => {});
            if (isNetworkError(err) && !/invalid credentials|49:/i.test(String(err.message))) {
                throw Object.assign(new Error('ارتباط با اکتیو دایرکتوری برقرار نشد.'), { code: 'LDAP_UNAVAILABLE' });
            }
        }
    }

    if (!boundClient) {
        throw Object.assign(new Error('نام کاربری یا رمز عبور اشتباه است.'), { code: 'INVALID_CREDENTIALS' });
    }

    try {
        const user = await findUser(boundClient, raw, bindDn);
        const allowed = await isMemberOfGroup(boundClient, user.dn);
        if (!allowed) {
            throw Object.assign(new Error(`شما عضو گروه «${ALLOWED_GROUP}» نیستید و مجوز ورود ندارید.`), { code: 'NOT_IN_GROUP' });
        }
        return user;
    } finally {
        await boundClient.unbind().catch(() => {});
    }
}

function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        let value = part.slice(i + 1).trim();
        try { value = decodeURIComponent(value); } catch (_) { /* مقدار اصلی حفظ میشود */ }
        out[key] = value;
    }
    return out;
}

const ASSET_RE = /\.(css|js|mjs|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp|map)$/i;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || (IS_LOCAL ? 'admin' : 'aghanbari')).toLowerCase();
// مانیتورینگ هم محافظتشده است تا هر کاربر فقط فروشگاههای خودش را ببیند
const PUBLIC_PATHS = new Set([
    '/login', '/login.html', '/api/auth/login', '/api/auth/logout', '/api/auth/me',
    '/api/health', '/api/public-config'
]);

function isPublic(pathname) {
    return PUBLIC_PATHS.has(pathname) || ASSET_RE.test(pathname);
}

const attempts = new Map();
function rateLimitOk(ip) {
    const now = Date.now();
    let rec = attempts.get(ip);
    if (!rec || now > rec.reset) {
        rec = { count: 0, reset: now + 15 * 60 * 1000 };
        attempts.set(ip, rec);
    }
    if (rec.count >= 10) return false;
    rec.count += 1;
    return true;
}
function clearRateLimit(ip) { attempts.delete(ip); }

function middleware(req, res, next) {
    const pathname = req.path;

    // فراخوانی داخلی سرور مدیریت هنگام تازه کردن کش
    if (pathname === '/api/reload' && INTERNAL_TOKEN && req.get('x-internal-token') === INTERNAL_TOKEN) {
        return next();
    }
    if (isPublic(pathname)) return next();

    const session = verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    if (session) {
        req.user = session;
        return next();
    }

    if (pathname.startsWith('/api/')) {
        return res.status(401).json({ error: 'لطفاً ابتدا وارد شوید.', code: 'UNAUTHORIZED', loginUrl: '/login.html' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(401).json({ error: 'لطفاً ابتدا وارد شوید.', code: 'UNAUTHORIZED' });
    }
    const nextUrl = encodeURIComponent(req.originalUrl || pathname);
    return res.redirect(`/login.html?next=${nextUrl}`);
}

function isAdminUser(session) {
    if (!session) return false;
    // حساب مدیر محلی پرچم admin دارد؛ در حالت local تنها همین پرچم ملاک است.
    if (session.a === true) return true;
    if (IS_LOCAL) return false;
    return String(session.u || '').toLowerCase() === ADMIN_USERNAME;
}

function publicUser(session) {
    return {
        username: session.u,
        displayName: session.n,
        mail: session.m,
        group: session.g,
        expiresAt: session.exp
    };
}

function install(app) {
    app.get('/login.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });

    app.get('/login', (req, res) => {
        const q = req.query.next ? `?next=${encodeURIComponent(req.query.next)}` : '';
        res.redirect(`/login.html${q}`);
    });

    app.post('/api/auth/login', async (req, res) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        if (!rateLimitOk(ip)) {
            return res.status(429).json({ error: 'تلاشهای زیادی صورت گرفت. لطفاً ۱۵ دقیقه صبر کنید.', code: 'TOO_MANY_ATTEMPTS' });
        }
        const { username, password, remember } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.', code: 'MISSING_FIELDS' });
        }
        try {
            const user = await authenticate(username, password);
            clearRateLimit(ip);
            const now = Date.now();
            const ttl = remember ? REMEMBER_TTL_MS : DEFAULT_TTL_MS;
            const session = {
                u: user.username,
                n: user.displayName,
                m: user.mail,
                g: user.dn === 'LOCAL' ? 'LOCAL' : ALLOWED_GROUP,
                a: user.admin === true,
                iat: now,
                exp: now + ttl
            };
            res.cookie(COOKIE_NAME, sign(session), {
                httpOnly: true,
                sameSite: 'lax',
                secure: COOKIE_SECURE,
                path: '/',
                maxAge: ttl
            });
            console.log(`[Auth] ورود موفق: ${user.username} (${user.dn})`);
            res.json({ ok: true, user: publicUser(session) });
        } catch (err) {
            const status = err.code === 'INVALID_CREDENTIALS' ? 401
                : err.code === 'NOT_IN_GROUP' ? 403
                    : err.code === 'LDAP_UNAVAILABLE' || err.code === 'GROUP_NOT_FOUND' || err.code === 'LDAP_MODULE_MISSING' ? 503
                        : 400;
            console.warn(`[Auth] ورود ناموفق: ${username} -> ${err.code || err.message}`);
            res.status(status).json({ error: err.message, code: err.code || 'LOGIN_FAILED' });
        }
    });

    app.post('/api/auth/logout', (req, res) => {
        res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'lax', secure: COOKIE_SECURE });
        res.json({ ok: true });
    });

    app.get('/api/auth/me', (req, res) => {
        const session = verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
        res.json({
            authenticated: !!session,
            isAdmin: isAdminUser(session),
            user: session ? publicUser(session) : null
        });
    });

    app.use(middleware);
}

module.exports = { install, middleware, authenticate, verify, sign, COOKIE_NAME, ALLOWED_GROUP, isAdminUser, ADMIN_USERNAME, AUTH_MODE, IS_LOCAL, IS_HYBRID };
