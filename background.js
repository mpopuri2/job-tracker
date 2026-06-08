chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open onboarding page on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  }
})

// Handle token refresh — remove cached token on auth error so next call re-authenticates
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CLEAR_AUTH_TOKEN') {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => sendResponse({ done: true }))
      } else {
        sendResponse({ done: true })
      }
    })
    return true // keep channel open for async response
  }
})
