// Modal accessibility helpers: Esc to close topmost modal, Tab focus trap, focus restore
(function initModalA11y() {
  const modalSelector = '.modal-backdrop';
  const focusableSelector = 'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const prevFocusStack = [];

  function getOpenModals() {
    return Array.from(document.querySelectorAll(modalSelector)).filter(el => !el.hasAttribute('hidden') && !el.hidden);
  }

  function closeTopModal() {
    const modals = getOpenModals();
    if (!modals.length) return false;
    const top = modals[modals.length - 1];
    const closeBtn = top.querySelector('button[aria-label="关闭"], button[data-modal-close], .modal-head button');
    if (closeBtn) {
      closeBtn.click();
    } else {
      try { top.hidden = true; } catch { }
    }
    return true;
  }

  document.addEventListener('keydown', (ev) => {
    const modals = getOpenModals();
    if (!modals.length) return;
    const top = modals[modals.length - 1];

    if (ev.key === 'Escape') {
      closeTopModal();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (ev.key === 'Tab') {
      const nodes = Array.from(top.querySelectorAll(focusableSelector)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) {
        ev.preventDefault();
        return;
      }
      const idx = nodes.indexOf(document.activeElement);
      if (ev.shiftKey) {
        if (idx <= 0) {
          nodes[nodes.length - 1].focus();
          ev.preventDefault();
        }
      } else {
        if (idx === -1 || idx === nodes.length - 1) {
          nodes[0].focus();
          ev.preventDefault();
        }
      }
    }
  }, true);

  function focusFirstInModal(modal) {
    if (!modal) return;
    const nodes = Array.from(modal.querySelectorAll(focusableSelector)).filter((n) => n.offsetParent !== null);
    if (nodes.length) {
      nodes[0].focus();
      return;
    }
    const btn = modal.querySelector('button[aria-label="关闭"], .modal-head button');
    if (btn) {
      try { btn.focus(); } catch { }
      return;
    }
    try { modal.focus && modal.focus(); } catch { }
  }

  function observeModal(modal) {
    if (!modal) return;
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'hidden') {
          // when hidden becomes false -> opened
          if (!modal.hidden) {
            prevFocusStack.push(document.activeElement);
            focusFirstInModal(modal);
          } else {
            const prev = prevFocusStack.pop();
            if (prev && typeof prev.focus === 'function') {
              try { prev.focus(); } catch { }
            }
          }
        }
      }
    });
    mo.observe(modal, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  }

  // observe existing modals
  const modals = Array.from(document.querySelectorAll(modalSelector));
  modals.forEach(observeModal);

  // observe future added modals
  const bodyObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes || [])) {
        if (node.nodeType === 1 && node.matches && node.matches(modalSelector)) {
          observeModal(node);
        } else if (node.nodeType === 1) {
          const found = node.querySelectorAll && node.querySelectorAll(modalSelector);
          if (found && found.length) {
            Array.from(found).forEach(observeModal);
          }
        }
      }
    }
  });

  if (document.body) bodyObserver.observe(document.body, { childList: true, subtree: true });
})();
