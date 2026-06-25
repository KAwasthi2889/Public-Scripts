// ==UserScript==
// @name         Torn Fast Revives (Discord Gateway)
// @namespace    http://tampermonkey.net/
// @version      3.6.0
// @description  Auto-confirms revives based on success chance and player status. Communicates directly with the local Go Discord Gateway to log successes, manage daily quotas, and auto-close tabs.
// @author       fourzees [3002874] & Dobre [3944280] & Upsilon [3212478] & Ever2889 [4040971]
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/hospitalview.php*
// @updateURL    https://raw.githubusercontent.com/KAwasthi2889/Public-Scripts/main/JsScripts/FastRevive/fast_revive.user.js
// @downloadURL  https://raw.githubusercontent.com/KAwasthi2889/Public-Scripts/main/JsScripts/FastRevive/fast_revive.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @license      MIT
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    let isConfirming = false;
    let isAutoReviveTab = false;
    let cbport = null;
    let gatewayXid = null;
    let minChanceOverride = null;
    let requiredStatus = null;
    const resetConfirming = () => { isConfirming = false; };

    function logToGateway(status, reason, overrideXid = null) {
        const xid = overrideXid || gatewayXid;
        if (cbport && xid) {
            const url = `http://127.0.0.1:${cbport}/revive?xid=${xid}&status=${status}&reason=${encodeURIComponent(reason)}&_t=${Date.now()}`;
            if (typeof GM_xmlhttpRequest !== "undefined") {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    onload: () => {
                        console.log(`[FastRevive] Callback fired to port ${cbport}: status=${status}`);
                        if (isAutoReviveTab) window.close();
                    },
                    onerror: (e) => {
                        console.error("[FastRevive] GM_xmlhttpRequest failed:", e);
                        if (isAutoReviveTab) window.close();
                    }
                });
            } else {
                console.error("[FastRevive] Fatal: GM_xmlhttpRequest not granted!");
                if (isAutoReviveTab) window.close();
            }
        }
    }

    // Default settings with safe parsing
    let settings = {
        threshold: 60,
        blockEarlyDischarge: true
    };
    try {
        const stored = localStorage.getItem('fastReviveSettings');
        if (stored) {
            settings = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('[FastRevive] Corrupted settings found in localStorage. Reverting to defaults.', e);
        // Overwrite the corrupted data
        localStorage.setItem('fastReviveSettings', JSON.stringify(settings));
    }

    function saveSettings() {
        localStorage.setItem('fastReviveSettings', JSON.stringify(settings));
    }

    const isHospital = window.location.href.includes("hospitalview.php");

    // Utility function to parse success chance and early discharge info from a specific container
    function getReviveInfo(container = document.body) {
        // Find the active confirm dialog text
        let pageText = "";
        const confirmDialog = container.querySelector('.confirm-revive');

        if (confirmDialog) {
            pageText = confirmDialog.innerText || confirmDialog.textContent;
        } else {
            // Fallback for profile where there might not be a specific .confirm-revive container
            pageText = container.innerText || container.textContent;
        }

        const match = pageText.match(/(\d+(?:\.\d+)?)% chance of success/);
        const chance = match ? parseFloat(match[1]) : null;
        const isEarlyDischarge = pageText.includes("Early Discharge");

        return { chance, isEarlyDischarge };
    }

    // Automatically click "Yes" if the success chance meets the threshold and early discharge rules
    function autoConfirmRevive(mutations) {
        if (isConfirming) return;

        const watchForSuccessAndClose = () => {
            if (!isAutoReviveTab) return;

            // Extract XID from URL to send back to the gateway
            const xid = new URLSearchParams(window.location.search).get("XID");
            if (xid) gatewayXid = xid;

            let successFound = false;

            const successObserver = new MutationObserver((m, obs) => {
                // Look for the specific Torn response container
                const responseTextEl = document.querySelector('.profile-buttons-dialog .center-block .text');

                if (responseTextEl) {
                    const text = responseTextEl.textContent.trim();
                    if (text.includes("chance of success")) {
                        return; // Ignore the initial probability prompt
                    }
                    const isSuccess = responseTextEl.classList.contains('t-green') || text.includes('successfully revived');

                    if (cbport && xid) {
                        const status = isSuccess ? 'success' : 'fail';
                        const reason = isSuccess ? '' : text;
                        logToGateway(status, reason, xid);
                    }

                    successFound = true;
                    obs.disconnect();
                }
            });

            successObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

            // Stop observing after 9 seconds if not found
            setTimeout(() => {
                successObserver.disconnect();
                if (!successFound) {
                    const msg = '[FastRevive] Success message not found within 9s.';
                    console.log(msg);
                    logToGateway('fail', msg);
                }
            }, 9000);
        };

        if (isHospital) {
            // On hospital, we need to find which list item opened the confirmation
            // The MutationObserver triggers when the dialog is shown. We look for a visible .confirm-revive
            const listItems = document.querySelectorAll('.user-info-list-wrap li');
            for (const li of listItems) {
                const confirmRevive = li.querySelector('.confirm-revive');
                if (confirmRevive && getComputedStyle(confirmRevive).display !== 'none') {
                    const yesButton = li.querySelector('.action-yes');
                    if (yesButton) {
                        const reviveInfo = getReviveInfo(li);
                        if (reviveInfo.chance !== null && reviveInfo.chance >= settings.threshold) {
                            // If on hospital and block early discharge is enabled, and patient is early discharge, block it
                            if (settings.blockEarlyDischarge && reviveInfo.isEarlyDischarge) {
                                continue; // Skip to the next visible one
                            }

                            // Otherwise, click Yes
                            isConfirming = true;
                            yesButton.click();

                            setTimeout(resetConfirming, 500);
                            return; // Return early since we found and clicked a valid one
                        }
                    }
                }
            }
        } else {
            // Profile logic
            const yesButton = document.querySelector('.confirm-action-yes') || document.querySelector('.confirm-action'); // Try both generic selectors
            if (yesButton) {
                const reviveInfo = getReviveInfo(document.body);
                if (reviveInfo.chance !== null) {
                    const effectiveThreshold = minChanceOverride !== null ? Math.max(settings.threshold, minChanceOverride) : settings.threshold;
                    if (reviveInfo.chance >= effectiveThreshold) {
                        isConfirming = true;
                        yesButton.click();

                        if (isAutoReviveTab) {
                            watchForSuccessAndClose();
                        }

                        setTimeout(resetConfirming, 500);
                    } else if (isAutoReviveTab) {
                        logToGateway('fail', `[FastRevive] Skipped auto-revive — chance ${reviveInfo.chance}% is below effective threshold ${effectiveThreshold}%.`);
                    }
                } else if (isAutoReviveTab) {
                    logToGateway('fail', '[FastRevive] Could not determine success chance.');
                }
            }
        }
    }

    // Function to create a button for setting the success threshold
    function createSettingsUI() {
        if (isHospital) {
            // Add to hospital page msg-info-wrap
            const waitForElm = (selector) => {
                return new Promise(resolve => {
                    if (document.querySelector(selector)) return resolve(document.querySelector(selector));
                    const observer = new MutationObserver(mutations => {
                        if (document.querySelector(selector)) {
                            observer.disconnect();
                            resolve(document.querySelector(selector));
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                });
            };

            waitForElm('.msg-info-wrap').then((msgItemWrap) => {
                if (msgItemWrap.querySelector('.fast-revives-container')) return;

                const container = document.createElement('div');
                container.classList.add('fast-revives-container');
                container.style.display = 'flex';
                container.style.alignItems = 'center';
                container.style.gap = '15px';
                container.style.marginTop = '10px';

                // Threshold Button
                const p = document.createElement('p');
                p.textContent = `Set FastRevive Threshold (${settings.threshold}%)`;
                p.style.cursor = 'pointer';
                p.style.color = 'var(--default-blue-color)';
                p.style.fontWeight = 'bold';

                p.addEventListener('click', () => {
                    const newThreshold = prompt('Enter the success threshold (as a percentage):', settings.threshold);
                    if (newThreshold !== null) {
                        const parsedValue = parseFloat(newThreshold);
                        if (!isNaN(parsedValue) && parsedValue >= 0 && parsedValue <= 100) {
                            settings.threshold = parsedValue;
                            saveSettings();
                            p.textContent = `Set FastRevive Threshold (${settings.threshold}%)`;
                            alert(`Success threshold updated to ${settings.threshold}%`);
                        } else {
                            alert('Invalid input. Please enter a number between 0 and 100.');
                        }
                    }
                });

                // Early Discharge Toggle
                const toggleText = document.createElement('p');
                toggleText.textContent = `Block Early Discharge: ${settings.blockEarlyDischarge ? 'ON' : 'OFF'}`;
                toggleText.style.cursor = 'pointer';
                toggleText.style.color = 'var(--default-blue-color)';
                toggleText.style.fontWeight = 'bold';

                toggleText.addEventListener('click', () => {
                    settings.blockEarlyDischarge = !settings.blockEarlyDischarge;
                    saveSettings();
                    toggleText.textContent = `Block Early Discharge: ${settings.blockEarlyDischarge ? 'ON' : 'OFF'}`;
                });

                container.appendChild(p);
                container.appendChild(toggleText);
                msgItemWrap.appendChild(container);

                // Observe msgItemWrap changes to re-add if needed
                const msgObserver = new MutationObserver(() => {
                    if (!msgItemWrap.querySelector('.fast-revives-container')) {
                        msgItemWrap.appendChild(container);
                    }
                });
                msgObserver.observe(msgItemWrap, { childList: true, subtree: true });
            });

        } else {
            // Profile page logic
            const actionsText = document.querySelector('.title-black');
            if (actionsText) {
                const button = document.createElement('button');
                button.textContent = `Set Revive Threshold (${settings.threshold}%)`;
                button.style.marginLeft = '10px';
                button.style.cursor = 'pointer';
                button.style.color = '#FF0000';

                button.addEventListener('click', () => {
                    const newThreshold = prompt('Enter the success threshold (as a percentage):', settings.threshold);
                    if (newThreshold !== null) {
                        const parsedValue = parseFloat(newThreshold);
                        if (!isNaN(parsedValue) && parsedValue >= 0 && parsedValue <= 100) {
                            settings.threshold = parsedValue;
                            saveSettings();
                            button.textContent = `Set Revive Threshold (${settings.threshold}%)`;
                            alert(`Success threshold updated to ${settings.threshold}%`);
                        } else {
                            alert('Invalid input. Please enter a number between 0 and 100.');
                        }
                    }
                });
                actionsText.parentNode.insertBefore(button, actionsText.nextSibling);
            }
        }
    }

    // Observe DOM changes — when the confirmation dialog appears, auto-confirm if above threshold
    let debounceTimer;

    const observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            autoConfirmRevive(mutations);
        }, 50);
    });

    // Profile-only revive triggering
    if (!isHospital) {
        // Fix hash bug: save hash before modifying history
        const savedHash = window.location.hash;

        // Check if the page was opened by the gateway (URL contains #autorevive)
        isAutoReviveTab = savedHash.includes('autorevive');

        if (isAutoReviveTab) {
            gatewayXid = new URLSearchParams(window.location.search).get("XID");

            // Fix #6: Strip the hash immediately so F5/refresh won't re-trigger
            history.replaceState(null, '', window.location.pathname + window.location.search);

            // Parse callback port
            const portMatch = savedHash.match(/cbport=(\d+)/);
            if (portMatch) {
                cbport = parseInt(portMatch[1], 10);
            }

            // Minimum account age (in days) required for auto-revive.
            let MIN_AGE_DAYS = 365;
            const hashMatch = savedHash.match(/autorevive=(\d+)/);
            if (hashMatch) {
                const parsedAge = parseInt(hashMatch[1], 10);
                if (!isNaN(parsedAge) && parsedAge > 0) {
                    MIN_AGE_DAYS = parsedAge;
                }
            }

            // Parse minChance override
            const minChanceMatch = savedHash.match(/minChance=(\d+)/);
            if (minChanceMatch) {
                const parsedChance = parseInt(minChanceMatch[1], 10);
                if (!isNaN(parsedChance) && parsedChance >= 0) {
                    minChanceOverride = parsedChance;
                }
            }

            // Parse required status
            const statusMatch = savedHash.match(/status=([^&]+)/);
            if (statusMatch) {
                requiredStatus = decodeURIComponent(statusMatch[1]).toUpperCase();
            }

            const getPlayerAgeDays = () => {
                const ttAge = document.querySelector('.tt-age-text');
                if (ttAge) {
                    const text = ttAge.textContent.trim();
                    let totalDays = 0;
                    let matched = false;

                    const years = text.match(/(\d+)\s*year/i);
                    const months = text.match(/(\d+)\s*month/i);
                    const days = text.match(/(\d+)\s*day/i);

                    if (years) { totalDays += parseInt(years[1], 10) * 365; matched = true; }
                    if (months) { totalDays += parseInt(months[1], 10) * 30; matched = true; }
                    if (days) { totalDays += parseInt(days[1], 10); matched = true; }

                    if (matched) return totalDays;
                }

                const ageBox = document.querySelector('.box-info.age');
                if (ageBox) {
                    const digits = ageBox.querySelectorAll('.digit');
                    let numStr = '';
                    digits.forEach(d => { numStr += d.textContent.trim(); });
                    const parsed = parseInt(numStr, 10);
                    if (!isNaN(parsed)) return parsed;
                }

                return null;
            };

            const clickReviveButton = (revButton) => {
                // Check if the player has revives disabled
                if (revButton.classList.contains('disabled') || revButton.classList.contains('cross')) {
                    if (isAutoReviveTab && gatewayXid) {
                        const msg = '[FastRevive] Revive button is disabled (target may be travelling, dead, or already reviving).';
                        logToGateway('fail', msg);
                    }
                    return;
                }

                // Fix #5: Small delay to let Torn's JS bind event handlers to the button
                setTimeout(() => {
                    // Check required player status (Online/Offline/Away)
                    if (requiredStatus && requiredStatus !== 'ANY') {
                        const statusIcon = document.querySelector('li[class*="user-status-16-"]');
                        let currentStatus = "UNKNOWN";
                        if (statusIcon) {
                            const match = statusIcon.className.match(/user-status-16-([a-zA-Z]+)/);
                            if (match) currentStatus = match[1].toUpperCase();
                        }
                        if (currentStatus !== requiredStatus) {
                            const msg = `[FastRevive] Skipped auto-revive — player is ${currentStatus}, but contract requires ${requiredStatus}.`;
                            console.log(msg);
                            logToGateway('fail', msg);
                            return;
                        }
                    }

                    // Check player age before auto-reviving
                    const ageDays = getPlayerAgeDays();
                    if (ageDays !== null && ageDays < MIN_AGE_DAYS) {
                        const msg = `[FastRevive] Skipped auto-revive — player age ${ageDays} days is under ${MIN_AGE_DAYS} day minimum.`;
                        console.log(msg);
                        logToGateway('fail', msg);
                        return;
                    }

                    revButton.click();
                }, 150);
            };

            const existingButton = document.querySelector('.profile-button-revive');
            if (existingButton) {
                clickReviveButton(existingButton);
            } else {
                let autoReviveTimeout;

                // Wait for the revive button to appear in the DOM
                const autoReviveObserver = new MutationObserver(() => {
                    const revButton = document.querySelector('.profile-button-revive');
                    if (revButton) {
                        autoReviveObserver.disconnect();
                        if (autoReviveTimeout) clearTimeout(autoReviveTimeout);
                        clickReviveButton(revButton);
                    }
                });
                autoReviveObserver.observe(document.body, { childList: true, subtree: true });

                // Fix #1: Timeout — disconnect observer after 10s if button never appears
                autoReviveTimeout = setTimeout(() => {
                    autoReviveObserver.disconnect();
                    const msg = '[FastRevive] Auto-revive timed out — revive button not found.';
                    console.log(msg);
                    logToGateway('fail', msg);
                }, 10000);
            }
        }

        // 'R' key always available as manual trigger (for retries or normal browsing)
        document.addEventListener('keydown', (event) => {
            //Check if user is typing, and block revive attempt if so. Thanks Dobre [3944280] for this fix!
            const active = document.activeElement;
            const isTyping = active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.isContentEditable
            );
            if (isTyping) return;

            if (event.key.toLowerCase() === 'r' && !event.repeat) {
                const revButton = document.querySelector('.profile-button-revive');
                if (revButton) {
                    revButton.click();
                }
            }
        });
    }

    // Start observing the page for changes
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial setup
    createSettingsUI();
})();
