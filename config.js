const CONFIG = {
  VERSION: "2.1",
  PROXY_URL: "https://great-filter-vps.vercel.app/api/proxy",
  OPENROUTER_API_URL: "https://openrouter.ai/api/v1/chat/completions",
  MODEL: "google/gemma-3-12b-it",
  MAX_TOKENS: 2000,
  MAX_RECOMMENDATION_ITEMS: 25,
  MAX_ITEMS_PER_BATCH: 25,
  MEDIA_LOAD_DELAY_MS: 500,
  AVAILABLE_MODELS: [
    "google/gemma-3-12b-it",
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-flash",
  ],
};

if (typeof globalThis !== "undefined") {
  globalThis.CONFIG = CONFIG;
}
