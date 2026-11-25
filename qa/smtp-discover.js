// پیدا کردن هاست SMTP معتبر از لیست هاستهای اعلامشده؛ فقط احراز هویت میکند، ایمیلی فرستاده نمیشود.
// اجرا: npm run test:smtp-hosts   (یا node qa/smtp-discover.js)
require('dotenv').config();
const nodemailer = require('nodemailer');

const HOSTS = [
    'email.gbgnetwork.net',
    'mail.gbgnetwork.net',
    'email.oshanak.com',
    'mail.oshanak.com'
];
const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASS;

if (!user || !pass) {
    console.error('SMTP discovery failed: EMAIL_USER / EMAIL_PASS are not set in .env.');
    process.exit(1);
}

const attempts = [];
for (const host of HOSTS) {
    for (const [port, secure] of [[587, false], [465, true]]) {
        attempts.push({ host, port, secure });
    }
}

async function tryAuth({ host, port, secure }) {
    const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
        auth: { user, pass },
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 4000
    });
    try {
        await transporter.verify();
        return { host, port, secure, ok: true };
    } catch (e) {
        return { host, port, secure, ok: false, error: e.message || String(e) };
    } finally {
        transporter.close();
    }
}

(async () => {
    const results = [];
    for (const attempt of attempts) {
        const r = await tryAuth(attempt);
        results.push(r);
        console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.host}:${r.port} (${r.secure ? 'TLS' : 'STARTTLS'})${r.ok ? '' : ' - ' + r.error}`);
    }
    const working = results.filter(r => r.ok);
    console.log('\nWorking SMTP hosts:');
    console.log(JSON.stringify(working, null, 2));
    if (!working.length) {
        console.log('\nNo host accepted the credentials. Check EMAIL_USER / EMAIL_PASS and firewall access to ports 587/465.');
        process.exitCode = 1;
    } else {
        console.log(`\nSet in .env: SMTP_HOST=${working[0].host}  SMTP_PORT=${working[0].port}  SMTP_SECURE=${working[0].secure}`);
    }
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
