/* اعمال خودکار کامپوننتهای VibeFarsi بر المانهای موجود و پویا */
(function () {
    function apply(root) {
        if (!root || !root.querySelectorAll) return;

        root.querySelectorAll('button').forEach(btn => {
            btn.classList.add('vf-btn');
            if (btn.id === 'finalizeBtn' || btn.classList.contains('vf-primary')) btn.classList.add('vf-btn-primary');
        });

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
