// Background service worker
// Handles any cross-tab coordination if needed

chrome.runtime.onInstalled.addListener(() => {
  // Initialize storage on first install
  chrome.storage.local.get(['bookmarks'], (result) => {
    if (!result.bookmarks) {
      chrome.storage.local.set({ bookmarks: {} });
    }
  });
});
