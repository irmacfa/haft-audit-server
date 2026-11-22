/**
 * نمایش کاربر واردشده، دکمه خروج و لینکهای بین پنلها با پورتهای قابل تنظیم
 * این فایل روی هر دو سرور (پورتهای پیشفرض 2030/2031) در دسترس است.
 */
(function () {
    var portConfig = null;

    function displayName(user) {
        if (!user) return 'کاربر';
        return user.displayName || user.username || 'کاربر';
    }

    function fillUser(user) {
        document.querySelectorAll('[data-user-name]').forEach(function (el) {
            el.textContent = displayName(user);
        });
        document.querySelectorAll('[data-user-mail]').forEach(function (el) {
            el.textContent = user.mail || '';
        });
        var auditor = document.getElementById('auditorNameDisplay');
        if (auditor) auditor.textContent = displayName(user);
        var auditorMail = document.getElementById('auditorMailDisplay');
        if (auditorMail) auditorMail.textContent = user.mail || user.username || '';
        var badge = document.getElementById('userBadge');
        if (badge && user.mail) badge.title = user.mail;
    }

    function buildUrl(path, port) {
        return location.protocol + '//' + location.hostname + ':' + port + (path || '/');
    }

    function applyPortLinks() {
        if (!portConfig) return;
        document.querySelectorAll('[data-admin-link]').forEach(function (el) {
            el.href = buildUrl(el.getAttribute('data-admin-link') || '/', portConfig.adminPort);
        });
        document.querySelectorAll('[data-user-link]').forEach(function (el) {
            el.href = buildUrl(el.getAttribute('data-user-link') || '/', portConfig.userPort);
        });
    }

    fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.authenticated) {
                var next = encodeURIComponent(location.pathname + location.search);
                location.replace('/login.html?next=' + next);
                return;
            }
            fillUser(data.user);
        })
        .catch(function () { /* در صورت خطا، صفحه همانطور که هست باقی میماند */ });

    fetch('/api/public-config', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (cfg) {
            portConfig = cfg;
            applyPortLinks();
        })
        .catch(function () { /* در صورت خطا لینکهای پیشفرض باقی میمانند */ });

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-logout]');
        if (btn) {
            e.preventDefault();
            fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
                .catch(function () {})
                .finally(function () { location.replace('/login.html'); });
            return;
        }

        var adminLink = e.target.closest('[data-admin-link]');
        var userLink = e.target.closest('[data-user-link]');
        var link = adminLink || userLink;
        if (!link || !portConfig) return;
        e.preventDefault();
        var path = link.getAttribute(adminLink ? 'data-admin-link' : 'data-user-link') || '/';
        var port = adminLink ? portConfig.adminPort : portConfig.userPort;
        location.href = buildUrl(path, port);
    });
})();
