const tokenInput = document.getElementById("adminToken");
const requestList = document.getElementById("requestList");
const adminHint = document.getElementById("adminHint");

function getToken() {
  return tokenInput.value.trim() || localStorage.getItem("decision_ai_admin_token") || "";
}

function saveToken() {
  const token = tokenInput.value.trim();
  if (token) localStorage.setItem("decision_ai_admin_token", token);
}

function money(amount) {
  return `¥${(Number(amount || 0) / 100).toFixed(2)}`;
}

function statusText(status) {
  return {
    PENDING: "待审核",
    APPROVED: "已通过",
    REJECTED: "已拒绝",
  }[status] || status || "未知";
}

async function loadRequests() {
  saveToken();
  const token = getToken();
  if (!token) {
    adminHint.textContent = "请输入管理员口令。";
    return;
  }
  try {
    const response = await fetch("/api/admin/list-recharges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify({}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "load failed");
    renderRequests(data.requests || []);
    adminHint.textContent = `已加载 ${data.requests.length} 条申请。`;
  } catch (error) {
    requestList.innerHTML = `<div class="request-empty">加载失败：${escapeHtml(error.message)}</div>`;
    adminHint.textContent = "请确认 ADMIN_TOKEN 和 Upstash Redis 已配置。";
  }
}

function renderRequests(requests) {
  if (!requests.length) {
    requestList.innerHTML = `<div class="request-empty">暂无充值申请。</div>`;
    return;
  }
  requestList.innerHTML = requests.map((item) => `
    <article class="request-card">
      <div>
        <strong>${escapeHtml(item.planTitle)} · ${money(item.amount)}</strong>
        <span>${escapeHtml(item.account)} ${item.nickname ? `· ${escapeHtml(item.nickname)}` : ""}</span>
        <small>申请编号：${escapeHtml(item.id)} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</small>
      </div>
      <div class="request-status ${escapeHtml(item.status)}">${statusText(item.status)}</div>
      <div class="request-actions">
        <button type="button" data-action="approve" data-id="${escapeHtml(item.id)}">通过</button>
        <button type="button" data-action="reject" data-id="${escapeHtml(item.id)}">拒绝</button>
      </div>
    </article>
  `).join("");
}

async function reviewRequest(id, action) {
  const token = getToken();
  try {
    const response = await fetch("/api/admin/review-recharge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify({ id, action }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "review failed");
    showToast(action === "approve" ? "已通过" : "已拒绝");
    await loadRequests();
  } catch (error) {
    showToast(error.message);
  }
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

tokenInput.value = localStorage.getItem("decision_ai_admin_token") || "";
document.getElementById("loadRequestsBtn").addEventListener("click", loadRequests);
document.getElementById("refreshRequestsBtn").addEventListener("click", loadRequests);
requestList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  reviewRequest(button.dataset.id, button.dataset.action);
});
