(function() {
  'use strict';

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_CHANGED') {
      if (message.state && message.state.urlFilters) {
        browser.storage.local.set({ ryujin_url_filters: message.state.urlFilters });
      }
    }
  });
})();