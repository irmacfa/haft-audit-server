// تست گیرنده/فرستنده ایمیل گزارش نهایی:
// From = OshanakSUP، To = Oshanak-ITSUP، و خاموش کردن اعلان ایمیل کلید قطع کامل است.
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
delete process.env.AUDIT_MAIL_FROM;
delete process.env.AUDIT_MAIL_FROM_LABEL;

const core = require('../core');
let settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
core.getEffectiveSettings = () => settings;

const { resolveAuditRecipients, auditGroupRecipient, auditMailFrom } = require('../server');
const ITSUP = '"Oshanak-ITSUP" <Oshanak-ITSUP@gbgnetwork.net>';
const SUP = '"OshanakSUP" <OshanakSUP@oshanak.com>';

const results = [];
async function check(name, fn) {
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}

(async () => {
    await check('group recipient has display name and address', () => {
        assert.equal(auditGroupRecipient(), ITSUP);
    });

    await check('sender defaults to OshanakSUP group', () => {
        assert.equal(auditMailFrom(), SUP);
    });

    await check('disabled notification is a full kill switch (even over env)', async () => {
        settings = { emailNotifyEnabled: false, emailNotifyTo: 'panel@example.com' };
        process.env.AUDIT_NOTIFY_TO = 'ops@example.com';
        const r = await resolveAuditRecipients('');
        assert.deepEqual(r, { to: [], source: 'disabled' });
        process.env.AUDIT_NOTIFY_TO = '';
    });

    await check('env recipient is ignored; only ITSUP group is used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        process.env.AUDIT_NOTIFY_TO = 'ops@example.com';
        const r = await resolveAuditRecipients('');
        assert.deepEqual(r, { to: [ITSUP], source: 'audit-group' });
        process.env.AUDIT_NOTIFY_TO = '';
    });

    await check('admin panel recipient is ignored; only ITSUP group is used', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: 'panel@example.com' };
        const r = await resolveAuditRecipients('');
        assert.deepEqual(r, { to: [ITSUP], source: 'audit-group' });
    });

    await check('raw ITSUP address in env is replaced, not duplicated', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        process.env.AUDIT_NOTIFY_TO = 'Oshanak-ITSUP@gbgnetwork.net, ops@example.com';
        const r = await resolveAuditRecipients('');
        assert.deepEqual(r.to, [ITSUP]);
        process.env.AUDIT_NOTIFY_TO = '';
    });

    await check('empty group address disables sending', async () => {
        settings = { emailNotifyEnabled: true, emailNotifyTo: '' };
        process.env.AUDIT_GROUP_MAIL = '';
        delete require.cache[require.resolve('../server')];
        const reloaded = require('../server');
        const r = await reloaded.resolveAuditRecipients('');
        assert.deepEqual(r, { to: [], source: 'no-group' });
    });

    await check('recipient group and sender can be overridden from env', async () => {
        process.env.AUDIT_GROUP_MAIL = 'netops@gbgnetwork.net';
        process.env.AUDIT_GROUP_LABEL = 'Net Ops';
        process.env.AUDIT_MAIL_FROM = 'sender@gbgnetwork.net';
        process.env.AUDIT_MAIL_FROM_LABEL = 'Sender';
        delete require.cache[require.resolve('../server')];
        const reloaded = require('../server');
        assert.equal(reloaded.auditGroupRecipient(), '"Net Ops" <netops@gbgnetwork.net>');
        assert.equal(reloaded.auditMailFrom(), '"Sender" <sender@gbgnetwork.net>');
        const r = await reloaded.resolveAuditRecipients('');
        assert.deepEqual(r, { to: ['"Net Ops" <netops@gbgnetwork.net>'], source: 'audit-group' });
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
