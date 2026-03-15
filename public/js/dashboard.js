/**
 * Dashboard — vanilla JS
 * Row expand/collapse for inline diagnosis.
 * No fetch calls. Everything is server-rendered.
 */
(function () {
  'use strict';

  function init() {
    const table = document.querySelector('.product-table');
    if (!table) return;

    // Delegate clicks on the table body
    table.addEventListener('click', function (e) {
      // Find the closest product-row ancestor of the click target
      const row = e.target.closest('tr.product-row');
      if (!row) return;

      // Don't expand if clicking the product title link
      if (e.target.closest('a.product-title-link')) return;

      const productId = row.dataset.productId;
      const expandedRow = document.getElementById('expanded-' + productId);
      const btn = row.querySelector('.expand-btn');

      if (!expandedRow) return;

      const isOpen = expandedRow.style.display !== 'none';

      if (isOpen) {
        expandedRow.style.display = 'none';
        if (btn) btn.classList.remove('is-open');
        row.setAttribute('aria-expanded', 'false');
      } else {
        expandedRow.style.display = 'table-row';
        if (btn) btn.classList.add('is-open');
        row.setAttribute('aria-expanded', 'true');
      }
    });

    // Keyboard accessibility for rows
    table.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('tr.product-row');
        if (row) {
          e.preventDefault();
          row.click();
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
