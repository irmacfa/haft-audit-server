/* VibeFarsi + Design System — اعمال خودکار بر المانهای موجود و پویا */
(function () {
    const ICONS = {
        '🛡️': 'shield', '⚙️': 'settings', '🔄': 'refresh', '📥': 'download',
        '💾': 'save', '🔒': 'lock', '🔓': 'unlock', '📊': 'chart',
        '🔍': 'search', '🏠': 'home', '📋': 'list', '⬆️': 'upload',
        '✅': 'check', '❌': 'x', '✎': 'edit', '↺': 'rotate',
        '✓': 'check', '✕': 'x'
    };
    const PATHS = {
        save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
        download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
        upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 21h14"/>',
        lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
        unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/>',
        chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
        refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4h-.2a1.7 1.7 0 0 0-1.6 1Z"/>',
        check: '<path d="m5 12 5 5L20 7"/>',
        x: '<path d="M18 6 6 18M6 6l12 12"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
        rotate: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
        home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'
    };
    const ICON_KEYS = Object.keys(ICONS).sort((a, b) => b.length - a.length);

    function svg(name) {
        return `<svg class="ds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
    }

    function iconify(el) {
        if (el.dataset.dsIcon) return;
        const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
        if (!node) return;
        const text = node.textContent.trim();
        for (const key of ICON_KEYS) {
            if (text.startsWith(key)) {
                node.textContent = text.slice(key.length).trim();
                el.insertAdjacentHTML('afterbegin', svg(ICONS[key]));
                el.dataset.dsIcon = '1';
                return;
            }
        }
    }

    function toast(message, kind) {
        let host = document.querySelector('.ds-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.className = 'ds-toast-host';
            document.body.appendChild(host);
        }
        const box = document.createElement('div');
        box.className = 'ds-toast ' + (kind || 'ok');
        box.innerHTML = svg(kind === 'bad' ? 'x' : 'check') + '<span></span>';
        box.querySelector('span').textContent = String(message).replace(/^[^\s]+\s*/, '');
        host.appendChild(box);
        setTimeout(() => box.remove(), 4500);
    }
    window.alert = msg => toast(msg, 'ok');

    function apply(root) {
        if (!root || !root.querySelectorAll) return;

        /* ساختار کلی */
        root.querySelectorAll('header').forEach(h => h.classList.add('ds-topbar'));
        // فقط لوگوی نارنجی، نه کل کانتینر عنوان
        root.querySelectorAll('header .bg-orange-600').forEach(m => m.classList.add('ds-brand-mark'));
        root.querySelectorAll('#serverStatusBadge').forEach(b => b.classList.add('ds-status-pill'));

        /* کارتها — فقط ظاهر، بدون تغییر فاصلهگذاری قبلی */
        root.querySelectorAll('[class*="rounded-3xl"]').forEach(c => c.classList.add('ds-card'));

        /* سه کارت مرحله در پنل انبارگردان */
        ['storeCodeInput', 'globalAssetSearchInput'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.closest('[class*="rounded-3xl"]')?.classList.add('ds-step');
        });

        /* آمار */
        root.querySelectorAll('[class*="min-w-[90px]"]').forEach(s => s.classList.add('ds-stat'));
        root.querySelectorAll('.ds-stat').forEach(s => {
            const v = s.querySelector('[id^="count"], [id$="Count"]');
            if (v) v.classList.add('ds-stat-value');
        });

        /* جدول */
        root.querySelectorAll('#equipmentTableBody').forEach(t => t.parentElement.classList.add('ds-table-wrap'));
        root.querySelectorAll('#progressBar, #auditProgressBar').forEach(b => {
            b.parentElement.classList.add('ds-progress');
        });

        /* کاشیهای گرید */
        root.querySelectorAll('#statsGrid > div, #adminStatsGrid > a').forEach(t => {
            t.classList.add('ds-tile');
            const c = t.className;
            if (/tile-done|emerald/.test(c)) t.classList.add('ok');
            else if (/tile-progress|amber/.test(c)) t.classList.add('warn');
            else t.classList.add('bad');
        });

        /* دکمهها و ورودیها */
        root.querySelectorAll('button').forEach(btn => {
            if (btn.classList.contains('vf-btn-brand') || btn.classList.contains('vf-btn-danger') || btn.classList.contains('vf-btn-primary')) {
                btn.classList.add('vf-btn');
                iconify(btn);
                return;
            }
            btn.classList.add('vf-btn');
            const id = btn.id || '';
            const label = btn.textContent || '';
            if (id === 'finalizeBtn' || btn.classList.contains('vf-primary')) {
                btn.classList.add('vf-btn-primary', 'vf-btn-lg');
            } else if (id === 'draftBtn') {
                btn.classList.add('vf-btn-secondary');
            } else if (id === 'downloadBtn') {
                btn.classList.add('vf-btn-outline');
            } else if (label.includes('آپلود') || label.includes('ذخیره تنظیمات') || label.includes('ذخیره مناطق')) {
                btn.classList.add('vf-btn-brand');
            } else if (id.startsWith('af-')) {
                btn.classList.add('vf-btn-sm');
                btn.classList.add(btn.classList.contains('bg-orange-600') ? 'vf-btn-brand' : 'vf-btn-ghost');
            } else if (btn.closest('#regionButtons')) {
                btn.classList.add('vf-btn-sm', 'vf-btn-ghost');
            } else if (btn.classList.contains('filter-btn') || btn.id === 'loadMoreBtn') {
                btn.classList.add('vf-btn-sm', 'vf-btn-outline');
            } else if (btn.id.startsWith('view') && btn.classList.contains('bg-indigo-700')) {
                btn.classList.add('vf-btn-sm', 'vf-btn-brand');
            }
            iconify(btn);
        });

        root.querySelectorAll('header a[href]').forEach(a => {
            a.classList.add('vf-btn', 'vf-btn-sm', 'vf-btn-ghost');
            iconify(a);
        });

        root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea')
            .forEach(el => el.classList.add('vf-input'));
        root.querySelectorAll('input[type="checkbox"]').forEach(el => el.classList.add('vf-checkbox'));
        root.querySelectorAll('input[type="radio"]').forEach(el => el.classList.add('vf-radio'));
        root.querySelectorAll('table').forEach(t => t.classList.add('vf-table'));
        root.querySelectorAll('[title]').forEach(el => el.classList.add('vf-tooltip'));
        root.querySelectorAll('h1, h2, h3').forEach(h => iconify(h));
    }

    document.addEventListener('DOMContentLoaded', () => apply(document));
    if (document.readyState !== 'loading') apply(document);

    const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes.length)) apply(document);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
