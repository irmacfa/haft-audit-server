/**
 * نمایش کاربر واردشده، دکمه خروج و لینکهای بین پنلها
 * صفحه مانیتورینگ برای همه آزاد است؛ پنل مدیریت فقط برای حساب aghanbari.
 */
(function () {
    var portConfig = null;
    var isMonitoring = location.pathname.indexOf('monitoring.html') !== -1;

    function displayName(user) {
        if (!user) return 'کاربر';
        return user.displayName || user.username || 'کاربر';
    }

    function hideAll(selector) {
        document.querySelectorAll(selector).forEach(function (el) {
            el.classList.add('hidden');
        });
    }

    function showAll(selector) {
        document.querySelectorAll(selector).forEach(function (el) {
            el.classList.remove('hidden');
        });
    }

    function fillUser(data) {
        var user = data.user;
        document.querySelectorAll('[data-user-name]').forEach(function (el) {
            el.textContent = displayName(user);
        });
        document.querySelectorAll('[data-user-mail]').forEach(function (el) {
            el.textContent = user && user.mail ? user.mail : '';
        });
        var badge = document.getElementById('userBadge');
        if (badge && user && user.mail) badge.title = user.mail;

        showAll('[data-user-only]');
        hideAll('[data-guest-only]');
        if (data.isAdmin) showAll('[data-admin-only]');
        else hideAll('[data-admin-only]');
    }

    function guestMode() {
        hideAll('[data-user-only]');
        hideAll('[data-admin-only]');
        showAll('[data-guest-only]');
        // در صفحات محافظتشده سرور خودش ریدایرکت میکند، اینجا فقط fallback است
        if (!isMonitoring) {
            var next = encodeURIComponent(location.pathname + location.search);
            location.replace('/login.html?next=' + next);
        }
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
            if (!data.authenticated) return guestMode();
            fillUser(data);
        })
        .catch(function () { /* وضعیت فعلی باقی میماند */ });

    fetch('/api/public-config', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (cfg) {
            portConfig = cfg;
            applyPortLinks();
        })
        .catch(function () {});

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
