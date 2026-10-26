/**
 * =============================================================================
 * MnemioAI Dashboard Application Logic
 * =============================================================================
 */

let currentPage = 1;
const PAGE_LIMIT = 20;
let currentSearch = "";
let currentStatus = "ALL";

// DOM Elements
const clockDisplay = document.getElementById("clockTimeDisplay");
const statTotal = document.getElementById("statTotalContacts");
const statDueToday = document.getElementById("statDueToday");
const statDueTomorrow = document.getElementById("statDueTomorrow");
const statReplies = document.getElementById("statReplies");
const statReplyRate = document.getElementById("statReplyRate");
const statBounces = document.getElementById("statBounces");
const statBounceRate = document.getElementById("statBounceRate");
const funnelGrid = document.getElementById("funnelGrid");
const mailboxList = document.getElementById("mailboxList");
const contactsTbody = document.getElementById("contactsTableBody");
const searchInput = document.getElementById("contactSearchInput");
const statusFilter = document.getElementById("contactStatusFilter");
const btnPrev = document.getElementById("btnPrevPage");
const btnNext = document.getElementById("btnNextPage");
const pageIndicator = document.getElementById("pageIndicator");
const actionMsg = document.getElementById("actionStatusMessage");

// Modal Elements
const modalBackdrop = document.getElementById("contactModalBackdrop");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalContactName = document.getElementById("modalContactName");
const modalContactMeta = document.getElementById("modalContactMeta");
const modalBadges = document.getElementById("modalBadges");
const modalEmailTimeline = document.getElementById("modalEmailTimeline");
const modalReplyTimeline = document.getElementById("modalReplyTimeline");

// Helper to format ISO dates cleanly
function formatDate(isoStr) {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  }) + " UTC";
}

// Display temporary notification banner
function showNotification(msg, isError = false) {
  actionMsg.style.display = "block";
  actionMsg.textContent = msg;
  actionMsg.style.backgroundColor = isError ? "#fef2f2" : "#eef2ff";
  actionMsg.style.color = isError ? "#dc2626" : "#4f46e5";
  actionMsg.style.borderColor = isError ? "#fca5a5" : "#c7d2fe";

  setTimeout(() => {
    actionMsg.style.display = "none";
  }, 4500);
}

