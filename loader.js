// MV3 content scripts cannot be ES modules themselves; bootstrap the real
// entry point as a module so the rest of the code can use import/export.
import(chrome.runtime.getURL('src/main.js'));
