import { Component } from '@theme/component';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * Opens a Klaviyo pop-up form on click. Uses the mobile form below the mobile breakpoint
 * and falls back to whichever form ID is set.
 * @extends {Component}
 */
class KlaviyoFormTrigger extends Component {
  /**
   * @param {MouseEvent} event
   */
  openForm(event) {
    const { desktopFormId, mobileFormId } = this.dataset;
    const formId = isMobileBreakpoint() ? mobileFormId || desktopFormId : desktopFormId || mobileFormId;

    if (!formId) return;

    event.preventDefault();

    // Klaviyo's onsite queue works before and after its script loads.
    const klaviyoWindow = /** @type {Window & { _klOnsite?: unknown[] }} */ (window);
    klaviyoWindow._klOnsite = klaviyoWindow._klOnsite || [];
    klaviyoWindow._klOnsite.push(['openForm', formId]);
  }
}

if (!customElements.get('klaviyo-form-trigger')) {
  customElements.define('klaviyo-form-trigger', KlaviyoFormTrigger);
}