// -----------------------------------------------------------------------------
// 1. Fetch & Render Campaign Report
// -----------------------------------------------------------------------------
async function loadReport() {
  try {
    const res = await fetch("/api/report");
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const report = json.data;

    // Clock
    clockDisplay.textContent = report.virtualClock.formatted;

    // Top KPI Stats
    statTotal.textContent = report.statusCounts.total.toLocaleString();
    statDueToday.textContent = report.activityToday.totalDueToday.toLocaleString();
    statDueTomorrow.textContent = `Due tomorrow: ${report.activityToday.dueTomorrow.toLocaleString()} | Due now: ${report.activityToday.dueNow.toLocaleString()}`;

    statReplies.textContent = report.rates.totalReplies.toLocaleString();
    statReplyRate.textContent = `Reply rate: ${report.rates.replyRatePercent}% (delivered: ${report.rates.totalDelivered.toLocaleString()})`;

    statBounces.textContent = report.rates.totalBounces.toLocaleString();
    statBounceRate.textContent = `Bounce rate: ${report.rates.bounceRatePercent}% (Suppressed: ${report.rates.totalSuppressed.toLocaleString()})`;

    // Funnel Grid
    const funnelStatuses = [
      { key: "new", label: "New" },
      { key: "first_sent", label: "Initial Sent" },
      { key: "follow_up_1_sent", label: "Follow-Up 1" },
      { key: "follow_up_2_sent", label: "Follow-Up 2" },
      { key: "follow_up_3_sent", label: "Follow-Up 3" },
      { key: "replied", label: "Replied" },
      { key: "bounced", label: "Bounced" },
      { key: "unsubscribed", label: "Unsubscribed" },
      { key: "deactivated", label: "Deactivated" }
    ];

    funnelGrid.innerHTML = funnelStatuses
      .map((st) => {
        const count = report.statusCounts[st.key] || 0;
        const pct = report.statusCounts.total > 0 ? ((count / report.statusCounts.total) * 100).toFixed(1) : "0.0";
        return `
          <div class="funnel-card">
            <div class="funnel-label">${st.label}</div>
            <div class="funnel-count">${count.toLocaleString()}</div>
            <div class="funnel-pct">${pct}%</div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Failed to load report:", err);
  }
}

// -----------------------------------------------------------------------------
// 2. Fetch & Render Mailboxes (Warm-Up & Spam Management)
// -----------------------------------------------------------------------------
async function loadMailboxes() {
  try {
    const res = await fetch("/api/mailboxes");
    const json = await res.json();
    if (!json.success) return;

    const mailboxes = json.data;
    if (mailboxes.length === 0) {
      mailboxList.innerHTML = `<p style="font-size:12px;color:#94a3b8;">No mailboxes configured.</p>`;
      return;
    }

    mailboxList.innerHTML = mailboxes
      .map((m) => {
        const usagePct = Math.min(100, (m.sentTodayCount / m.dailyLimit) * 100);
        const statusBadge = m.isPaused
          ? `<span class="mailbox-badge paused">PAUSED (High Bounces)</span>`
          : `<span class="mailbox-badge active">HEALTHY</span>`;

        return `
          <div class="mailbox-item">
            <div class="mailbox-top">
              <span class="mailbox-email">${m.email}</span>
              ${statusBadge}
            </div>
            <div class="mailbox-progress-bar">
              <div class="mailbox-progress-fill" style="width: ${usagePct}%;"></div>
            </div>
            <div class="mailbox-meta">
              <span>Today: ${m.sentTodayCount} / ${m.dailyLimit} quota</span>
              <span>Total: ${m.totalSent} sent (${m.totalBounced} bounces)</span>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Failed to load mailboxes:", err);
  }
}

// -----------------------------------------------------------------------------
// 3. Fetch & Render Contacts Table
// -----------------------------------------------------------------------------
async function loadContacts() {
  contactsTbody.innerHTML = `<tr><td colspan="5" class="table-loading">Loading prospects...</td></tr>`;

  try {
    const params = new URLSearchParams({
      page: currentPage.toString(),
      limit: PAGE_LIMIT.toString()
    });

    if (currentStatus !== "ALL") params.append("status", currentStatus);
    if (currentSearch) params.append("search", currentSearch);

    const res = await fetch(`/api/contacts?${params.toString()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const { contacts, total, totalPages } = json.data;

    document.getElementById("contactsCountTag").textContent = `${total.toLocaleString()} Contacts`;
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages || 1} (${total.toLocaleString()} total)`;
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage >= totalPages;

    if (contacts.length === 0) {
      contactsTbody.innerHTML = `<tr><td colspan="5" class="table-loading">No contacts found matching filter.</td></tr>`;
      return;
    }

    contactsTbody.innerHTML = contacts
      .map((c) => {
        return `
          <tr>
            <td>
              <div class="contact-name-cell">${escapeHtml(c.name)}</div>
              <div class="contact-email-sub">${escapeHtml(c.email)}</div>
            </td>
            <td>
              <div>${escapeHtml(c.company || "N/A")}</div>
              <div class="contact-email-sub">${escapeHtml(c.role)} (${c.timezone})</div>
            </td>
            <td>
              <span class="badge badge-${c.status}">${c.status}</span>
            </td>
            <td>
              <div>${c.nextActionAt ? formatDate(c.nextActionAt) : '<span style="color:#94a3b8;">None (Ended)</span>'}</div>
            </td>
            <td>
              <button class="btn btn-sm btn-outline btn-inspect" data-id="${c.id}">
                Inspect
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    // Bind inspect buttons
    document.querySelectorAll(".btn-inspect").forEach((btn) => {
      btn.addEventListener("click", () => openContactModal(btn.dataset.id));
    });
  } catch (err) {
    contactsTbody.innerHTML = `<tr><td colspan="5" class="table-loading" style="color:#ef4444;">Failed to load contacts: ${err.message}</td></tr>`;
  }
}

// -----------------------------------------------------------------------------
// 4. Contact Audit Modal
// -----------------------------------------------------------------------------
async function openContactModal(contactId) {
  modalBackdrop.style.display = "flex";
  modalContactName.textContent = "Loading audit trail...";
  modalContactMeta.textContent = "";
  modalBadges.innerHTML = "";
  modalEmailTimeline.innerHTML = "<p style='color:#94a3b8;font-size:12px;'>Loading...</p>";
  modalReplyTimeline.innerHTML = "<p style='color:#94a3b8;font-size:12px;'>Loading...</p>";

  try {
    const res = await fetch(`/api/contacts/${contactId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    const { contact, isSuppressed, suppressionReason } = json.data;

    modalContactName.textContent = contact.name;
    modalContactMeta.textContent = `${contact.email} • ${contact.role} at ${contact.company} (${contact.timezone})`;

    // Badges
    let suppressionBadge = isSuppressed
      ? `<span class="badge badge-bounced">SUPPRESSED (${suppressionReason})</span>`
      : "";

    modalBadges.innerHTML = `
      <span class="badge badge-${contact.status}">${contact.status}</span>
      <span class="badge badge-new">Current Step: ${contact.currentStep >= 0 ? contact.currentStep : "Ended"}</span>
      ${suppressionBadge}
    `;

    // Email Timeline
    if (contact.emails.length === 0) {
      modalEmailTimeline.innerHTML = `<p style="font-size:12px;color:#94a3b8;">No outbound emails sent yet.</p>`;
    } else {
      modalEmailTimeline.innerHTML = contact.emails
        .map(
          (em) => `
          <div class="timeline-item">
            <div class="timeline-date">Step ${em.step} • Sent: ${formatDate(em.sentAt)} • Status: <strong>${em.status}</strong></div>
            <div class="timeline-subject">${escapeHtml(em.subject)}</div>
            <div class="timeline-body">${escapeHtml(em.body)}</div>
          </div>
        `
        )
        .join("");
    }

    // Reply Timeline
    if (contact.replies.length === 0) {
      modalReplyTimeline.innerHTML = `<p style="font-size:12px;color:#94a3b8;">No replies recorded.</p>`;
    } else {
      modalReplyTimeline.innerHTML = contact.replies
        .map(
          (rp) => `
          <div class="timeline-item" style="border-left-color: #10b981;">
            <div class="timeline-date">Received: ${formatDate(rp.receivedAt)} • Intent: <strong>${rp.classification}</strong></div>
            <div class="timeline-body">${escapeHtml(rp.body)}</div>
          </div>
        `
        )
        .join("");
    }
  } catch (err) {
    modalContactName.textContent = "Error loading contact";
    modalContactMeta.textContent = err.message;
  }
}

function closeContactModal() {
  modalBackdrop.style.display = "none";
}

// -----------------------------------------------------------------------------
// 5. Button Actions & Event Listeners
// -----------------------------------------------------------------------------

// Advance +3 Days
document.getElementById("btnAdvance3Days").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/clock/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 3 })
    });
    const json = await res.json();
    if (json.success) {
      showNotification(`⏩ Virtual Clock advanced by 3 days!`);
      await refreshAll();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, true);
  }
});

