import { fetchConfig } from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const cartRoute = (name, fallback) => window.Theme?.routes?.[name] ?? fallback;

export function getCartSectionIds() {
  const ids = new Set();
  for (const element of document.querySelectorAll('cart-items-component[data-section-id]')) {
    if (element instanceof HTMLElement && element.dataset.sectionId) ids.add(element.dataset.sectionId);
  }
  return Array.from(ids);
}

export async function readCartJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status || data.errors) {
    throw new Error(data.description || data.errors || data.message || `Request failed (${response.status})`);
  }
  return data;
}

export function postCart(routeName, fallback, body) {
  return fetch(cartRoute(routeName, fallback), fetchConfig('json', { body: JSON.stringify(body) })).then(readCartJson);
}

export async function getCart(cartItems) {
  if (cartItems && typeof cartItems.fetchCartData === 'function') return cartItems.fetchCartData();
  const response = await fetch(`${cartRoute('cart_url', '/cart')}.js`, { headers: { Accept: 'application/json' } });
  return response.json();
}

export function applySections(sections, sectionIds) {
  for (const id of sectionIds) {
    const html = sections?.[id];
    if (html) {
      sectionRenderer.abortRender(id);
      morphSection(id, html, { mode: 'hydration' });
    } else {
      sectionRenderer.renderSection(id, { cache: false, mode: 'hydration' }).catch(() => {});
    }
  }
}

function dispatchCartEvent(target, options) {
  const deferred = CartLinesUpdateEvent.createPromise();
  try {
    target.dispatchEvent(new CartLinesUpdateEvent({ ...options, promise: deferred.promise }));
    return deferred;
  } catch (error) {
    console.warn('[cart-drawer-cro] Cart event could not be dispatched:', error);
    return null;
  }
}

function resolveCartEvent(deferred, cart, sections) {
  deferred.resolve({
    cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
    detail: {
      sections: sections ?? undefined,
      items: cart.items,
      itemCount: cart.item_count,
      source: 'cart-drawer-cro',
      didError: false,
    },
  });
}

class CartVariantSelect extends HTMLElement {
  connectedCallback() {
    this.addEventListener('change', this.#handleChange);
  }

  disconnectedCallback() {
    this.removeEventListener('change', this.#handleChange);
  }

  #handleChange = async (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;

    const { lineKey, variantId: currentVariantId, quantity, properties, sellingPlan } = this.dataset;
    const nextVariantId = Number(select.value);
    if (!lineKey || !nextVariantId || String(nextVariantId) === currentVariantId) return;

    const row = this.closest('[data-key]');
    const cartItems = this.closest('cart-items-component');
    const sectionIds = getCartSectionIds();
    const lineQuantity = Number(quantity) || 1;
    let added = false;

    this.#hideError(row);
    row?.classList.add('is-busy');
    cartItems?.classList.add('cart-items-disabled');
    for (const id of sectionIds) sectionRenderer.abortRender(id);

    const deferred = dispatchCartEvent(this, {
      action: 'update',
      context: 'cart',
      lines: [{ id: lineKey, quantity: lineQuantity }],
    });

    try {
      const item = { id: nextVariantId, quantity: lineQuantity };
      const parsedProperties = properties ? JSON.parse(properties) : null;
      if (parsedProperties && Object.keys(parsedProperties).length) item.properties = parsedProperties;
      if (sellingPlan) item.selling_plan = Number(sellingPlan);

      await postCart('cart_add_url', '/cart/add', { items: [item] });
      added = true;

      const cart = await postCart('cart_change_url', '/cart/change', {
        id: lineKey,
        quantity: 0,
        sections: sectionIds.join(','),
        sections_url: window.location.pathname,
      });

      if (deferred) {
        resolveCartEvent(deferred, cart, cart.sections);
      } else {
        applySections(cart.sections, sectionIds);
      }
    } catch (error) {
      const message = error?.message || 'Failed to update cart';
      console.error('[cart-drawer-cro] Variant change failed:', error);
      select.value = currentVariantId ?? '';
      deferred?.reject(error);
      this.#showError(row, message);
      this.dispatchEvent(new CartErrorEvent({ error: message, code: 'INVALID' }));
      if (added) applySections(null, sectionIds);
    } finally {
      row?.classList.remove('is-busy');
      cartItems?.classList.remove('cart-items-disabled');
    }
  };

  #showError(row, message) {
    const container = row?.querySelector('[ref^="cartItemErrorContainer-"]');
    const text = row?.querySelector('[ref^="cartItemError-"]');
    if (!container || !text) return;
    text.textContent = message;
    container.classList.remove('hidden');
  }

  #hideError(row) {
    row?.querySelector('[ref^="cartItemErrorContainer-"]')?.classList.add('hidden');
  }
}

class CartQuickAdd extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', this.#handleClick);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#handleClick);
  }

  #handleClick = async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-quick-add-variant]') : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled || this.getAttribute('aria-busy') === 'true') return;

    const variantId = Number(button.dataset.quickAddVariant);
    if (!variantId) return;

    const cartItems = this.closest('cart-items-component');
    const sectionIds = getCartSectionIds();

    this.#setError('');
    this.setAttribute('aria-busy', 'true');
    button.classList.add('is-loading');
    cartItems?.classList.add('cart-items-disabled');
    for (const id of sectionIds) sectionRenderer.abortRender(id);

    const deferred = dispatchCartEvent(this, {
      action: 'add',
      context: 'cart',
      lines: [{ id: String(variantId), quantity: 1 }],
    });

    try {
      const added = await postCart('cart_add_url', '/cart/add', {
        items: [{ id: variantId, quantity: 1 }],
        sections: sectionIds.join(','),
        sections_url: window.location.pathname,
      });

      if (deferred) {
        const cart = await getCart(cartItems);
        resolveCartEvent(deferred, cart, added.sections);
      } else {
        applySections(added.sections, sectionIds);
      }
    } catch (error) {
      const message = error?.message || this.dataset.errorMessage || 'Failed to add item';
      console.error('[cart-drawer-cro] Quick add failed:', error);
      deferred?.reject(error);
      this.#setError(message);
      this.dispatchEvent(new CartErrorEvent({ error: message, code: 'INVALID' }));
    } finally {
      this.removeAttribute('aria-busy');
      button.classList.remove('is-loading');
      cartItems?.classList.remove('cart-items-disabled');
    }
  };

  #setError(message) {
    const element = this.querySelector('[data-quick-add-error]');
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }
}

if (!customElements.get('cart-variant-select')) {
  customElements.define('cart-variant-select', CartVariantSelect);
}

if (!customElements.get('cart-quick-add')) {
  customElements.define('cart-quick-add', CartQuickAdd);
}