/**
 * تعیین محدوده دسترسی کاربر به مناطق/فروشگاهها.
 * - حساب مدیر (admin در حالت محلی، ADMIN_USERNAME در حالت ldap) همه مناطق را میبیند.
 * - لینک «دسترسی کل مناطق» (علامت *) به معنای دیدن تمام مناطق و انبارها است.
 * - انبارها جداگانهاند: لینک «انبارها» یعنی تمام انبارها، و لینک یک کد مانند 9104 یعنی فقط همان انبار.
 * - سایر کاربران فقط مناطقی را میبینند که در پنل مدیریت به آنها لینک شدهاند.
 */
const core = require('./core');
const directory = require('./ad-directory');
const auth = require('./auth');

const ALL = directory.ALL_REGIONS;

function getAccess(session) {
    if (!session) return { authenticated: false, all: false, admin: false, regions: [] };
    if (auth.isAdminUser(session)) {
        return { authenticated: true, all: true, admin: true, regions: [] };
    }
    const username = String(session.u || '').toLowerCase();
    const regions = directory.getRegionsForUser(username);
    if (regions.includes(ALL)) {
        return { authenticated: true, all: true, admin: false, regions: [] };
    }
    return { authenticated: true, all: false, admin: false, regions };
}

// لینک به منطقهای که نامش شامل «انبار» است یعنی دسترسی به تمام انبارها.
function hasAllWarehouses(regions) {
    return regions.some(r => /انبار/.test(String(r || '')));
}

// نسخهای که یکبار access را میگیرد تا در جستجوی سراسری روی هزاران تجهیز،
// مکرراً از دیسک خوانده نشود.
function isPlantAllowedForAccess(access, plant) {
    if (!access || !access.authenticated) return false;
    if (access.all) return true;
    if (core.isWarehousePlant(plant)) {
        return access.regions.includes(String(plant)) || hasAllWarehouses(access.regions);
    }
    return access.regions.includes(core.getRegion(plant));
}

function isPlantAllowed(session, plant) {
    return isPlantAllowedForAccess(getAccess(session), plant);
}

function filterStores(session, stores) {
    const access = getAccess(session);
    if (access.all) return stores;
    if (!access.authenticated) return [];
    return stores.filter(s => isPlantAllowedForAccess(access, s.plant));
}

function isRegionAllowed(session, region) {
    const access = getAccess(session);
    if (!access.authenticated) return false;
    if (access.all) return true;
    return access.regions.includes(String(region || ''));
}

module.exports = { ALL, getAccess, isPlantAllowed, isPlantAllowedForAccess, isRegionAllowed, filterStores };
