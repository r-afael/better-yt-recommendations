// Names YouTube gives the custom feed tab in supported languages.
// "Custom feed" wordings come from YouTube's Help Center; "Your custom feed"
// wordings follow the English tab name. Matching ignores case, spacing and
// accents, so each wording only needs to be listed once.
globalThis.BetterYT ??= {};
globalThis.BetterYT.CUSTOM_FEED_LABELS = Object.freeze({
  en: ["Your custom feed", "Custom feed"],
  zh: ["自定义信息流", "你的自定义信息流", "自訂動態消息", "你的自訂動態消息"],
  hi: ["कस्टम फ़ीड", "आपकी कस्टम फ़ीड"],
  es: ["Feed personalizado", "Tu feed personalizado"],
  ar: ["خلاصة مخصّصة", "خلاصتك المخصّصة"],
  fr: ["Flux personnalisé", "Votre flux personnalisé"],
  bn: ["কাস্টম ফিড", "আপনার কাস্টম ফিড"],
  pt: ["Feed personalizado", "Seu feed personalizado", "O seu feed personalizado"],
  ru: ["Ваша лента", "Собственная лента"],
  id: ["Feed kustom", "Feed kustom Anda"],
  ko: ["맞춤 피드", "내 맞춤 피드", "사용자 맞춤 피드"],
});
