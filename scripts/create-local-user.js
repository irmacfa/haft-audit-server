#!/usr/bin/env node
/**
 * Create, update, or list local users.
 * In the default hybrid mode only --admin accounts are accepted locally; other users come from the domain.
 * With AUTH_MODE=local, regular local users can also be created.
 *
 * Examples:
 *   npm run create-user -- admin R4ndomPass "System Administrator" --admin
 *   npm run create-user -- --list
 */
const users = require('../local-users');

const args = process.argv.slice(2);
const list = args.includes('--list');
const admin = args.includes('--admin');
const positional = args.filter(a => a !== '--admin' && a !== '--list');

if (list) {
    console.log('Local users:');
    console.table(users.listUsers());
    process.exit(0);
}

const [username, password, displayName, mail] = positional;

if (!username || !password) {
    console.error('Usage: npm run create-user -- <username> <password> [displayName] [mail] [--admin]');
    console.error('Example: npm run create-user -- admin MySecret123 "System Administrator" --admin');
    process.exit(1);
}

try {
    const user = users.upsertUser({ username, password, displayName, mail, admin });
    console.log('User saved:', user);
    console.log('To link regions, open the admin panel: Members and Regions');
} catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
}
