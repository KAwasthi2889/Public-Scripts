// =============================================================
// Nuclear Family - Change "Unpaid" → "Free Revive" (FAST API)
// =============================================================
// Paste this into your browser console on https://nuke.family/revive-tracker
//
// Speed: Direct API calls with parallel batches.
// Features: Dry-run, stop control, retry, batch parallel requests.
// =============================================================

(async function () {
  if (window.__PAYMENT_SCRIPT_RUNNING__) {
    console.warn("⚠️ Script is already running!");
    return;
  }
  window.__PAYMENT_SCRIPT_RUNNING__ = true;

  // ─── Configuration ──────────────────────────────────────────
  const config = window.__PAYMENT_CONFIG__ || {};
  const SKIP_LATEST = config.SKIP_LATEST !== undefined ? config.SKIP_LATEST : 1;
  const DRY_RUN = config.DRY_RUN !== undefined ? config.DRY_RUN : false;
  const BATCH_SIZE = config.BATCH_SIZE !== undefined ? config.BATCH_SIZE : 5;
  const DELAY_BETWEEN_BATCHES = config.DELAY_BETWEEN_BATCHES !== undefined ? config.DELAY_BETWEEN_BATCHES : 300;
  const PAGE_SIZE = config.PAGE_SIZE !== undefined ? config.PAGE_SIZE : 100;
  const MAX_RETRIES = config.MAX_RETRIES !== undefined ? config.MAX_RETRIES : 2;
  // ────────────────────────────────────────────────────────────

  window.STOP_SCRIPT = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Get CSRF token
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!csrfToken) {
    console.error("❌ CSRF token not found. Are you on nuke.family?");
    return;
  }

  console.log("🚀 Starting FAST payment update script...");
  console.log(`   Mode: ${DRY_RUN ? "🔍 DRY RUN" : "⚡ LIVE"}`);
  console.log(`   Batch size: ${BATCH_SIZE} parallel requests`);
  console.log(`   Skip latest: ${SKIP_LATEST}`);
  console.log(`   Stop: window.STOP_SCRIPT = true\n`);

  // ─── Step 1: Fetch ALL entries via paginated API ────────────
  console.log("📋 Fetching all entries...");
  let allEntries = [];
  let start = 0;
  let totalRecords = 0;

  while (true) {
    const url = `/revive-tracker/data?draw=1&start=${start}&length=${PAGE_SIZE}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });

    if (!resp.ok) {
      console.error(`❌ API error (HTTP ${resp.status}) at start=${start}`);
      break;
    }

    const json = await resp.json();
    totalRecords = json.recordsTotal || totalRecords;
    const entries = json.data || [];

    if (entries.length === 0) break;
    allEntries = allEntries.concat(entries);

    console.log(`   Fetched ${allEntries.length} / ${totalRecords}...`);

    if (allEntries.length >= totalRecords) break;
    start += PAGE_SIZE;
  }

  console.log(`✅ Fetched ${allEntries.length} total entries.\n`);

  // ─── Step 2: Filter to unpaid entries ───────────────────────
  // API returns JSON objects with direct properties:
  //   entry.id            → revive log ID
  //   entry.revivee_name  → player name
  //   entry.payment_status → "Unpaid", "Free Revive", "Paid (Cash)", etc.

  const unpaidEntries = [];
  let skippedLatest = 0;
  let alreadySetCount = 0;

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];

    // Skip latest N
    if (i < SKIP_LATEST) {
      skippedLatest++;
      continue;
    }

    // Check payment status directly from JSON
    if (entry.payment_status !== "Unpaid") {
      alreadySetCount++;
      continue;
    }

    unpaidEntries.push({
      id: entry.id,
      name: `${entry.revivee_name} [${entry.revivee_id}]`,
      index: i,
    });
  }

  console.log("📊 Pre-update summary:");
  console.log(`   ⏭️  Skipped (latest ${SKIP_LATEST}): ${skippedLatest}`);
  console.log(`   ☑️  Already paid/free: ${alreadySetCount}`);
  console.log(`   🔄 To update: ${unpaidEntries.length}\n`);

  if (unpaidEntries.length === 0) {
    console.log("🎉 Nothing to update!");
    window.__PAYMENT_SCRIPT_RUNNING__ = false;
    return;
  }

  if (DRY_RUN) {
    console.log("🔍 DRY RUN — entries that would be updated:");
    unpaidEntries.forEach((e, i) =>
      console.log(`   ${i + 1}. ${e.name} (ID: ${e.id})`)
    );
    console.log(`\n🔍 Set DRY_RUN = false to make changes.`);
    window.__PAYMENT_SCRIPT_RUNNING__ = false;
    return;
  }

  // ─── Step 3: Update in parallel batches ─────────────────────
  console.log(`⚡ Updating ${unpaidEntries.length} entries in batches of ${BATCH_SIZE}...\n`);

  let successCount = 0;
  let failCount = 0;

  for (let batchStart = 0; batchStart < unpaidEntries.length; batchStart += BATCH_SIZE) {
    if (window.STOP_SCRIPT) {
      console.log("\n🛑 Stopped by user.");
      break;
    }

    const batch = unpaidEntries.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(unpaidEntries.length / BATCH_SIZE);

    console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} entries)`);

    // Fire all requests in this batch simultaneously
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
          try {
            const resp = await fetch("/revive-tracker/update-payment", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-CSRF-TOKEN": csrfToken,
                "X-Requested-With": "XMLHttpRequest",
              },
              body: JSON.stringify({
                _token: csrfToken,
                revive_log_id: entry.id,
                payment_type: "free",
              }),
            });

            if (resp.ok) return { entry, success: true };

            if (resp.status === 419) {
              return { entry, success: false, error: "CSRF expired — refresh page" };
            }

            if (attempt <= MAX_RETRIES) {
              await sleep(500 * attempt);
              continue;
            }
            return { entry, success: false, error: `HTTP ${resp.status}` };
          } catch (err) {
            if (attempt <= MAX_RETRIES) {
              await sleep(500 * attempt);
              continue;
            }
            return { entry, success: false, error: err.message };
          }
        }
      })
    );

    for (const result of results) {
      const val = result.status === "fulfilled"
        ? result.value
        : { entry: { name: "?" }, success: false, error: result.reason };
      if (val.success) {
        successCount++;
        console.log(`   ✅ ${val.entry.name}`);
      } else {
        failCount++;
        console.error(`   ❌ ${val.entry.name}: ${val.error}`);
      }
    }

    if (batchStart + BATCH_SIZE < unpaidEntries.length) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  // ─── Summary ────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("🏁 Complete!");
  console.log(`   ✅ Updated: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   ⏭️  Skipped (latest ${SKIP_LATEST}): ${skippedLatest}`);
  console.log(`   ☑️  Already paid/free: ${alreadySetCount}`);
  console.log(`   📊 Total entries: ${allEntries.length}`);
  if (window.STOP_SCRIPT) console.log(`   🛑 Stopped early`);
  console.log("========================================");
  console.log("🔄 Refresh the page to see changes.");

  window.STOP_SCRIPT = false;
  window.__PAYMENT_SCRIPT_RUNNING__ = false;
})();
