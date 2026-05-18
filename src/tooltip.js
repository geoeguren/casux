/**
 * tooltip.js — Sistema de tooltips global
 *
 * Uso: agregar data-tooltip="texto" a cualquier elemento.
 * El tooltip se posiciona automáticamente según el espacio disponible,
 * igual que el tooltip nativo del browser.
 *
 * Compatible con elementos dentro de overflow:clip, fixed, sticky, etc.
 * porque el tooltip se appendea directamente al <body>.
 */

window.TOOLTIP = (() => {

  const MARGIN   = 10;  // px entre el elemento y el tooltip
  const OFFSET   = 8;   // px entre el borde del viewport y el tooltip

  let el = null;        // elemento #sm-tooltip
  let _current = null;  // elemento target actual
  let _timer   = null;  // timer de delay

  function _create() {
    if (document.getElementById('sm-tooltip')) return;
    el = document.createElement('div');
    el.id = 'sm-tooltip';
    document.body.appendChild(el);
  }

  function _position(target) {
    if (!el) return;
    const rect  = target.getBoundingClientRect();
    const tw    = el.offsetWidth;
    const th    = el.offsetHeight;
    const vw    = window.innerWidth;
    const vh    = window.innerHeight;

    // Intentar posición en este orden: arriba, abajo, derecha, izquierda
    const positions = [
      { // arriba
        top:   rect.top  - th - MARGIN,
        left:  rect.left + rect.width  / 2 - tw / 2,
        arrow: 'arrow-bottom',
        fits:  rect.top - th - MARGIN >= OFFSET,
      },
      { // abajo
        top:   rect.bottom + MARGIN,
        left:  rect.left + rect.width  / 2 - tw / 2,
        arrow: 'arrow-top',
        fits:  rect.bottom + th + MARGIN + OFFSET <= vh,
      },
      { // derecha
        top:   rect.top  + rect.height / 2 - th / 2,
        left:  rect.right + MARGIN,
        arrow: 'arrow-left',
        fits:  rect.right + tw + MARGIN + OFFSET <= vw,
      },
      { // izquierda
        top:   rect.top  + rect.height / 2 - th / 2,
        left:  rect.left - tw - MARGIN,
        arrow: 'arrow-right',
        fits:  rect.left - tw - MARGIN >= OFFSET,
      },
    ];

    const chosen = positions.find(p => p.fits) || positions[0];

    // Clampear horizontalmente y verticalmente
    let top  = Math.max(OFFSET, Math.min(chosen.top,  vh - th - OFFSET));
    let left = Math.max(OFFSET, Math.min(chosen.left, vw - tw - OFFSET));

    el.style.top  = top  + 'px';
    el.style.left = left + 'px';

    el.className = chosen.arrow;
  }

  function _show(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    _create();
    el.textContent = text;
    el.className   = '';
    el.style.top   = '-9999px';
    el.style.left  = '-9999px';
    // Medir después de que el texto esté en el DOM
    requestAnimationFrame(() => {
      _position(target);
      el.classList.add('visible');
    });
  }

  function _hide() {
    if (!el) return;
    el.classList.remove('visible');
    el.className = '';
  }

  function _update(target) {
    if (!el || !el.classList.contains('visible')) return;
    _position(target);
  }

  function init() {
    _create();

    document.addEventListener('mouseover', e => {
      const target = e.target.closest('[data-tooltip]');
      if (!target || target === _current) return;
      clearTimeout(_timer);
      _current = target;
      _timer = setTimeout(() => _show(target), 300);
    });

    document.addEventListener('mouseout', e => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) {
        // Mouse salió a un elemento sin tooltip — si había uno activo, cancelar
        if (_current && !e.relatedTarget?.closest('[data-tooltip]')) {
          clearTimeout(_timer);
          _current = null;
          _hide();
        }
        return;
      }
      if (target.contains(e.relatedTarget)) return;
      clearTimeout(_timer);
      _current = null;
      _hide();
    });

    document.addEventListener('mousemove', e => {
      if (_current) _update(_current);
    });

    // Ocultar al hacer scroll o click
    document.addEventListener('scroll', _hide, true);
    document.addEventListener('click',  _hide, true);
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };

})();
