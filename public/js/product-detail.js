/**
 * Product Detail — vanilla JS
 * - Image gallery: click thumbnail → swap main image
 * - Smooth scroll to diagnosis section
 */
(function () {
  'use strict';

  function initGallery() {
    const mainImage = document.getElementById('main-image');
    const thumbs = document.querySelectorAll('.gallery-thumb');

    if (!mainImage || thumbs.length === 0) return;

    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        const newSrc = thumb.dataset.src;
        if (!newSrc) return;

        // Fade out → swap → fade in
        mainImage.style.opacity = '0';
        setTimeout(function () {
          mainImage.src = newSrc;
          mainImage.style.opacity = '1';
        }, 150);

        // Update active state
        thumbs.forEach(function (t) { t.classList.remove('gallery-thumb--active'); });
        thumb.classList.add('gallery-thumb--active');
      });
    });
  }

  function initDiagnosisScroll() {
    // If there are issues, smoothly scroll to diagnosis after a short delay
    const diagnosisSection = document.getElementById('diagnosis');
    const flagChips = document.querySelectorAll('.flag-chip');

    if (!diagnosisSection || flagChips.length === 0) return;

    // Don't auto-scroll — let user discover naturally.
    // But add click-to-scroll on flag chips.
    flagChips.forEach(function (chip) {
      chip.style.cursor = 'pointer';
      chip.title = 'Click to see details';
      chip.addEventListener('click', function () {
        diagnosisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function init() {
    initGallery();
    initDiagnosisScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
