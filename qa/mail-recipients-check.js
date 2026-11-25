// تست گیرندگان ایمیل گزارش نهایی: گروه Oshanak-ITSUP همیشه اضافه میشود مگر اعلان خاموش باشد.
// اجرا: npm run test:mail  (یا node qa/mail-recipients-check.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const tmpDir = path.join(os.tmpdir(), 'opencode');
fs.mkdirSync(tmpDir, { recursive: true });
process.env.ACTIVITY_FILE = path.join(tmpDir, `haft-mail-test-${process.pid}.json`);
process.env.HAFT_SKIP_LISTEN = '1';
process.env.SESSION_SECRET = 'qa-mail-secret';
process.env.AUTH_MODE = 'local';
process.env.AUDIT_NOTIFY_TO = '';
process.env.AUDIT_GROUP_MAIL = 'Oshanak-ITSUP@gbgnetwork.net';
process.env.AUDIT_GROUP_LABEL = 'Oshanak-ITSUP';

const core = require('../core');
const directory = require('../ad-directory');
let settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
let adGroupMail = '';
let adMembers = [];
core.getEffectiveSettings = () => settings;
directory.getGroupMail = async () => adGroupMail;
directory.listMembers = async () => adMembers;

const { resolveAuditRecipients, auditGroupRecipient, auditMailFrom } = require('../server');
const GROUP = '"Oshanak-ITSUP" <Oshanak-ITSUP@gbgnetwork.net>';

const results = [];
async function check(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}

(async () => {
    await check('group recipient has display name and address', () => {
        assert.equal(auditGroupRecipient(), GROUP);
    });

    await check('disabled notification is a full kill switch (even over env)', async () => {
        settings = { emailNotifyEnabled: false, emailNotifyTo: '' };
        process.env.AUDIT_NOTIFY_TO = 'ops@example.com';
        const r = await resolveAuditRecipients('');
        assert.deepEqual(r, { to: [], source: 'disabled' });
        process.env.AUDIT_NOTIFY_TO = '';
    });

    await check('env recipient + group are both used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: 'panel@example.com' };
        process.env.AUDIT_NOTIFY_TO = 'ops@example.com';
        const r = await resolveAuditRecipients('');
        assert.equal(r.source, 'env');
        assert.deepEqual(r.to, ['ops@example.com', GROUP]);
        process.env.AUDIT_NOTIFY_TO = '';
    });

    await check('admin panel recipient + group are both used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: 'panel@example.com' };
        const r = await resolveAuditRecipients('');
        assert.equal(r.source, 'settings');
        assert.deepEqual(r.to, ['panel@example.com', GROUP]);
    });

    await check('AD group mail + group are both used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        adGroupMail = 'it-ad@example.com';
        const r = await resolveAuditRecipients('');
        assert.equal(r.source, 'ad-group');
        assert.deepEqual(r.to, ['it-ad@example.com', GROUP]);
        adGroupMail = '';
    });

    await check('AD members + group are both used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        adMembers = [{ mail: 'member@example.com' }];
        const r = await resolveAuditRecipients('');
        assert.equal(r.source, 'ad-members');
        assert.deepEqual(r.to, ['member@example.com', GROUP]);
        adMembers = [];
    });

    await check('fallback manager + group are both used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        const r = await resolveAuditRecipients('');
        assert.equal(r.source, 'fallback');
        assert.deepEqual(r.to, ['manager@haftstores.ir', GROUP]);
    });

    await check('raw group address is replaced, not duplicated', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: 'Oshanak-ITSUP@gbgnetwork.net, panel@example.com' };
        const r = await resolveAuditRecipients('');
        assert.equal(r.to.filter(x => x.toLowerCase().includes('oshanak-itsup@gbgnetwork.net')).length, 1);
        assert.equal(r.to[0], GROUP);
        assert.equal(r.to[1], 'panel@example.com');
    });

    await check('group address and label can be overridden from env', () => {
        process.env.AUDIT_GROUP_MAIL = 'netops@gbgnetwork.net';
        process.env.AUDIT_GROUP_LABEL = 'Net Ops';
        process.env.EMAIL_USER = 'aghanbari@gbgnetwork.net';
        delete require.cache[require.resolve('../server')];
        const reloaded = require('../server');
        assert.equal(reloaded.auditGroupRecipient(), '"Net Ops" <netops@gbgnetwork.net>');
        assert.ok(reloaded.auditMailFrom().includes('<aghanbari@gbgnetwork.net>'));
    });

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
    process.exitCode = 1;
});
