/* اعمال خودکار کامپوننتهای VibeFarsi بر المانهای موجود و پویا */
(function () {
    function apply(root) {
        if (!root || !root.querySelectorAll) return;

        root.querySelectorAll('button').forEach(btn => {
            if (btn.classList.contains('vf-btn-brand') || btn.classList.contains('vf-btn-danger') || btn.classList.contains('vf-btn-primary')) {
                btn.classList.add('vf-btn');
                return;
            }
            btn.classList.add('vf-btn');
            const id = btn.id || '';
            const label = btn.textContent || '';

            // سلسلهمراتب بصری: اصلی / ثانویه / مشخصشده / شفاف
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
                if (btn.classList.contains('bg-orange-600') || btn.getAttribute('aria-pressed') === 'true') {
                    btn.classList.add('vf-btn-brand');
                } else {
                    btn.classList.add('vf-btn-ghost');
                }
            } else if (btn.closest('#regionButtons')) {
                btn.classList.add('vf-btn-sm', 'vf-btn-ghost');
            } else if (btn.classList.contains('filter-btn') || btn.id === 'loadMoreBtn') {
                btn.classList.add('vf-btn-sm', 'vf-btn-outline');
            } else if (btn.id.startsWith('view') && btn.classList.contains('bg-indigo-700')) {
                btn.classList.add('vf-btn-sm', 'vf-btn-brand');
            }
        });

        // لینکهای نوار بالا شبیه دکمههای شفاف میشوند
        root.querySelectorAll('header a[href]').forEach(a => a.classList.add('vf-btn', 'vf-btn-sm', 'vf-btn-ghost'));

        root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea')
            .forEach(el => el.classList.add('vf-input'));
        root.querySelectorAll('input[type="checkbox"]').forEach(el => el.classList.add('vf-checkbox'));
        root.querySelectorAll('input[type="radio"]').forEach(el => el.classList.add('vf-radio'));
        root.querySelectorAll('table').forEach(t => t.classList.add('vf-table'));
        root.querySelectorAll('[title]').forEach(el => el.classList.add('vf-tooltip'));

        root.querySelectorAll('[id$="ProgressBar"], #progressBar, #auditProgressBar')
            .forEach(el => { el.classList.add('vf-progress'); el.style.height = '100%'; });
    }

    document.addEventListener('DOMContentLoaded', () => apply(document));
    if (document.readyState !== 'loading') apply(document);

    // المانهایی که بعداً توسط JS ساخته میشوند (جدول تجهیزات، کارتها و ...)
    const observer = new MutationObserver(mutations => {
        let pending = false;
        mutations.forEach(m => {
            if (m.addedNodes.length) pending = true;
        });
        // بلافاصله اعمال میشود (requestAnimationFrame در تبهای پسزمینه متوقف میشود)
        if (pending) apply(document);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
