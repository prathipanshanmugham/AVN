/* Google Analytics 4 — loaded only when a GA ID is set in Settings. Kept in a file because the CSP blocks inline scripts. */
(function () {
  var id = document.currentScript && document.currentScript.getAttribute('data-ga');
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}());
