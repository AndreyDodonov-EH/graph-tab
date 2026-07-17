// On first install, open the extension's own repository straight on the
// Graph view (#graph); ?welcome triggers the tour in src/welcome.js.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: 'https://github.com/AndreyDodonov-EH/graph-tab?welcome#graph' });
  }
});
