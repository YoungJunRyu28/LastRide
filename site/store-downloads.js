/* Shared bilingual, platform-aware store links. Never copy invite tokens to
 * third-party store URLs and never advertise an unpublished listing. */
(function () {
  "use strict";
  var config = window.LASTRIDE_STORE_LISTINGS || {};
  var hosts = {
    appStore: "apps.apple.com",
    googlePlay: "play.google.com",
    galaxyStore: "galaxystore.samsung.com",
  };
  var names = {
    appStore: { ja: "iPhone · App Store", en: "iPhone · App Store" },
    googlePlay: { ja: "Android · Google Play", en: "Android · Google Play" },
    galaxyStore: { ja: "Samsung · Galaxy Store", en: "Samsung · Galaxy Store" },
  };
  function safeUrl(kind, value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      var url = new URL(value);
      // No invite credentials or arbitrary parameters should leave our site.
      if (url.protocol !== "https:" || url.hostname !== hosts[kind] ||
          url.username || url.password || url.hash) return null;
      if (kind === "googlePlay") {
        // Google Play's canonical listing needs an id query parameter.
        // Normalize to exactly that one parameter (never an invite token).
        if (url.pathname !== "/store/apps/details" ||
            url.searchParams.size !== 1 ||
            url.searchParams.get("id") !== "jp.lastride.app") return null;
        return "https://play.google.com/store/apps/details?id=jp.lastride.app";
      }
      if (url.search) return null;
      return url.href;
    } catch (_error) {
      return null;
    }
  }
  var userAgent = navigator.userAgent || "";
  var android = /android/i.test(userAgent);
  var ios = /iphone|ipad|ipod/i.test(userAgent);
  var order = android
    ? ["googlePlay", "galaxyStore", "appStore"]
    : ios
      ? ["appStore", "googlePlay", "galaxyStore"]
      : ["appStore", "googlePlay", "galaxyStore"];
  document.querySelectorAll("[data-store-links]").forEach(function (container) {
    var lang = container.getAttribute("data-lang") === "en" ? "en" : "ja";
    order.forEach(function (store) {
      var url = safeUrl(store, config[store]);
      if (!url) return;
      var link = document.createElement("a");
      link.className = "btn btn-amber";
      link.href = url;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      link.textContent = names[store][lang];
      container.appendChild(link);
    });
  });
  // Hide a 'coming soon' placeholder only if its matching listing is live.
  document.querySelectorAll("[data-store-placeholder]").forEach(function (node) {
    var key = node.getAttribute("data-store-placeholder");
    if (Object.prototype.hasOwnProperty.call(hosts, key) && safeUrl(key, config[key])) {
      node.hidden = true;
    }
  });
})();
