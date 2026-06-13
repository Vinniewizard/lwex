const originalSetItem = localStorage.setItem;
localStorage.setItem = (key: string, value: string) => {
  try {
     originalSetItem.call(localStorage, key, value);
  } catch (e) {
     if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
         console.warn('Quota exceeded, clearing old ticks');
         Object.keys(localStorage).forEach(k => {
            if (k.startsWith('lwex_ticks_history')) localStorage.removeItem(k);
         });
         try {
             originalSetItem.call(localStorage, key, value);
         } catch (e2) {}
     }
  }
};
export default {};