// Advance +7 Days
document.getElementById("btnAdvance7Days").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/clock/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 })
    });
    const json = await res.json();
    if (json.success) {
      showNotification(`⏩ Virtual Clock advanced by 7 days!`);
      await refreshAll();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, true);
  }
});

// Run Sequence Cycle
document.getElementById("btnRunSequence").addEventListener("click", async () => {
  const btn = document.getElementById("btnRunSequence");
  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const res = await fetch("/api/sequence/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchSize: 1000 })
    });
    const json = await res.json();
    if (json.success) {
      const d = json.data;
      showNotification(
        `🚀 Outreach run complete: ${d.contactsScanned} scanned, ${d.emailsSent} sent, ${d.bounces} bounced, ${d.deactivations} deactivated in ${(d.durationMs / 1000).toFixed(2)}s!`
      );
      await refreshAll();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>🚀</span> Run Sequence Cycle`;
  }
});

// Simulate Replies
document.getElementById("btnSimulateReplies").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/replies/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 20 })
    });
    const json = await res.json();
    if (json.success) {
      showNotification(`📬 Simulated ${json.data.simulated} incoming replies! Outreach halted for responders.`);
      await refreshAll();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, true);
  }
});

// Reset 10k Seed
document.getElementById("btnResetSeed").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to reset and re-seed all 10,000 contacts?")) return;

  const btn = document.getElementById("btnResetSeed");
  btn.disabled = true;
  btn.textContent = "Seeding 10k...";

  try {
    const res = await fetch("/api/seed", { method: "POST" });
    const json = await res.json();
    if (json.success) {
      showNotification("🌱 10,000 contacts re-seeded deterministically!");
      await refreshAll();
    }
  } catch (err) {
    showNotification(`Error: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>🔄</span> Reset 10k Seed`;
  }
});

// Search & Filter Listeners
let searchTimer = null;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentSearch = e.target.value.trim();
    currentPage = 1;
    loadContacts();
  }, 300);
});

statusFilter.addEventListener("change", (e) => {
  currentStatus = e.target.value;
  currentPage = 1;
  loadContacts();
});

btnPrev.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadContacts();
  }
});

btnNext.addEventListener("click", () => {
  currentPage++;
  loadContacts();
});

modalCloseBtn.addEventListener("click", closeContactModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeContactModal();
});

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function refreshAll() {
  await Promise.all([loadReport(), loadMailboxes(), loadContacts()]);
}

// Initial Load
refreshAll();
