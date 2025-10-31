function isRecommendationRequest(requestBody) {
  const messageContent = requestBody.messages?.[0]?.content;

  if (typeof messageContent === "string") {
    return messageContent.toLowerCase().includes("suggest");
  }

  if (Array.isArray(messageContent)) {
    return messageContent.some(entry =>
      entry?.type === "text" && entry?.text?.toLowerCase().includes("suggest")
    );
  }

  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isRecommendationRequest };
}

if (typeof globalThis !== "undefined") {
  globalThis.TestUtils = { isRecommendationRequest };
}
