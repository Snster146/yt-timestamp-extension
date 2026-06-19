// Content script runs on youtube.com/watch pages
// Listens for messages from popup to get/seek video time

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // need to fix error
  if (msg.type === 'GET_TIME') {

    const video = document.querySelector('video');
    sendResponse({ time: video ? video.currentTime : 0 });
  }

  if (msg.type === 'SEEK') {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = msg.time;
      video.play().catch(() => {});
    }
    sendResponse({ ok: true });
  }

  return true; // keep channel open for async
});
