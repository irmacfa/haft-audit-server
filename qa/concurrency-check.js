// تست خودکار جلوگیری از دسترسی همزمان به انبارگردانی یک فروشگاه.
// اجرا: npm run test:concurrency  (یا node qa/concurrency-check.js)
// تمام تغییرات فعالیت در یک فایل موقتی در Temp انجام میشود؛db/live_activity.json دست نخورده میماند.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const tmpDir = path.join(os.tmpdir(), 'opencode');
fs.mkdirSync(tmpDir, { recursive: true });
const activityFile = path.join(tmpDir, `haft-concurrency-${process.pid}.json`);
fs.rmSync(activityFile, { force: true });
process.env.ACTIVITY_FILE = activityFile;

const SECRET = 'qa-concurrency-secret';
process.env.SESSION_SECRET = SECRET;

const results = [];
function check(name, fn) {
    try { fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}
async function checkAsync(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- تستهای سطح ماژول ----------
const activity = require('../live-activity');
const alice = { u: 'alice', n: 'Alice' };
const bob = { u: 'bob', n: 'Bob' };
const PLANT_A = '1234';
const PLANT_B = '2100';

check('start: first user takes the lock', () => {
    const started = activity.start(alice, PLANT_A, 'Store A');
    assert.equal(started.ok, true);
    assert.equal(started.activity.username, 'alice');
    assert.equal(started.activity.plant, PLANT_A);
});

check('start: second user on same plant is rejected', () => {
    const started = activity.start(bob, PLANT_A, 'Store A');
    assert.equal(started.conflict, true);
    assert.equal(started.active.username, 'alice');
    assert.equal(started.active.displayName, 'Alice');
    assert.equal(activity.list().filter(r => r.plant === PLANT_A).length, 1);
});

check('getActiveByPlant: excludes the given user', () => {
    assert.equal(activity.getActiveByPlant(PLANT_A, 'alice'), null);
    assert.equal(activity.getActiveByPlant(PLANT_A, 'bob').username, 'alice');
    assert.equal(activity.getActiveByPlant(PLANT_B, 'alice'), null);
});

check('getActiveFor: returns own record and respects plant filter', () => {
    assert.equal(activity.getActiveFor(alice).username, 'alice');
    assert.equal(activity.getActiveFor(alice, PLANT_A).plant, PLANT_A);
    assert.equal(activity.getActiveFor(alice, PLANT_B), null);
});

check('heartbeat: updates progress only for matching plant', () => {
    assert.equal(activity.heartbeat(alice, PLANT_A, 4, 10), true);
    assert.equal(activity.heartbeat(alice, PLANT_B, 9, 10), true);
    const rec = activity.getActiveFor(alice, PLANT_A);
    assert.equal(rec.checked, 4);
    assert.equal(rec.total, 10);
});

check('stale records are pruned so a hung tab cannot hold the lock forever', () => {
    const all = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    all.stale = { username: 'stale', displayName: 'Stale', plant: PLANT_B, startedAt: Date.now() - 600000, lastSeen: Date.now() - 600000 };
    fs.writeFileSync(activityFile, JSON.stringify(all));
    assert.equal(activity.getActiveByPlant(PLANT_B, 'nobody'), null);
    assert.equal(fs.readFileSync(activityFile, 'utf8').includes('"stale"'), false);
});

check('stop: releases the plant for the next user', () => {
    activity.stop(alice);
    assert.equal(activity.getActiveByPlant(PLANT_A), null);
    assert.equal(activity.start(bob, PLANT_A, 'Store A').ok, true);
    activity.stop(bob);
});

// ---------- تستهای سطح HTTP (بدون نوشتن db/audit_db.json) ----------
(async () => {
    const auth = require('../auth');
    const port = 20300 + (process.pid % 500);
    const cookieFor = user => `${auth.COOKIE_NAME}=${encodeURIComponent(auth.sign({
        u: user, n: user.toUpperCase(), a: true, iat: Date.now(), exp: Date.now() + 3600000
    }))}`;
    const child = spawn(process.execPath, ['server.js'], {
        cwd: root,
        env: { ...process.env, PORT: String(port), AUTH_MODE: 'local' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.stdout.on('data', c => { logs += c.toString(); });
    child.stderr.on('data', c => { logs += c.toString(); });

    async function request(urlPath, user, body) {
        const options = {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Cookie: cookieFor(user) }
        };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
    }

    try {
        let ready = false;
        for (let i = 0; i < 40 && !ready; i++) {
            await sleep(250);
            try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch (_) { /* سرور هنوز بالا نیامده */ }
        }
        checkAsync('http: server started', () => assert.equal(ready, true, logs.slice(-600)));

        if (ready) {
            await checkAsync('http: start locks the plant', async () => {
                const r = await request('/api/activity/start', 'alice', { plant: PLANT_A, storeName: 'Store A' });
                assert.equal(r.status, 200);
                assert.equal(r.data.ok, true);
                assert.equal(r.data.activity.username, 'alice');
            });
            await checkAsync('http: start conflict returns 409 with the active user', async () => {
                const r = await request('/api/activity/start', 'bob', { plant: PLANT_A, storeName: 'Store A' });
                assert.equal(r.status, 409);
                assert.equal(r.data.code, 'AUDIT_IN_PROGRESS');
                assert.equal(r.data.conflict.username, 'alice');
            });
            await checkAsync('http: another user cannot read the in-progress audit', async () => {
                const r = await request(`/api/audit/${PLANT_A}`, 'bob');
                assert.equal(r.status, 409);
                assert.equal(r.data.code, 'AUDIT_IN_PROGRESS');
            });
            await checkAsync('http: owner can still read the audit', async () => {
                const r = await request(`/api/audit/${PLANT_A}`, 'alice');
                assert.equal(r.status, 200);
            });
            await checkAsync('http: heartbeat conflict is rejected', async () => {
                const r = await request('/api/activity/heartbeat', 'bob', { plant: PLANT_A, checked: 1, total: 2 });
                assert.equal(r.status, 409);
                assert.equal(r.data.code, 'AUDIT_IN_PROGRESS');
            });
            await checkAsync('http: owner heartbeat updates progress', async () => {
                const r = await request('/api/activity/heartbeat', 'alice', { plant: PLANT_A, checked: 3, total: 10 });
                assert.equal(r.status, 200);
                const rec = activity.getActiveFor({ u: 'alice' }, PLANT_A);
                assert.equal(rec.checked, 3);
            });
            await checkAsync('http: stop releases the plant', async () => {
                assert.equal((await request('/api/activity/stop', 'alice', {})).status, 200);
                const r = await request('/api/activity/start', 'bob', { plant: PLANT_A, storeName: 'Store A' });
                assert.equal(r.status, 200);
                const blocked = await request('/api/activity/start', 'alice', { plant: PLANT_A, storeName: 'Store A' });
                assert.equal(blocked.status, 409);
            });
            await checkAsync('http: a different plant is not blocked', async () => {
                const r = await request('/api/activity/start', 'alice', { plant: PLANT_B, storeName: 'Store B' });
                assert.equal(r.status, 200);
            });
        }
    } finally {
        child.kill();
        await Promise.race([
            new Promise(resolve => child.once('exit', resolve)),
            sleep(2000).then(() => child.kill('SIGKILL'))
        ]);
        fs.rmSync(activityFile, { force: true });
    }

    const summary = {
        date: new Date().toISOString(),
        total: results.length,
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length,
        results
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed) process.exitCode = 1;
})().catch(e => {
    console.error(e);
    fs.rmSync(activityFile, { force: true });
    process.exitCode = 1;
});
