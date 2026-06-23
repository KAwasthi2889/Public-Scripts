document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    skipLatest: document.getElementById('skipLatest'),
    batchSize: document.getElementById('batchSize'),
    delayMs: document.getElementById('delayMs'),
    pageSize: document.getElementById('pageSize'),
    maxRetries: document.getElementById('maxRetries'),
    dryRun: document.getElementById('dryRun'),
    scriptMode: document.getElementById('scriptMode'),
    runBtn: document.getElementById('runBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusMsg: document.getElementById('statusMsg')
  };

  // Load saved config
  chrome.storage.local.get(['paymentConfig'], (result) => {
    if (result.paymentConfig) {
      const cfg = result.paymentConfig;
      if (cfg.SKIP_LATEST !== undefined) elements.skipLatest.value = cfg.SKIP_LATEST;
      if (cfg.BATCH_SIZE !== undefined) elements.batchSize.value = cfg.BATCH_SIZE;
      if (cfg.DELAY_BETWEEN_BATCHES !== undefined) elements.delayMs.value = cfg.DELAY_BETWEEN_BATCHES;
      if (cfg.PAGE_SIZE !== undefined) elements.pageSize.value = cfg.PAGE_SIZE;
      if (cfg.MAX_RETRIES !== undefined) elements.maxRetries.value = cfg.MAX_RETRIES;
      if (cfg.DRY_RUN !== undefined) elements.dryRun.checked = cfg.DRY_RUN;
      if (cfg.SCRIPT_MODE !== undefined) elements.scriptMode.value = cfg.SCRIPT_MODE;
    }
  });

  // Check if script is currently running
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab && tab.url.includes("nuke.family")) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => !!window.__PAYMENT_SCRIPT_RUNNING__
      }).then((results) => {
        if (results && results[0] && results[0].result) {
          elements.runBtn.disabled = true;
          elements.runBtn.textContent = "Running...";
          elements.runBtn.style.opacity = "0.5";
          elements.runBtn.style.cursor = "not-allowed";
        }
      }).catch(err => console.error("Could not check running state:", err));
    }
  });

  // Helper to show status
  const showStatus = (msg, isError = false) => {
    elements.statusMsg.textContent = msg;
    elements.statusMsg.style.color = isError ? '#f44336' : '#4caf50';
    setTimeout(() => { elements.statusMsg.textContent = ''; }, 3000);
  };

  // Run Script
  elements.runBtn.addEventListener('click', async () => {
    const config = {
      SKIP_LATEST: parseInt(elements.skipLatest.value, 10),
      BATCH_SIZE: parseInt(elements.batchSize.value, 10),
      DELAY_BETWEEN_BATCHES: parseInt(elements.delayMs.value, 10),
      PAGE_SIZE: parseInt(elements.pageSize.value, 10),
      MAX_RETRIES: parseInt(elements.maxRetries.value, 10),
      DRY_RUN: elements.dryRun.checked,
      SCRIPT_MODE: elements.scriptMode.value
    };

    // Save config for next time
    chrome.storage.local.set({ paymentConfig: config });

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes("nuke.family")) {
      showStatus("Must be on nuke.family", true);
      return;
    }

    try {
      // Inject config into the main page environment
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (cfg) => { 
          window.__PAYMENT_CONFIG__ = cfg; 
          window.STOP_SCRIPT = false; 
        },
        args: [config]
      });

      // Inject the main script directly into the main world
      const scriptFile = elements.scriptMode.value;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        files: [scriptFile]
      });

      showStatus("Script started! Check console.");
      elements.runBtn.disabled = true;
      elements.runBtn.textContent = "Running...";
      elements.runBtn.style.opacity = "0.5";
      elements.runBtn.style.cursor = "not-allowed";
    } catch (err) {
      console.error(err);
      showStatus("Injection failed.", true);
    }
  });

  // Stop Script
  elements.stopBtn.addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => { 
          window.STOP_SCRIPT = true; 
          console.log("🛑 Stop command sent from extension popup."); 
        }
      });
      showStatus("Stop command sent.");
      
      elements.runBtn.disabled = false;
      elements.runBtn.textContent = "Run Script";
      elements.runBtn.style.opacity = "1";
      elements.runBtn.style.cursor = "pointer";
    } catch (err) {
      console.error(err);
      showStatus("Failed to send stop.", true);
    }
  });
});
