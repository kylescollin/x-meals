/* Fox & Bear Kitchen — service worker registration.

   Loaded by every page. Purely additive: if service workers aren't supported
   (or the page is opened from a file:// path), this quietly does nothing and
   the site behaves exactly as it always has.

   The goal is that you never get stuck on an old build: when a new service
   worker is found, it is told to activate straight away, and the page reloads
   once so the new code is actually running.
*/
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  // Was this page already controlled when it loaded? If not, this is the very
  // first visit and the worker claiming us is expected — don't reload for it.
  var hadController = !!navigator.serviceWorker.controller;
  var reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // A new worker showing up means new code is available. Activate it now
      // rather than waiting for every tab to close.
      reg.addEventListener('updatefound', function () {
        var incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', function () {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            incoming.postMessage('SKIP_WAITING');
          }
        });
      });
      // Check for a new version whenever the app is brought back to the front.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(function () {
      /* Registration failure is non-fatal — the site works without it. */
    });
  });
})();
