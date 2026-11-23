/**
 * تعیین محدوده دسترسی کاربر به مناطق/فروشگاهها.
 * - حساب مدیر (admin در حالت محلی، ADMIN_USERNAME در حالت ldap) همه مناطق را میبیند.
 * - لینک «دسترسی کل منطقه» (علامت *) به معنای دیدن تمام مناطق است.
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

function isPlantAllowed(session, plant) {
    const access = getAccess(session);
    if (!access.authenticated) return false;
    if (access.all) return true;
    const region = core.getRegion(plant);
    return access.regions.includes(region);
}

function filterStores(session, stores) {
    const access = getAccess(session);
    if (access.all) return stores;
    if (!access.authenticated) return [];
    return stores.filter(s => access.regions.includes(s.region));
}

function isRegionAllowed(session, region) {
    const access = getAccess(session);
    if (!access.authenticated) return false;
    if (access.all) return true;
    return access.regions.includes(String(region || ''));
}

module.exports = { ALL, getAccess, isPlantAllowed, isRegionAllowed, filterStores };
