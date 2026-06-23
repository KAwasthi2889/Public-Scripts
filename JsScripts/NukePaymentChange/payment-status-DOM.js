// =============================================================
// Nuclear Family - Change "Unpaid" → "Free Revive" (Robust)
// =============================================================
// Paste this into your browser console on https://nuke.family/revive-tracker
//
// Features:
//   - Paginates through all pages automatically
//   - Skips the latest N entries (configurable)
//   - Dry-run mode to preview changes without making them
//   - Graceful stop: type  window.STOP_SCRIPT = true  in console
//   - Retry logic on failures
//   - Verifies each change was applied
//   - Infinite loop protection (max pages)
//   - Closes stale dropdowns before interacting
// =============================================================

(async function () {
  if (window.__PAYMENT_SCRIPT_RUNNING__) {
    console.warn("⚠️ Script is already running!");
    return;
  }
  window.__PAYMENT_SCRIPT_RUNNING__ = true;

  // ─── Configuration ──────────────────────────────────────────
  const config = window.__PAYMENT_CONFIG__ || {};
  const SKIP_LATEST = config.SKIP_LATEST !== undefined ? config.SKIP_LATEST : 4;
  const DRY_RUN = config.DRY_RUN !== undefined ? config.DRY_RUN : false;
  const DELAY_AFTER_CLICK = config.DELAY_AFTER_CLICK !== undefined ? config.DELAY_AFTER_CLICK : 1500;
  const DELAY_DROPDOWN = config.DELAY_DROPDOWN !== undefined ? config.DELAY_DROPDOWN : 500;
  const DELAY_PAGE = config.DELAY_PAGE !== undefined ? config.DELAY_PAGE : 3000;
  const MAX_RETRIES = config.MAX_RETRIES !== undefined ? config.MAX_RETRIES : 2;
  const MAX_PAGES = config.MAX_PAGES !== undefined ? config.MAX_PAGES : 100;
  // ────────────────────────────────────────────────────────────

  // Stop flag — type  window.STOP_SCRIPT = true  in console to stop
  window.STOP_SCRIPT = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Close any open dropdowns on the page
  function closeOpenDropdowns() {
    document.querySelectorAll(".dropdown-menu.show").forEach((menu) => {
      const toggle = menu.parentElement?.querySelector(".dropdown-toggle");
      if (toggle) toggle.click();
    });
  }

  // Wait for badge text to change (with timeout)
  async function waitForBadgeChange(row, expectedText, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const badges = row.querySelectorAll("span.badge");
      for (const badge of badges) {
        if (badge.textContent.trim() === expectedText) return true;
      }
      await sleep(200);
    }
    return false;
  }

  // Check if a row is "Unpaid"
  function isUnpaid(row) {
    const badges = row.querySelectorAll("span.badge");
    for (const badge of badges) {
      if (badge.textContent.trim() === "Unpaid") return true;
    }
    return false;
  }

  // Get player name from row
  function getPlayerName(row, fallbackIndex) {
    const link = row.querySelector("a");
    return link?.textContent.trim() || `Row ${fallbackIndex}`;
  }

  // Attempt to change a single row to Free Revive
  async function changeToFreeRevive(row) {
    closeOpenDropdowns();
    await sleep(200);

    const paymentBtn = row.querySelector(".dropdown-toggle");
    if (!paymentBtn) return { success: false, error: "No payment button" };

    paymentBtn.click();
    await sleep(DELAY_DROPDOWN);

    // Try multiple selectors for the Free Revive option
    let freeReviveItem =
      row.querySelector('.payment-option[data-type="free"]') ||
      row.querySelector('.dropdown-item[data-type="free"]') ||
      Array.from(row.querySelectorAll(".dropdown-item")).find((el) =>
        el.textContent.includes("Free Revive")
      );

    // If not found inside row, check the visible dropdown on the page
    if (!freeReviveItem) {
      const visibleMenu = document.querySelector(".dropdown-menu.show");
      if (visibleMenu) {
        freeReviveItem =
          visibleMenu.querySelector('.payment-option[data-type="free"]') ||
          visibleMenu.querySelector('.dropdown-item[data-type="free"]') ||
          Array.from(visibleMenu.querySelectorAll(".dropdown-item")).find((el) =>
            el.textContent.includes("Free Revive")
          );
      }
    }

    if (!freeReviveItem) {
      paymentBtn.click(); // close dropdown
      await sleep(200);
      return { success: false, error: "Free Revive option not found" };
    }

    if (DRY_RUN) {
      paymentBtn.click(); // close dropdown
      await sleep(200);
      return { success: true, dryRun: true };
    }

    freeReviveItem.click();
    await sleep(DELAY_AFTER_CLICK);

    // Verify the change was applied
    const verified = await waitForBadgeChange(row, "Free Revive", 3000);
    return { success: true, verified };
  }

  // ─── Main Logic ─────────────────────────────────────────────
  console.log("🚀 Starting payment update script...");
  console.log(`   Mode: ${DRY_RUN ? "🔍 DRY RUN (no changes)" : "⚡ LIVE (changes will be made)"}`);
  console.log(`   Skip latest: ${SKIP_LATEST} entries`);
  console.log(`   Stop command: window.STOP_SCRIPT = true\n`);

  let globalIndex = 0;
  let updatedCount = 0;
  let skippedLatest = 0;
  let alreadySetCount = 0;
  let failCount = 0;
  let verifyFailCount = 0;
  let pageNum = 1;

  // Navigate to page 1
  const page1Btn = Array.from(document.querySelectorAll(".page-link")).find(
    (el) => el.textContent.trim() === "1"
  );
  if (page1Btn) {
    page1Btn.click();
    await sleep(DELAY_PAGE);
  }

  while (pageNum <= MAX_PAGES) {
    if (window.STOP_SCRIPT) {
      console.log("\n🛑 Stopped by user (window.STOP_SCRIPT = true)");
      break;
    }

    console.log(`\n📄 --- Page ${pageNum} ---`);

    const rows = Array.from(
      document.querySelectorAll("#revivesTable tbody tr:not(.child)")
    );

    if (rows.length === 0) {
      console.log("⚠️  No rows found. Stopping.");
      break;
    }

    for (const row of rows) {
      if (window.STOP_SCRIPT) break;

      const playerName = getPlayerName(row, globalIndex + 1);

      // Skip latest N
      if (globalIndex < SKIP_LATEST) {
        console.log(`⏭️  [${globalIndex + 1}] Skipping "${playerName}" (latest)`);
        skippedLatest++;
        globalIndex++;
        continue;
      }

      // Check if unpaid
      if (!isUnpaid(row)) {
        alreadySetCount++;
        globalIndex++;
        continue;
      }

      const prefix = DRY_RUN ? "🔍" : "🔄";
      console.log(`${prefix} [${globalIndex + 1}] "${playerName}": Unpaid → Free Revive`);

      // Attempt with retries
      let result = { success: false, error: "Unknown" };
      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        result = await changeToFreeRevive(row);

        if (result.success) break;

        if (attempt <= MAX_RETRIES) {
          console.log(`   ⚠️  Attempt ${attempt} failed: ${result.error}. Retrying...`);
          await sleep(1000);
        }
      }

      if (result.success) {
        if (DRY_RUN) {
          console.log(`   🔍 Would update (dry run)`);
        } else if (result.verified) {
          console.log(`   ✅ Updated & verified`);
        } else {
          console.log(`   ⚠️  Updated but could not verify badge change`);
          verifyFailCount++;
        }
        updatedCount++;
      } else {
        console.error(`   ❌ Failed after ${MAX_RETRIES + 1} attempts: ${result.error}`);
        failCount++;
      }

      globalIndex++;
    }

    if (window.STOP_SCRIPT) break;

    // Next page
    const nextBtn = document.getElementById("revivesTable_next");
    if (!nextBtn || nextBtn.classList.contains("disabled")) {
      console.log("\n📄 No more pages.");
      break;
    }

    console.log("\n➡️  Going to next page...");
    nextBtn.querySelector("a, .page-link").click();
    await sleep(DELAY_PAGE);
    pageNum++;
  }

  if (pageNum > MAX_PAGES) {
    console.warn(`\n⚠️  Reached max page limit (${MAX_PAGES}). Stopped as safety measure.`);
  }

  // ─── Summary ────────────────────────────────────────────────
  console.log("\n========================================");
  console.log(`🏁 ${DRY_RUN ? "DRY RUN" : ""} Complete!`);
  console.log(`   ✅ ${DRY_RUN ? "Would update" : "Updated"}: ${updatedCount}`);
  console.log(`   ⏭️  Skipped (latest ${SKIP_LATEST}): ${skippedLatest}`);
  console.log(`   ☑️  Already paid/free: ${alreadySetCount}`);
  if (verifyFailCount > 0) {
    console.log(`   ⚠️  Updated but unverified: ${verifyFailCount}`);
  }
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📊 Total processed: ${globalIndex}`);
  if (window.STOP_SCRIPT) {
    console.log(`   🛑 Stopped early by user`);
  }
  console.log("========================================");

  window.STOP_SCRIPT = false; // reset for next run
  window.__PAYMENT_SCRIPT_RUNNING__ = false;
})();
