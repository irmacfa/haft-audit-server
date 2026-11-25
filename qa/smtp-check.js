// تست اعتبار SMTP و (اختیاری) ارسال یک ایمیل آزمایشی.
// اجرا:
//   npm run test:smtp                     => فقط احراز هویت SMTP (هیچ ایمیلی فرستاده نمیشود)
//   node qa/smtp-check.js --send          => ارسال ایمیل آزمایشی به AUDIT_GROUP_MAIL / SMTP_TEST_TO
//   node qa/smtp-check.js --send --to user@example.com --from OshanakSUP@oshanak.com
require('dotenv').config();
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST || 'mail.haftstores.ir';
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASS;

if (!user || !pass) {
    console.error('SMTP check failed: EMAIL_USER / EMAIL_PASS are not set in .env.');
    process.exit(1);
}

const args = process.argv.slice(2);
const send = args.includes('--send');
const toIndex = args.indexOf('--to');
const to = (toIndex >= 0 && args[toIndex + 1]) ||
    process.env.SMTP_TEST_TO ||
    process.env.AUDIT_GROUP_MAIL ||
    'Oshanak-ITSUP@gbgnetwork.net';
const fromIndex = args.indexOf('--from');
const fromAddress = String((fromIndex >= 0 && args[fromIndex + 1]) ||
    process.env.AUDIT_MAIL_FROM || 'OshanakSUP@oshanak.com').replace(/[<>"\r\n]/g, '').trim();
const fromLabel = String(process.env.AUDIT_MAIL_FROM_LABEL || 'OshanakSUP').replace(/[<>"\r\n]/g, '').trim();

const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
});

(async () => {
    await transporter.verify();
    console.log(`SMTP auth OK: ${host}:${port} as ${user}`);

    if (!send) {
        console.log('No email sent. Use --send (optionally --to <address>) to send a test message.');
        return;
    }

    const info = await transporter.sendMail({
        from: fromLabel ? `"${fromLabel}" <${fromAddress}>` : fromAddress,
        to,
        subject: `[SMTP test] ${new Date().toISOString()}`,
        text: 'This is a test message from the audit server SMTP checker.',
        html: '<div dir="rtl">این یک ایمیل آزمایشی از سامانه انبارگردانی هفت است.</div>'
    });
    console.log(`Test email sent from ${fromAddress} to ${to}: ${info.messageId}`);
})().catch(e => {
    console.error('SMTP check failed:', e.message || e);
    process.exitCode = 1;
});
