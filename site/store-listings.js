// Replace an empty URL only after confirming that store's listing is public.
// These are PUBLIC listing URLs, never credentials or deep-link invite tokens.
window.LASTRIDE_STORE_LISTINGS = Object.freeze({
  appStore: "https://apps.apple.com/jp/app/id6821818204",
  // English pages: Apple's region-free link sends each visitor to their own
  // country's store (in its language) instead of forcing the Japanese one.
  appStoreEn: "https://apps.apple.com/app/id6821818204",
  googlePlay: "",
  galaxyStore: "",
  // Use only a verified, publicly accessible listing for an APPROVED compatible APK.
  // Do not upload/relink a Google Play billing binary as an Uptodown release.
  uptodown: "",
  // AppGallery needs a separate Huawei HMS/map/push/billing compatibility test.
  appGallery: "",
});
