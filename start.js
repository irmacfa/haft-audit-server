/**
 * Single-process launcher for the Haft Audit server.
 *
 * Start : double-click start.bat (or run: node start.js)
 * Stop  : press Ctrl+C in this window
 *
 * Both panels run in this one process, so Ctrl+C stops them together.
 */
const net = require('net');

const PORT = Number(process.env.PORT || 2030);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 2031);

function portIsOpen(port) {
    return new Promise(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const done = value => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.on('connect', () => done(true));
        socket.on('error', () => done(false));
        socket.setTimeout(600, () => done(false));
    });
}

async function main() {
    console.log('==================================================');
    console.log(' HAFT AUDIT SERVER');
    console.log('==================================================');

    const busy = [];
    for (const port of [PORT, ADMIN_PORT]) {
        if (await portIsOpen(port)) busy.push(port);
    }
    if (busy.length) {
        console.error(`Port ${busy.join(', ')} is already in use.`);
        console.error('Stop the existing process first, then start again.');
        process.exit(1);
    }

    console.log(`User panel  : http://localhost:${PORT}`);
    console.log(`Admin panel : http://localhost:${ADMIN_PORT}`);
    console.log('Press Ctrl+C to stop both servers.');
    console.log('==================================================');

    // Both modules call app.listen() in this same process.
    require('./server');
    require('./admin-server');
}

process.on('SIGINT', () => {
    console.log('\nServers stopped.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nServers stopped.');
    process.exit(0);
});

main().catch(error => {
    console.error('Failed to start the server:', error.message);
    process.exit(1);
});
