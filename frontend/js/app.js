const CLIENT_MAX_ATTACHMENTS = 5;
const CLIENT_MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const CLIENT_MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;

const state = {
  authMode: "login",
  user: null,
  joinedServers: [],
  discoverServers: [],
  searchedUsers: [],
  serverSearchQuery: "",
  serverSearchResults: [],
  serverSearchRequestId: 0,
  serverSearchLoading: false,
  activeServerId: null,
  activeChannelId: null,
  activeChannel: null,
  serverDetails: null,
  messages: [],
  firstUnreadMessageId: null,
  pendingFiles: [],
  modal: null,
  pollTimer: null,
  sidebarOpen: true,
  showMembers: false,
  userSearchRequestId: 0,
};

const elements = {
  authView: document.getElementById("auth-view"),
  appView: document.getElementById("app-view"),
  leftSidebar: document.getElementById("left-sidebar"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  serverList: document.getElementById("server-list"),
  channelList: document.getElementById("channel-list"),
  membersToggleButton: document.getElementById("members-toggle-button"),
  membersDropdownPanel: document.getElementById("members-dropdown-panel"),
  chatHeader: document.getElementById("chat-header"),
  messageList: document.getElementById("message-list"),
  composerForm: document.getElementById("composer-form"),
  composerText: document.getElementById("composer-text"),
  attachmentInput: document.getElementById("attachment-input"),
  attachmentPreview: document.getElementById("attachment-preview"),
  createChannelButton: document.getElementById("create-channel-button"),
  profileCard: document.getElementById("profile-card"),
  modalRoot: document.getElementById("modal-root"),
  toastRoot: document.getElementById("toast-root"),
  sendButton: document.getElementById("send-button"),
};

let userSearchDebounceTimer = null;
let serverSearchDebounceTimer = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return map[character];
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function safeColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || "")) ? value : "#7C5CFF";
}

function initialsFromName(name = "") {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "MM"
  );
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "Just now";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMessageText(text = "") {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function renderDataAttributes(attributes = {}) {
  return Object.entries(attributes)
    .map(
      ([key, value]) => `data-${escapeAttribute(key)}="${escapeAttribute(String(value))}"`
    )
    .join(" ");
}

function renderActionMenu(label, items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  const itemsHtml = items
    .map((item) => {
      const dataAttributes = renderDataAttributes(item.data || {});
      const itemClass =
        item.variant === "danger"
          ? "action-menu__item action-menu__item--danger"
          : "action-menu__item";

      return `
        <button
          class="${itemClass}"
          type="button"
          data-action="${escapeAttribute(item.action)}"
          ${dataAttributes}
        >
          ${escapeHtml(item.label)}
        </button>
      `;
    })
    .join("");

  const menuAttributes = renderDataAttributes({
    ...(options.preferVertical ? { "prefer-vertical": options.preferVertical } : {}),
  });

  return `
    <details class="action-menu" ${menuAttributes}>
      <summary class="action-menu__trigger" aria-label="${escapeAttribute(label)}">&#8942;</summary>
      <div class="action-menu__list">
        ${itemsHtml}
      </div>
    </details>
  `;
}

function closeActionMenus(excludedMenu = null) {
  document.querySelectorAll(".action-menu[open]").forEach((menu) => {
    if (menu !== excludedMenu) {
      menu.open = false;
      menu.dataset.positioned = "false";
    }
  });
}

function positionActionMenu(menu) {
  const trigger = menu.querySelector(".action-menu__trigger");
  const list = menu.querySelector(".action-menu__list");

  if (!menu.open || !trigger || !list) {
    return;
  }

  menu.dataset.positioned = "false";

  window.requestAnimationFrame(() => {
    if (!menu.open) {
      return;
    }

    const viewportPadding = 12;
    const menuGap = 6;
    const preferVertical = String(menu.dataset.preferVertical || "").toLowerCase();
    const triggerRect = trigger.getBoundingClientRect();
    const listWidth = list.offsetWidth || 176;
    const listHeight = list.offsetHeight || 120;
    let left = triggerRect.right - listWidth;
    const availableBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
    const availableAbove = triggerRect.top - viewportPadding;
    let top;

    if (preferVertical === "above") {
      top = triggerRect.top - listHeight - menuGap;
    } else if (preferVertical === "below") {
      top = triggerRect.bottom + menuGap;
    } else {
      top =
        availableBelow >= listHeight || availableBelow >= availableAbove
          ? triggerRect.bottom + menuGap
          : triggerRect.top - listHeight - menuGap;
    }

    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - listWidth - viewportPadding));
    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - listHeight - viewportPadding));

    menu.style.setProperty("--menu-left", `${left}px`);
    menu.style.setProperty("--menu-top", `${top}px`);
    menu.dataset.positioned = "true";
  });
}

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${variant === "error" ? "toast--error" : ""} ${variant === "success" ? "toast--success" : ""}`.trim();
  toast.textContent = message;
  elements.toastRoot.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function api(path, options = {}) {
  const requestOptions = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {},
  };

  if (options.body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  return fetch(path, requestOptions).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { message: await response.text() };

    if (!response.ok) {
      const error = new Error(payload.message || "Request failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  });
}

function setAuthMode(mode, updateHash = true) {
  state.authMode = mode === "register" ? "register" : "login";
  elements.loginForm.hidden = state.authMode !== "login";
  elements.registerForm.hidden = state.authMode !== "register";

  document.querySelectorAll("[data-action='switch-auth']").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.authMode);
  });

  if (updateHash) {
    history.replaceState(null, "", `#${state.authMode}`);
  }
}

function showAuth() {
  elements.authView.hidden = false;
  elements.appView.hidden = true;
}

function showApp() {
  elements.authView.hidden = true;
  elements.appView.hidden = false;
}

function setSidebarOpen(isOpen) {
  state.sidebarOpen = Boolean(isOpen);
  elements.appView.classList.toggle("sidebar-open", state.sidebarOpen);
  elements.appView.classList.toggle("sidebar-closed", !state.sidebarOpen);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startPolling() {
  stopPolling();

  state.pollTimer = window.setInterval(async () => {
    if (!state.user || !state.activeChannelId) {
      return;
    }

    try {
      await refreshCurrentView(true, {
        focusUnread: false,
        preserveScroll: true,
      });
    } catch (error) {
      handleError(error, false);
    }
  }, 5000);
}

function resetState() {
  state.user = null;
  state.joinedServers = [];
  state.discoverServers = [];
  state.searchedUsers = [];
  state.serverSearchQuery = "";
  state.serverSearchResults = [];
  state.serverSearchRequestId = 0;
  state.serverSearchLoading = false;
  state.activeServerId = null;
  state.activeChannelId = null;
  state.activeChannel = null;
  state.serverDetails = null;
  state.messages = [];
  state.firstUnreadMessageId = null;
  state.pendingFiles = [];
  state.showMembers = false;
  state.userSearchRequestId = 0;
  window.clearTimeout(userSearchDebounceTimer);
  window.clearTimeout(serverSearchDebounceTimer);
  closeModal({ suppressOnClose: true });
  stopPolling();
}

function clearConversationState() {
  state.activeServerId = null;
  state.activeChannelId = null;
  state.activeChannel = null;
  state.serverDetails = null;
  state.messages = [];
  state.firstUnreadMessageId = null;
}

function handleError(error, showToastMessage = true) {
  console.error(error);

  if (error?.status === 401) {
    resetState();
    showAuth();
    setAuthMode("login");

    if (showToastMessage) {
      showToast(error.message || "Please log in again.", "error");
    }

    return;
  }

  if (showToastMessage) {
    showToast(error?.message || "Something went wrong.", "error");
  }
}

function openModal(config) {
  state.modal = config;
  renderModal();
}

function closeModal(options = {}) {
  window.clearTimeout(userSearchDebounceTimer);
  const closingModal = state.modal;
  state.modal = null;
  renderModal();

  if (!options.suppressOnClose && typeof closingModal?.onClose === "function") {
    closingModal.onClose();
  }
}

function renderModal() {
  if (!state.modal) {
    elements.modalRoot.innerHTML = "";
    return;
  }

  const fields = state.modal.fields || [];
  const submitButtonClass =
    state.modal.submitVariant === "danger"
      ? "danger-button"
      : "primary-button primary-button--compact";
  const customHtml = state.modal.customHtml || "";
  const showHeaderClose = state.modal.hideHeaderClose !== true;
  const showCancelButton = state.modal.hideCancelButton !== true;

  const fieldsHtml = fields
    .map((field) => {
      if (field.type === "checkbox") {
        return `
          <label class="checkbox-field">
            <input type="checkbox" name="${escapeAttribute(field.name)}" ${field.checked ? "checked" : ""}>
            <span>${escapeHtml(field.label)}</span>
          </label>
        `;
      }

      if (field.type === "textarea") {
        return `
          <label>
            <span>${escapeHtml(field.label)}</span>
            <textarea
              name="${escapeAttribute(field.name)}"
              rows="${field.rows || 4}"
              placeholder="${escapeAttribute(field.placeholder || "")}"
              ${field.required ? "required" : ""}
            >${escapeHtml(field.value || "")}</textarea>
          </label>
        `;
      }

      return `
        <label>
          <span>${escapeHtml(field.label)}</span>
          <input
            type="${escapeAttribute(field.type || "text")}"
            name="${escapeAttribute(field.name)}"
            value="${escapeAttribute(field.value || "")}"
            placeholder="${escapeAttribute(field.placeholder || "")}"
            ${field.required ? "required" : ""}
          >
        </label>
      `;
    })
    .join("");

  elements.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-card__header">
          <div>
            <span class="eyebrow">${escapeHtml(state.modal.eyebrow || "MessageMe")}</span>
            <h3>${escapeHtml(state.modal.title)}</h3>
            <p>${escapeHtml(state.modal.description || "")}</p>
          </div>
          ${
            showHeaderClose
              ? `<button class="ghost-button" type="button" data-action="close-modal">Close</button>`
              : ""
          }
        </div>

        <form id="modal-form">
          <div class="modal-card__fields">${fieldsHtml}${customHtml}</div>
          <div class="modal-card__actions">
            ${
              showCancelButton
                ? `<button class="ghost-button" type="button" data-action="close-modal">Cancel</button>`
                : ""
            }
            <button class="${submitButtonClass}" type="submit">
              ${escapeHtml(state.modal.submitLabel || "Save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById("modal-form");
  const backdrop = elements.modalRoot.querySelector(".modal-backdrop");

  if (typeof state.modal.onRender === "function") {
    state.modal.onRender({ form, root: elements.modalRoot });
  }

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const values = {};

    fields.forEach((field) => {
      if (field.type === "checkbox") {
        values[field.name] = formData.get(field.name) === "on";
      } else {
        values[field.name] = String(formData.get(field.name) || "").trim();
      }
    });

    try {
      const submissionValues =
        typeof state.modal.collectValues === "function"
          ? await state.modal.collectValues(form, values)
          : values;

      await state.modal.onSubmit(submissionValues);
      closeModal();
    } catch (error) {
      handleError(error);
    }
  });
}

function renderProfileCard() {
  if (!state.user) {
    elements.profileCard.innerHTML = "";
    return;
  }

  const displayName = state.user.displayName || state.user.username;

  elements.profileCard.innerHTML = `
    <div class="profile-card__row">
      <div class="profile-card__identity">
        <button
          class="avatar avatar--interactive profile-card__avatar"
          type="button"
          data-action="view-my-profile"
          style="--avatar-color: ${safeColor(state.user.avatarColor)}"
          aria-label="View profile"
        >
          ${escapeHtml(initialsFromName(displayName))}
        </button>
        <div class="profile-card__identity-body">
          <button
            class="profile-link profile-card__name"
            type="button"
            data-action="view-my-profile"
          >
            ${escapeHtml(displayName)}
          </button>
          <button
            class="profile-link profile-link--subtle profile-card__handle"
            type="button"
            data-action="view-my-profile"
          >
            @${escapeHtml(state.user.username)}
          </button>
        </div>
      </div>
      ${renderActionMenu("Profile actions", [
        {
          action: "logout",
          label: "Logout",
          variant: "danger",
        },
      ])}
    </div>
  `;
}

function canAddMembersToSelectedServer(server) {
  const role = String(server?.role || "").trim().toUpperCase();

  return Boolean(server) && (Boolean(server.isOwner) || role === "ADMIN");
}

function normalizeSearchQuery(value = "") {
  return String(value || "").trim().toLowerCase();
}

function userMatchesSearch(user, query) {
  const normalizedQuery = normalizeSearchQuery(query);

  if (!normalizedQuery) {
    return false;
  }

  return [user?.username, user?.displayName || user?.username]
    .map((value) => normalizeSearchQuery(value))
    .some((value) => value.includes(normalizedQuery));
}

function filterUserSearchResults(users, query) {
  return (Array.isArray(users) ? users : []).filter((user) => userMatchesSearch(user, query));
}

function serverMatchesSearch(server, query) {
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedName = normalizeSearchQuery(server?.name);

  return Boolean(normalizedQuery) && normalizedName.includes(normalizedQuery);
}

function getServerSearchRank(server, query) {
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedName = normalizeSearchQuery(server?.name);

  if (normalizedName === normalizedQuery) {
    return 0;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }

  if (normalizedName.includes(` ${normalizedQuery}`)) {
    return 2;
  }

  return 3;
}

function getManageableServers() {
  return (state.joinedServers || []).filter(canAddMembersToSelectedServer);
}

function getUserSearchElements() {
  return {
    queryInput: document.getElementById("user-search-input"),
    serverSelect: document.getElementById("user-search-server"),
    results: document.getElementById("user-search-results"),
  };
}

function getUserSearchModalSnapshot() {
  if (state.modal?.modalKey !== "user-search") {
    return null;
  }

  const { queryInput } = getUserSearchElements();

  return {
    query: String(queryInput?.value || "").trim(),
    serverId: getSelectedUserSearchServerId(),
  };
}

function getSelectedUserSearchServerId() {
  const selectedValue = Number(document.getElementById("user-search-server")?.value || 0);

  return selectedValue > 0 ? selectedValue : null;
}

function renderUserSearchResults(users, targetServerId = null) {
  if (!Array.isArray(users) || users.length === 0) {
    return `<div class="empty-card">No users matched that search.</div>`;
  }

  const selectedServer = targetServerId
    ? getManageableServers().find((server) => Number(server.serverId) === Number(targetServerId))
    : null;

  return users
    .map((user) => {
      const isSelf = Number(user.userId) === Number(state.user?.userId);
      const badges = [
        user.appRole ? `<span class="status-pill">${escapeHtml(user.appRole)}</span>` : "",
        isSelf ? `<span class="status-pill">You</span>` : "",
        user.isMember
          ? `<span class="status-pill">${escapeHtml(user.serverRole || "MEMBER")}</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");

      const addButton =
        !selectedServer || !canAddMembersToSelectedServer(selectedServer) || isSelf || user.isMember
          ? ""
          : `
              <button
                class="mini-button"
                type="button"
                data-action="add-user-to-server"
                data-user-id="${user.userId}"
                data-server-id="${selectedServer.serverId}"
              >
                Add to ${escapeHtml(selectedServer.name)}
              </button>
            `;

      const membershipNote =
        selectedServer && user.isMember
          ? `<span class="status-pill">Already in ${escapeHtml(selectedServer.name)}</span>`
          : "";
      const actionsHtml = addButton
        ? `
            <div class="user-search-card__actions">
              ${addButton}
            </div>
          `
        : "";

      return `
        <div class="user-search-card">
          <div class="user-search-card__header">
            <div class="profile-card__top user-search-card__identity">
              <div
                class="avatar avatar--interactive"
                style="--avatar-color: ${safeColor(user.avatarColor)}"
                data-action="view-profile"
                data-user-id="${user.userId}"
                title="View profile"
              >
                ${escapeHtml(initialsFromName(user.displayName || user.username))}
              </div>
              <div>
                <button
                  class="profile-link"
                  type="button"
                  data-action="view-profile"
                  data-user-id="${user.userId}"
                >
                  ${escapeHtml(user.displayName || user.username)}
                </button>
                <button
                  class="profile-link profile-link--subtle"
                  type="button"
                  data-action="view-profile"
                  data-user-id="${user.userId}"
                >
                  @${escapeHtml(user.username)}
                </button>
              </div>
            </div>
            ${actionsHtml}
          </div>
          <div class="user-search-card__meta">
            ${badges}
            ${membershipNote}
          </div>
        </div>
      `;
    })
    .join("");
}

async function runUserSearch(showLoading = true) {
  if (!state.modal) {
    return;
  }

  const { queryInput, results } = getUserSearchElements();

  if (!queryInput || !results) {
    return;
  }

  const targetServerId = getSelectedUserSearchServerId();
  const query = String(queryInput.value || "").trim();
  const normalizedQuery = normalizeSearchQuery(query);
  const params = new URLSearchParams();

  if (!normalizedQuery) {
    state.searchedUsers = [];
    results.innerHTML = `<div class="empty-card">Start typing a username or display name to search.</div>`;
    return;
  }

  params.set("q", normalizedQuery);

  if (targetServerId) {
    params.set("serverId", String(targetServerId));
  }

  const requestId = ++state.userSearchRequestId;

  if (showLoading) {
    results.innerHTML = `<div class="empty-card">Searching users...</div>`;
  }

  try {
    const payload = await api(
      `/api/users/search${params.toString() ? `?${params.toString()}` : ""}`
    );
    const liveResults = document.getElementById("user-search-results");

    if (!liveResults || requestId !== state.userSearchRequestId) {
      return;
    }

    state.searchedUsers = filterUserSearchResults(payload.users || [], normalizedQuery);
    liveResults.innerHTML = renderUserSearchResults(state.searchedUsers, targetServerId);
  } catch (error) {
    const liveResults = document.getElementById("user-search-results");

    if (!liveResults || requestId !== state.userSearchRequestId) {
      return;
    }

    liveResults.innerHTML = `<div class="empty-card">User search is unavailable right now.</div>`;
    handleError(error);
  }
}

function openUserSearchModal(options = {}) {
  const manageableServers = getManageableServers();
  const initialQuery = String(options.query || "").trim();
  const preferredServerId = Number(options.serverId || 0);
  const defaultServer =
    manageableServers.find(
      (server) => Number(server.serverId) === preferredServerId
    ) ||
    manageableServers.find(
      (server) => Number(server.serverId) === Number(state.activeServerId)
    ) ||
    manageableServers[0] ||
    null;

  state.searchedUsers = [];
  window.clearTimeout(userSearchDebounceTimer);

  openModal({
    modalKey: "user-search",
    eyebrow: "People",
    title: "Search users",
    description: "Find anyone by username or display name.",
    submitLabel: "Close",
    hideHeaderClose: false,
    hideCancelButton: true,
    fields: [],
    customHtml: `
      <div class="user-search-panel">
        <div class="modal-helper">
          Click any avatar or username to view the profile. ${
            manageableServers.length > 0
              ? "Only servers where you are the owner or an admin appear below for adding people."
              : "You can browse profiles here, but only server owners or admins can add people to a server."
          }
        </div>
        <div class="user-search-toolbar ${manageableServers.length === 0 ? "user-search-toolbar--single" : ""}">
          <label>
            <span>Search users</span>
            <input
              id="user-search-input"
              type="text"
              placeholder="Search username or display name"
              value="${escapeAttribute(initialQuery)}"
              autocomplete="off"
            >
          </label>
          ${
            manageableServers.length > 0
              ? `
                  <label>
                    <span>Add to server</span>
                    <select id="user-search-server" class="user-search-select">
                      ${manageableServers
                        .map(
                          (server) => `
                            <option
                              value="${server.serverId}"
                              ${Number(defaultServer?.serverId) === Number(server.serverId) ? "selected" : ""}
                            >
                              ${escapeHtml(server.name)}
                            </option>
                          `
                        )
                        .join("")}
                    </select>
                  </label>
                `
              : ""
          }
        </div>
        <div id="user-search-results" class="user-search-results">
          <div class="empty-card">Start typing a username or display name to search.</div>
        </div>
      </div>
    `,
    onRender: () => {
      const { queryInput, serverSelect } = getUserSearchElements();

      if (queryInput) {
        queryInput.focus();
        queryInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            window.clearTimeout(userSearchDebounceTimer);
            void runUserSearch();
          }
        });
        queryInput.addEventListener("input", () => {
          window.clearTimeout(userSearchDebounceTimer);
          userSearchDebounceTimer = window.setTimeout(() => {
            void runUserSearch();
          }, 220);
        });
      }

      if (serverSelect) {
        serverSelect.addEventListener("change", () => {
          void runUserSearch();
        });
      }

      void runUserSearch(false);
    },
    onSubmit: async () => {
      window.clearTimeout(userSearchDebounceTimer);
    },
  });
}

function getServerSearchQuery() {
  return String(state.serverSearchQuery || "").trim();
}

function getServerSearchElements() {
  return {
    queryInput: document.getElementById("server-search-input"),
    results: document.getElementById("discover-list"),
  };
}

function getServerSearchList() {
  const query = getServerSearchQuery();

  if (!query) {
    return [];
  }

  const mergedServers = new Map();

  (state.joinedServers || [])
    .filter((server) => serverMatchesSearch(server, query))
    .forEach((server) => {
      mergedServers.set(Number(server.serverId), {
        ...server,
        isJoined: true,
      });
    });

  (state.serverSearchResults || []).forEach((server) => {
    const serverId = Number(server.serverId);

    if (mergedServers.has(serverId)) {
      mergedServers.set(serverId, {
        ...server,
        ...mergedServers.get(serverId),
        isJoined: true,
      });
      return;
    }

    mergedServers.set(serverId, {
      ...server,
      isJoined: Boolean(server.isJoined),
    });
  });

  return Array.from(mergedServers.values()).sort((left, right) => {
    const rankDifference = getServerSearchRank(left, query) - getServerSearchRank(right, query);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    if (Boolean(left.isJoined) !== Boolean(right.isJoined)) {
      return left.isJoined ? -1 : 1;
    }

    return normalizeSearchQuery(left.name).localeCompare(normalizeSearchQuery(right.name));
  });
}

async function runServerSearch(showLoading = true) {
  const query = getServerSearchQuery();
  const { results } = getServerSearchElements();

  if (!results) {
    return;
  }

  if (!query) {
    state.serverSearchResults = [];
    state.serverSearchLoading = false;
    renderDiscoverList();
    return;
  }

  const requestId = ++state.serverSearchRequestId;

  if (showLoading) {
    state.serverSearchLoading = true;
    renderDiscoverList();
  }

  try {
    const payload = await api(`/api/servers/search?q=${encodeURIComponent(query)}`);

    if (requestId !== state.serverSearchRequestId) {
      return;
    }

    state.serverSearchResults = payload.servers || [];
    state.serverSearchLoading = false;
    renderDiscoverList();
  } catch (error) {
    if (requestId !== state.serverSearchRequestId) {
      return;
    }

    state.serverSearchLoading = false;
    renderDiscoverList();
    handleError(error);
  }
}

function renderServerList() {
  if (state.joinedServers.length === 0) {
    elements.serverList.innerHTML = `
      <div class="empty-card">
        No joined servers yet. Create one or send a join request from Search Servers.
      </div>
    `;
    return;
  }

  elements.serverList.innerHTML = state.joinedServers
    .map((server) => {
      const isActive = Number(server.serverId) === Number(state.activeServerId);
      const actionItems = [
        {
          action: "leave-server",
          label: "Exit server",
          data: {
            "server-id": server.serverId,
          },
        },
      ];

      if (server.isOwner) {
        actionItems.unshift({
          action: "rename-server",
          label: "Edit server",
          data: {
            "server-id": server.serverId,
          },
        });

        actionItems.push({
          action: "delete-server",
          label: "Remove server",
          variant: "danger",
          data: {
            "server-id": server.serverId,
          },
        });
      }

      return `
        <div class="server-button" style="--server-accent: ${safeColor(server.accentColor)}">
          <button
            type="button"
            class="${isActive ? "is-active" : ""}"
            data-action="select-server"
            data-server-id="${server.serverId}"
          >
            <span class="server-button__badge">
              ${escapeHtml(initialsFromName(server.name))}
            </span>
            <span class="server-button__body">
              <strong class="server-button__title">${escapeHtml(server.name)}</strong>
              <span class="server-button__meta">
                ${server.memberCount} members - ${server.channelCount} channels
              </span>
            </span>
          </button>
          ${renderActionMenu(`Actions for ${server.name}`, actionItems)}
        </div>
      `;
    })
    .join("");
}

function getServerById(serverId) {
  return state.joinedServers.find(
    (server) => Number(server.serverId) === Number(serverId)
  );
}

function renderChannelList() {
  const channels = state.serverDetails?.channels || [];
  const canCreateChannel = Boolean(state.serverDetails?.permissions?.canCreateChannel);

  elements.createChannelButton.hidden = !canCreateChannel;
  elements.createChannelButton.disabled = !canCreateChannel;

  if (!state.serverDetails?.server) {
    elements.channelList.innerHTML = `
      <div class="empty-card">Channels appear here after you open a server.</div>
    `;
    return;
  }

  if (channels.length === 0) {
    elements.channelList.innerHTML = `
      <div class="empty-card">
        No channels yet. ${canCreateChannel ? "Create one to start the conversation." : "Ask a server admin to add one."}
      </div>
    `;
    return;
  }

  elements.channelList.innerHTML = channels
    .map((channel) => {
      const isActive = Number(channel.channelId) === Number(state.activeChannelId);
      const channelActions = state.serverDetails?.permissions?.canManage
        ? renderActionMenu(`Actions for ${channel.name}`, [
            {
              action: "rename-channel",
              label: "Edit channel",
              data: { "channel-id": channel.channelId },
            },
            {
              action: "delete-channel",
              label: "Remove channel",
              variant: "danger",
              data: { "channel-id": channel.channelId },
            },
          ])
        : "";

      return `
        <div class="channel-card ${isActive ? "is-active" : ""}">
          <div class="channel-card__top">
            <button
              class="channel-card__select"
              type="button"
              data-action="select-channel"
              data-channel-id="${channel.channelId}"
            >
              <span class="channel-card__body">
                <strong># ${escapeHtml(channel.name)}</strong>
                <span class="muted">${escapeHtml(channel.topic || "No topic set")}</span>
              </span>
            </button>
            ${channelActions}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderMembers() {
  const hasServer = Boolean(state.serverDetails?.server);
  const showPanel = hasServer && state.showMembers;
  const members = state.serverDetails?.members || [];
  const joinRequests = state.serverDetails?.joinRequests || [];
  const canManageRequests = Boolean(state.serverDetails?.permissions?.canManage);
  if (!elements.membersDropdownPanel || !elements.membersToggleButton) {
    return;
  }

  elements.membersDropdownPanel.hidden = !showPanel;
  elements.membersToggleButton.disabled = !hasServer;
  elements.membersToggleButton.textContent = hasServer
    ? `Members (${members.length})`
    : "Members";

  if (!showPanel) {
    elements.membersDropdownPanel.innerHTML = "";
    return;
  }

  const membersHtml =
    members.length === 0
      ? `<div class="empty-card">No members were found for this server.</div>`
      : members
          .map((member) => {
            const nextRole = member.serverRole === "ADMIN" ? "MEMBER" : "ADMIN";
            const roleLabel = member.isOwner ? "OWNER" : member.serverRole;
            const actionItems = [];

            if (member.canToggleRole) {
              actionItems.push({
                action: "toggle-role",
                label: `Make ${nextRole}`,
                data: {
                  "user-id": member.userId,
                  "next-role": nextRole,
                },
              });
            }

            if (member.canRemove) {
              actionItems.push({
                action: "remove-member",
                label: "Remove member",
                variant: "danger",
                data: {
                  "user-id": member.userId,
                },
              });
            }

            return `
              <div class="member-card">
                <div class="member-card__header">
                  <div class="profile-card__top">
                    <div
                      class="avatar avatar--interactive"
                      style="--avatar-color: ${safeColor(member.avatarColor)}"
                      data-action="view-profile"
                      data-user-id="${member.userId}"
                      title="View profile"
                    >
                      ${escapeHtml(initialsFromName(member.displayName || member.username))}
                    </div>
                    <div>
                      <button
                        class="profile-link"
                        type="button"
                        data-action="view-profile"
                        data-user-id="${member.userId}"
                      >
                        ${escapeHtml(member.displayName || member.username)}
                      </button>
                      <button
                        class="profile-link profile-link--subtle"
                        type="button"
                        data-action="view-profile"
                        data-user-id="${member.userId}"
                      >
                        @${escapeHtml(member.username)}
                      </button>
                    </div>
                  </div>
                  <div class="card-header__actions">
                    <span class="status-pill">${escapeHtml(roleLabel)}</span>
                    ${renderActionMenu(
                      `Actions for ${member.displayName || member.username}`,
                      actionItems
                    )}
                  </div>
                </div>
                ${
                  actionItems.length === 0
                    ? `
                        <div class="member-card__actions">
                          <span class="status-pill">${member.isSelf ? "You" : "Member"}</span>
                        </div>
                      `
                    : ""
                }
              </div>
            `;
          })
          .join("");

  const requestsHtml = !canManageRequests
    ? ""
    : `
        <div class="members-dropdown__section">
          <div class="members-dropdown__section-header">
            <strong>Join Requests</strong>
            <span class="status-pill">${joinRequests.length}</span>
          </div>
          <div class="request-list">
            ${
              joinRequests.length === 0
                ? `<div class="empty-card">No pending join requests right now.</div>`
                : joinRequests
                    .map((request) => {
                      const requestActions = renderActionMenu(
                        `Actions for ${request.displayName || request.username}`,
                        [
                          {
                            action: "review-request",
                            label: "Approve request",
                            data: {
                              "request-id": request.requestId,
                              status: "APPROVED",
                            },
                          },
                          {
                            action: "review-request",
                            label: "Reject request",
                            variant: "danger",
                            data: {
                              "request-id": request.requestId,
                              status: "REJECTED",
                            },
                          },
                        ],
                        {
                          preferVertical: "above",
                        }
                      );

                      return `
                        <div class="request-card">
                          <div class="request-card__header">
                            <div class="profile-card__top">
                              <div
                                class="avatar avatar--interactive"
                                style="--avatar-color: ${safeColor(request.avatarColor)}"
                                data-action="view-profile"
                                data-user-id="${request.userId}"
                                title="View profile"
                              >
                                ${escapeHtml(initialsFromName(request.displayName || request.username))}
                              </div>
                              <div>
                                <button
                                  class="profile-link"
                                  type="button"
                                  data-action="view-profile"
                                  data-user-id="${request.userId}"
                                >
                                  ${escapeHtml(request.displayName || request.username)}
                                </button>
                                <button
                                  class="profile-link profile-link--subtle"
                                  type="button"
                                  data-action="view-profile"
                                  data-user-id="${request.userId}"
                                >
                                  @${escapeHtml(request.username)} - ${formatDate(request.requestDate)}
                                </button>
                              </div>
                            </div>
                            ${requestActions}
                          </div>
                          <p>${escapeHtml(request.requestMessage || "No message included.")}</p>
                        </div>
                      `;
                    })
                    .join("")
            }
          </div>
        </div>
      `;

  elements.membersDropdownPanel.innerHTML = `
    <div class="members-dropdown__section">
      <div class="members-dropdown__section-header">
        <strong>Members</strong>
        <span class="status-pill">${members.length}</span>
      </div>
      <div class="member-list">
        ${membersHtml}
      </div>
    </div>
    ${requestsHtml}
  `;
}

function renderDiscoverList() {
  const { results } = getServerSearchElements();

  if (!results) {
    return;
  }

  const query = getServerSearchQuery();
  const servers = getServerSearchList();

  if (state.serverSearchLoading && servers.length === 0) {
    results.innerHTML = `
      <div class="empty-card">Searching servers...</div>
    `;
    return;
  }

  if (!query) {
    results.innerHTML = `
      <div class="empty-card">Start typing a server name to search.</div>
    `;
    return;
  }

  if (servers.length === 0) {
    results.innerHTML = `
      <div class="empty-card">${
        query
          ? `No servers matched "${escapeHtml(query)}".`
          : "Start typing a server name to search."
      }</div>
    `;
    return;
  }

  results.innerHTML = servers
    .map((server) => {
      const statusPills = [
        `<span class="status-pill">${server.isPrivate ? "Private" : "Open"}</span>`,
        server.isJoined ? `<span class="status-pill">Joined</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      const actionHtml = server.isJoined
        ? `
            <button
              class="secondary-button"
              type="button"
              data-action="select-server"
              data-server-id="${server.serverId}"
            >
              Open server
            </button>
          `
        : `
            <button
              class="${server.hasPendingRequest ? "ghost-button" : "secondary-button"}"
              type="button"
              data-action="request-access"
              data-server-id="${server.serverId}"
              ${server.hasPendingRequest ? "disabled" : ""}
            >
              ${server.hasPendingRequest ? "Request sent" : "Request access"}
            </button>
          `;

      return `
        <div class="discover-card">
          <div class="discover-card__header">
            <div>
              <strong>${escapeHtml(server.name)}</strong>
              <p class="muted">${server.memberCount} members - ${server.channelCount} channels</p>
            </div>
            <div class="discover-card__status">
              ${statusPills}
            </div>
          </div>
          <div class="discover-card__body">
            ${escapeHtml(server.description || "Explore this community and request access when you are ready.")}
          </div>
          <div class="discover-card__actions">
            ${actionHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

function openServerSearchModal(options = {}) {
  state.serverSearchQuery = String(options.query || state.serverSearchQuery || "").trim();
  window.clearTimeout(serverSearchDebounceTimer);

  openModal({
    modalKey: "server-search",
    eyebrow: "Communities",
    title: "Search servers",
    description: "Search for a server by name and request access or open one you already joined.",
    submitLabel: "Close",
    hideHeaderClose: false,
    hideCancelButton: true,
    fields: [],
    customHtml: `
      <div class="user-search-panel">
        <div class="modal-helper">
          Type a server name to search. Joined servers appear here too, so you can open them directly.
        </div>
        <div class="user-search-toolbar user-search-toolbar--single">
          <label>
            <span>Search servers</span>
            <input
              id="server-search-input"
              type="search"
              placeholder="Search server name"
              value="${escapeAttribute(state.serverSearchQuery)}"
              autocomplete="off"
            >
          </label>
        </div>
        <div id="discover-list" class="discover-list">
          <div class="empty-card">Start typing a server name to search.</div>
        </div>
      </div>
    `,
    onRender: () => {
      const { queryInput } = getServerSearchElements();

      if (!queryInput) {
        return;
      }

      queryInput.focus();
      queryInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          window.clearTimeout(serverSearchDebounceTimer);
          state.serverSearchQuery = String(queryInput.value || "");
          void runServerSearch();
        }
      });

      queryInput.addEventListener("input", () => {
        window.clearTimeout(serverSearchDebounceTimer);
        state.serverSearchQuery = String(queryInput.value || "");

        if (!state.serverSearchQuery.trim()) {
          state.serverSearchRequestId += 1;
          state.serverSearchResults = [];
          state.serverSearchLoading = false;
          renderDiscoverList();
          return;
        }

        renderDiscoverList();
        serverSearchDebounceTimer = window.setTimeout(() => {
          void runServerSearch();
        }, 240);
      });

      renderDiscoverList();
      if (state.serverSearchQuery.trim()) {
        void runServerSearch(false);
      }
    },
    onSubmit: async () => {
      window.clearTimeout(serverSearchDebounceTimer);
    },
  });
}

function renderChatHeader() {
  const activeServer = state.serverDetails?.server;

  if (!activeServer || !state.activeChannel) {
    elements.chatHeader.innerHTML = `
      <div class="chat-header">
        <h2>${state.joinedServers.length === 0 ? "Welcome to MessageMe" : "Open a channel"}</h2>
        <p>
          ${state.joinedServers.length === 0
            ? "Create a server or search for one to request access."
            : "Choose a channel from the left sidebar to view messages from the unread point."}
        </p>
      </div>
    `;
  } else {
    elements.chatHeader.innerHTML = `
      <div class="chat-header">
        <h2># ${escapeHtml(state.activeChannel.name)}</h2>
        <p>
          ${escapeHtml(state.activeChannel.topic || "No channel topic yet.")}
          <small class="muted"> - ${escapeHtml(activeServer.name)}</small>
        </p>
      </div>
    `;
  }

  document.querySelectorAll("[data-action='toggle-members']").forEach((button) => {
    button.disabled = !activeServer;
    button.textContent = activeServer
      ? `Members (${state.serverDetails?.members?.length || 0})`
      : "Members";
  });

  updateComposerState();
}

function renderAttachmentPreview() {
  elements.attachmentPreview.innerHTML =
    state.pendingFiles.length === 0
      ? ""
      : state.pendingFiles
          .map((file, index) => {
            return `
              <div class="preview-chip">
                <span>${escapeHtml(file.name)} - ${formatFileSize(file.size)}</span>
                <button type="button" data-action="remove-attachment" data-index="${index}">x</button>
              </div>
            `;
          })
          .join("");
}

function renderAttachment(attachment) {
  const fileUrl = escapeAttribute(attachment.fileUrl || "#");
  const fileName = escapeHtml(attachment.fileName || "Attachment");
  const meta = `<p class="muted u-spaced">${fileName} - ${formatFileSize(attachment.fileSize || 0)}</p>`;

  if (attachment.fileType === "IMAGE") {
    return `
      <div class="attachment-card">
        <a href="${fileUrl}" target="_blank" rel="noreferrer">
          <img src="${fileUrl}" alt="${fileName}">
        </a>
        ${meta}
        <div class="attachment-actions">
          <a href="${fileUrl}" target="_blank" rel="noreferrer">Open</a>
          <a href="${fileUrl}" download>Download</a>
        </div>
      </div>
    `;
  }

  if (attachment.fileType === "VIDEO") {
    return `
      <div class="attachment-card">
        <video controls src="${fileUrl}"></video>
        ${meta}
        <div class="attachment-actions">
          <a href="${fileUrl}" target="_blank" rel="noreferrer">Open</a>
          <a href="${fileUrl}" download>Download</a>
        </div>
      </div>
    `;
  }

  if (attachment.fileType === "AUDIO") {
    return `
      <div class="attachment-card">
        <audio controls src="${fileUrl}"></audio>
        ${meta}
        <div class="attachment-actions">
          <a href="${fileUrl}" target="_blank" rel="noreferrer">Open</a>
          <a href="${fileUrl}" download>Download</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="attachment-card">
      <strong>${fileName}</strong>
      <p class="muted u-spaced">${formatFileSize(attachment.fileSize || 0)}</p>
      <div class="attachment-actions u-spaced">
        <a href="${fileUrl}" target="_blank" rel="noreferrer">Open</a>
        <a href="${fileUrl}" download>Download</a>
      </div>
    </div>
  `;
}

function findProfileByUserId(userId) {
  const targetUserId = Number(userId);
  const currentUserProfile =
    Number(state.user?.userId) === targetUserId
      ? {
          ...state.user,
          serverRole:
            state.serverDetails?.members?.find((member) => member.userId === targetUserId)
              ?.serverRole || null,
          joinDate:
            state.serverDetails?.members?.find((member) => member.userId === targetUserId)
              ?.joinDate || null,
          isOwner:
            state.serverDetails?.server &&
            Number(state.serverDetails.server.ownerId) === targetUserId,
        }
      : null;

  if (currentUserProfile) {
    return currentUserProfile;
  }

  const member = state.serverDetails?.members?.find((candidate) => candidate.userId === targetUserId);

  if (member) {
    return member;
  }

  const joinRequest = state.serverDetails?.joinRequests?.find(
    (candidate) => candidate.userId === targetUserId
  );

  if (joinRequest) {
    return joinRequest;
  }

  const searchedUser = state.searchedUsers.find(
    (candidate) => Number(candidate.userId) === targetUserId
  );

  if (searchedUser) {
    return searchedUser;
  }

  const messageAuthor = state.messages
    .map((message) => message.author)
    .find((author) => Number(author.userId) === targetUserId);

  return messageAuthor || null;
}

function openProfileModal(userId) {
  const profile = userId ? findProfileByUserId(userId) : state.user;
  const userSearchSnapshot = getUserSearchModalSnapshot();

  if (!profile) {
    showToast("That profile is not available right now.", "error");
    return;
  }

  const profileName = profile.displayName || profile.username;
  const profileBadges = [
    profile.appRole ? `<span class="status-pill">${escapeHtml(profile.appRole)}</span>` : "",
    profile.serverRole ? `<span class="status-pill">${escapeHtml(profile.serverRole)}</span>` : "",
    profile.isOwner ? `<span class="status-pill">Owner</span>` : "",
    profile.joinDate ? `<span class="status-pill">Joined ${escapeHtml(formatDate(profile.joinDate))}</span>` : "",
    profile.email ? `<span class="status-pill">${escapeHtml(profile.email)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  openModal({
    eyebrow: "Profile",
    title: `${profileName}`,
    description: `@${profile.username}`,
    submitLabel: "Close",
    hideHeaderClose: true,
    hideCancelButton: true,
    fields: [],
    onClose: userSearchSnapshot ? () => openUserSearchModal(userSearchSnapshot) : null,
    customHtml: `
      <div class="profile-modal">
        <div class="profile-modal__top">
          <div class="avatar" style="--avatar-color: ${safeColor(profile.avatarColor)}">
            ${escapeHtml(initialsFromName(profileName))}
          </div>
          <div>
            <h3>${escapeHtml(profileName)}</h3>
            <p class="muted">@${escapeHtml(profile.username)}</p>
          </div>
        </div>
        <div class="profile-modal__meta">
          ${profileBadges || `<span class="status-pill">Community member</span>`}
        </div>
      </div>
    `,
    onSubmit: async () => {},
  });
}

function captureMessageScrollState() {
  return {
    scrollTop: elements.messageList.scrollTop,
    scrollHeight: elements.messageList.scrollHeight,
    clientHeight: elements.messageList.clientHeight,
    nearBottom:
      elements.messageList.scrollHeight -
        elements.messageList.scrollTop -
        elements.messageList.clientHeight <
      96,
  };
}

function applyMessageScroll(previousScrollState, options = {}) {
  if (!previousScrollState || !options.preserveScroll) {
    const unreadMarker = elements.messageList.querySelector("[data-unread-marker='true']");

    if (options.focusUnread && unreadMarker) {
      unreadMarker.scrollIntoView({ block: "center" });
      return;
    }

    elements.messageList.scrollTop = elements.messageList.scrollHeight;
    return;
  }

  if (previousScrollState.nearBottom) {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
    return;
  }

  const fromBottom = previousScrollState.scrollHeight - previousScrollState.scrollTop;
  elements.messageList.scrollTop = Math.max(
    0,
    elements.messageList.scrollHeight - fromBottom
  );
}

function renderMessageList(options = {}) {
  const previousScrollState = options.preserveScroll ? captureMessageScrollState() : null;

  if (!state.activeChannelId) {
    elements.messageList.innerHTML = `
      <div class="empty-card">
        Select a channel to open the conversation. The chat area will automatically scroll when messages grow.
      </div>
    `;
    return;
  }

  if (state.messages.length === 0) {
    elements.messageList.innerHTML = `
      <div class="empty-card">
        No messages yet in #${escapeHtml(state.activeChannel?.name || "channel")}. Start the first one.
      </div>
    `;
    return;
  }

  elements.messageList.innerHTML = state.messages
    .map((message) => {
      const showUnreadMarker =
        Number(message.messageId) === Number(state.firstUnreadMessageId);
      const actionItems = [];

      if (message.canEdit) {
        actionItems.push({
          action: "edit-message",
          label: "Edit message",
          data: {
            "message-id": message.messageId,
          },
        });
      }

      if (message.canDelete) {
        actionItems.push({
          action: "delete-message",
          label: "Delete message",
          variant: "danger",
          data: {
            "message-id": message.messageId,
          },
        });
      }

      const statusBits = [
        `<span class="message-status">${formatDate(message.sentAt)}</span>`,
      ];

      if (message.isEdited) {
        statusBits.push(`<span class="message-status">Edited</span>`);
      }

      if (message.isDeleted) {
        statusBits.push(`<span class="message-status">Deleted</span>`);
      }

      const unreadHtml = showUnreadMarker
        ? `<div class="unread-marker" data-unread-marker="true">Unread messages</div>`
        : "";

      const bodyHtml = message.messageText
        ? `
            <div class="message-card__body ${message.isDeleted ? "message-card__body--deleted" : ""}">
              ${formatMessageText(message.messageText)}
            </div>
          `
        : "";

      const attachmentHtml =
        message.attachments && message.attachments.length > 0
          ? `
              <div class="message-card__attachments">
                ${message.attachments.map(renderAttachment).join("")}
              </div>
            `
          : "";

      return `
        ${unreadHtml}
        <article class="message-card ${message.isDeleted ? "message-card--deleted" : ""}">
          <div class="message-card__header">
            <div class="profile-card__top">
              <div
                class="avatar avatar--interactive"
                style="--avatar-color: ${safeColor(message.author.avatarColor)}"
                data-action="view-profile"
                data-user-id="${message.author.userId}"
                title="View profile"
              >
                ${escapeHtml(initialsFromName(message.author.displayName || message.author.username))}
              </div>
              <div>
                <div class="message-meta">
                  <button
                    class="profile-link"
                    type="button"
                    data-action="view-profile"
                    data-user-id="${message.author.userId}"
                  >
                    ${escapeHtml(message.author.displayName || message.author.username)}
                  </button>
                  <button
                    class="profile-link profile-link--subtle"
                    type="button"
                    data-action="view-profile"
                    data-user-id="${message.author.userId}"
                  >
                    @${escapeHtml(message.author.username)}
                  </button>
                  ${statusBits.join("")}
                </div>
              </div>
            </div>
            ${renderActionMenu(
              `Actions for message from ${message.author.displayName || message.author.username}`,
              actionItems
            )}
          </div>
          ${bodyHtml}
          ${attachmentHtml}
        </article>
      `;
    })
    .join("");

  applyMessageScroll(previousScrollState, options);
}

function updateComposerState() {
  const canSend = Boolean(state.activeChannelId);

  elements.composerText.disabled = !canSend;
  elements.attachmentInput.disabled = !canSend;
  elements.sendButton.disabled = !canSend;
  elements.composerText.placeholder = canSend
    ? `Message #${state.activeChannel?.name || "channel"}`
    : "Select a channel to start chatting";
}

function autoResizeComposer() {
  elements.composerText.style.height = "auto";
  elements.composerText.style.height = `${Math.min(elements.composerText.scrollHeight, 176)}px`;
}

function resolveActiveServerId(preferredServerId = null) {
  const availableIds = state.joinedServers.map((server) => Number(server.serverId));

  if (preferredServerId && availableIds.includes(Number(preferredServerId))) {
    return Number(preferredServerId);
  }

  if (state.activeServerId && availableIds.includes(Number(state.activeServerId))) {
    return Number(state.activeServerId);
  }

  return availableIds[0] || null;
}

function resolveActiveChannelId(channels, preferredChannelId = null) {
  const availableIds = channels.map((channel) => Number(channel.channelId));

  if (preferredChannelId && availableIds.includes(Number(preferredChannelId))) {
    return Number(preferredChannelId);
  }

  if (state.activeChannelId && availableIds.includes(Number(state.activeChannelId))) {
    return Number(state.activeChannelId);
  }

  return availableIds[0] || null;
}

async function loadBootstrap(options = {}) {
  const payload = await api("/api/bootstrap");
  state.user = payload.user;
  state.joinedServers = payload.joinedServers || [];
  state.discoverServers = payload.discoverServers || [];

  renderProfileCard();
  renderServerList();
  renderDiscoverList();
  if (state.serverSearchQuery) {
    void runServerSearch(false);
  }

  const nextServerId = resolveActiveServerId(options.preferredServerId);

  if (!nextServerId) {
    clearConversationState();
    renderChannelList();
    renderMembers();
    renderChatHeader();
    renderAttachmentPreview();
    renderMessageList({ focusUnread: false });
    setSidebarOpen(true);
    showApp();
    return;
  }

  showApp();
  await loadServerDetails(nextServerId, options);
}

async function loadServerDetails(serverId, options = {}) {
  state.activeServerId = Number(serverId);
  state.serverDetails = null;
  state.activeChannelId = null;
  state.activeChannel = null;
  state.messages = [];
  state.firstUnreadMessageId = null;

  renderServerList();
  renderChannelList();
  renderMembers();
  renderChatHeader();
  elements.messageList.innerHTML = `<div class="empty-card">Loading channels and messages...</div>`;

  const payload = await api(`/api/servers/${serverId}`);
  state.serverDetails = payload;

  state.joinedServers = state.joinedServers.map((server) =>
    Number(server.serverId) === Number(payload.server.serverId)
      ? { ...server, ...payload.server }
      : server
  );

  renderServerList();
  renderChannelList();
  renderMembers();

  const nextChannelId = resolveActiveChannelId(payload.channels || [], options.preferredChannelId);

  if (!nextChannelId) {
    state.activeChannelId = null;
    state.activeChannel = null;
    state.messages = [];
    state.firstUnreadMessageId = null;
    renderChatHeader();
    renderMessageList({ focusUnread: false });
    return;
  }

  await loadChannelMessages(nextChannelId, {
    focusUnread: options.focusUnread !== false,
    preserveScroll: options.preserveScroll,
  });
}

async function loadChannelMessages(channelId, options = {}) {
  state.activeChannelId = Number(channelId);
  state.activeChannel =
    state.serverDetails?.channels?.find(
      (channel) => Number(channel.channelId) === Number(channelId)
    ) || null;

  renderChannelList();
  renderChatHeader();

  if (options.showLoading !== false) {
    elements.messageList.innerHTML = `<div class="empty-card">Loading messages...</div>`;
  }

  const payload = await api(`/api/channels/${channelId}/messages`);
  state.activeChannelId = Number(channelId);
  state.activeChannel = payload.channel;
  state.messages = payload.messages || [];
  state.firstUnreadMessageId = payload.firstUnreadMessageId || null;

  renderChannelList();
  renderChatHeader();
  renderMessageList({
    focusUnread: options.focusUnread !== false,
    preserveScroll: Boolean(options.preserveScroll),
  });
}

async function refreshCurrentView(silent = false, options = {}) {
  const activeServerId = state.activeServerId;
  const activeChannelId = state.activeChannelId;

  try {
    if (silent && activeChannelId && state.serverDetails?.server) {
      await loadChannelMessages(activeChannelId, {
        focusUnread: false,
        preserveScroll: true,
        showLoading: false,
      });
      return;
    }

    await loadBootstrap({
      preferredServerId: activeServerId,
      preferredChannelId: activeChannelId,
      focusUnread: options.focusUnread,
      preserveScroll: options.preserveScroll,
    });
  } catch (error) {
    if (!silent) {
      throw error;
    }

    handleError(error, false);
  }
}

function upsertMessage(nextMessage) {
  const existingIndex = state.messages.findIndex(
    (message) => Number(message.messageId) === Number(nextMessage.messageId)
  );

  if (existingIndex === -1) {
    state.messages.push(nextMessage);
  } else {
    state.messages.splice(existingIndex, 1, nextMessage);
  }

  state.messages.sort((left, right) => Number(left.messageId) - Number(right.messageId));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function prepareAttachments(fileList, existingFiles = []) {
  const selectedFiles = Array.from(fileList || []);

  if (selectedFiles.length === 0) {
    return [];
  }

  if (existingFiles.length + selectedFiles.length > CLIENT_MAX_ATTACHMENTS) {
    throw new Error(`You can attach up to ${CLIENT_MAX_ATTACHMENTS} files per message.`);
  }

  const preparedFiles = [];
  let runningTotal = existingFiles.reduce((total, file) => total + Number(file.size || 0), 0);

  for (const file of selectedFiles) {
    if (file.size > CLIENT_MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than 12 MB.`);
    }

    runningTotal += file.size;

    if (runningTotal > CLIENT_MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("The total upload size cannot exceed 24 MB.");
    }

    preparedFiles.push({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: await readFileAsDataUrl(file),
    });
  }

  return preparedFiles;
}

async function preparePendingFiles(fileList) {
  return prepareAttachments(fileList, state.pendingFiles);
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.loginForm);
  const payload = await api("/api/auth/login", {
    method: "POST",
    body: {
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || ""),
    },
  });

  state.user = payload.user;
  showApp();
  setSidebarOpen(true);
  await loadBootstrap({ focusUnread: true });
  startPolling();
  showToast(payload.message || "Logged in successfully.", "success");
  elements.loginForm.reset();
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  const formData = new FormData(elements.registerForm);
  const username = String(formData.get("username") || "").trim();
  const email = String(formData.get("email") || "").trim();

  const payload = await api("/api/auth/register", {
    method: "POST",
    body: {
      username,
      displayName: String(formData.get("displayName") || "").trim(),
      email,
      password: String(formData.get("password") || ""),
    },
  });

  elements.registerForm.reset();
  setAuthMode("login");
  elements.loginForm.elements.username.value = email || username;
  showToast(payload.message || "Account created. Please log in.", "success");
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    if (error.status !== 401) {
      throw error;
    }
  }

  resetState();
  showAuth();
  setAuthMode("login");
  showToast("You have been logged out.", "success");
}

async function handleComposerSubmit(event) {
  event.preventDefault();

  if (!state.activeChannelId) {
    showToast("Choose a channel before sending a message.", "error");
    return;
  }

  const messageText = String(elements.composerText.value || "").trim();

  if (!messageText && state.pendingFiles.length === 0) {
    showToast("Type a message or attach a file first.", "error");
    return;
  }

  const payload = await api(`/api/channels/${state.activeChannelId}/messages`, {
    method: "POST",
    body: {
      messageText,
      attachments: state.pendingFiles.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        dataUrl: file.dataUrl,
      })),
    },
  });

  if (payload.message) {
    upsertMessage(payload.message);
  }

  state.firstUnreadMessageId = null;
  state.pendingFiles = [];
  elements.composerText.value = "";
  elements.attachmentInput.value = "";
  renderAttachmentPreview();
  autoResizeComposer();
  renderMessageList({ focusUnread: false, preserveScroll: false });
}

async function handleAttachmentInputChange(event) {
  try {
    const preparedFiles = await preparePendingFiles(event.target.files);
    state.pendingFiles.push(...preparedFiles);
    renderAttachmentPreview();
  } catch (error) {
    handleError(error);
  } finally {
    event.target.value = "";
  }
}

function openCreateServerModal() {
  openModal({
    eyebrow: "New server",
    title: "Create a new server",
    description: "Server names must stay unique across the app.",
    submitLabel: "Create server",
    fields: [
      {
        name: "serverName",
        label: "Server name",
        required: true,
        placeholder: "Design Squad",
      },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        rows: 4,
        placeholder: "What is this server for?",
      },
      {
        name: "initialChannelName",
        label: "First channel name",
        placeholder: "general",
        value: "general",
      },
      {
        name: "isPrivate",
        label: "Require join requests before access",
        type: "checkbox",
        checked: true,
      },
    ],
    onSubmit: async (values) => {
      const payload = await api("/api/servers", {
        method: "POST",
        body: {
          serverName: values.serverName,
          description: values.description,
          initialChannelName: values.initialChannelName || "general",
          isPrivate: values.isPrivate,
        },
      });

      showToast(payload.message || "Server created.", "success");
      await loadBootstrap({
        preferredServerId: payload.server.serverId,
        preferredChannelId: payload.channels?.[0]?.channelId,
        focusUnread: false,
      });
    },
  });
}

function openRenameServerModal(serverId = null) {
  const targetServerId = serverId
    ? Number(serverId)
    : Number(state.serverDetails?.server?.serverId || 0);
  const server = targetServerId
    ? getServerById(targetServerId) || state.serverDetails?.server
    : null;

  if (!server || !targetServerId) {
    return;
  }

  openModal({
    eyebrow: "Server settings",
    title: "Edit server details",
    description: "Update the name, description, or privacy later whenever you need.",
    submitLabel: "Save changes",
    fields: [
      {
        name: "serverName",
        label: "Server name",
        required: true,
        value: server.name,
      },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        rows: 4,
        value: server.description,
      },
      {
        name: "isPrivate",
        label: "Require join requests before access",
        type: "checkbox",
        checked: server.isPrivate,
      },
    ],
    onSubmit: async (values) => {
      const payload = await api(`/api/servers/${targetServerId}`, {
        method: "PATCH",
        body: {
          serverName: values.serverName,
          description: values.description,
          isPrivate: values.isPrivate,
        },
      });

      showToast(payload.message || "Server updated.", "success");
      const preferredServerId =
        Number(state.activeServerId) && Number(state.activeServerId) !== Number(targetServerId)
          ? state.activeServerId
          : targetServerId;

      await loadBootstrap({
        preferredServerId,
        preferredChannelId:
          Number(preferredServerId) === Number(state.activeServerId)
            ? state.activeChannelId
            : null,
        focusUnread: false,
      });
    },
  });
}

function openDeleteServerModal(serverId = null) {
  const targetServerId = serverId
    ? Number(serverId)
    : Number(state.serverDetails?.server?.serverId || 0);
  const server = targetServerId
    ? getServerById(targetServerId) || state.serverDetails?.server
    : null;

  if (!server || !targetServerId) {
    return;
  }

  openModal({
    eyebrow: "Danger zone",
    title: `Remove ${server.name}?`,
    description: "This removes the server, its channels, messages, and requests permanently.",
    submitLabel: "Delete server",
    submitVariant: "danger",
    fields: [],
    onSubmit: async () => {
      const payload = await api(`/api/servers/${targetServerId}`, {
        method: "DELETE",
      });

      showToast(payload.message || "Server deleted.", "success");
      const nextPreferredServerId =
        Number(state.activeServerId) === targetServerId ? null : state.activeServerId;
      const nextPreferredChannelId =
        Number(state.activeServerId) === targetServerId ? null : state.activeChannelId;

      await loadBootstrap({
        preferredServerId: nextPreferredServerId,
        preferredChannelId: nextPreferredChannelId,
        focusUnread: false,
      });
    },
  });
}

function openLeaveServerModal(serverId) {
  const server = getServerById(serverId);

  if (!server) {
    return;
  }

  const isOwner = Boolean(server.isOwner);
  const description = isOwner
    ? "Leaving transfers ownership to the earliest admin. If there are no other members, the server will be removed."
    : "You will lose access to this server and its channels.";

  openModal({
    eyebrow: "Exit server",
    title: `Exit ${server.name}?`,
    description,
    submitLabel: "Exit server",
    submitVariant: "danger",
    fields: [],
    onSubmit: async () => {
      const payload = await api(`/api/servers/${server.serverId}/leave`, {
        method: "POST",
      });

      showToast(payload.message || "You left the server.", "success");

      const nextPreferredServerId =
        Number(state.activeServerId) === Number(server.serverId)
          ? null
          : state.activeServerId;
      const nextPreferredChannelId =
        Number(state.activeServerId) === Number(server.serverId)
          ? null
          : state.activeChannelId;

      await loadBootstrap({
        preferredServerId: nextPreferredServerId,
        preferredChannelId: nextPreferredChannelId,
        focusUnread: false,
      });
    },
  });
}

function openCreateChannelModal() {
  if (!state.serverDetails?.server) {
    return;
  }

  openModal({
    eyebrow: "New channel",
    title: "Create channel",
    description: "Channel names stay unique inside the current server.",
    submitLabel: "Create channel",
    fields: [
      {
        name: "channelName",
        label: "Channel name",
        required: true,
        placeholder: "announcements",
      },
      {
        name: "channelTopic",
        label: "Channel topic",
        type: "textarea",
        rows: 3,
        placeholder: "What should people discuss here?",
      },
    ],
    onSubmit: async (values) => {
      const payload = await api(`/api/servers/${state.serverDetails.server.serverId}/channels`, {
        method: "POST",
        body: {
          channelName: values.channelName,
          channelTopic: values.channelTopic,
        },
      });

      showToast(payload.message || "Channel created.", "success");
      await loadServerDetails(state.serverDetails.server.serverId, {
        preferredChannelId: payload.channel.channelId,
        focusUnread: false,
      });
    },
  });
}

function getChannelById(channelId) {
  return state.serverDetails?.channels?.find(
    (channel) => Number(channel.channelId) === Number(channelId)
  );
}

function openRenameChannelModal(channelId) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return;
  }

  openModal({
    eyebrow: "Channel settings",
    title: `Edit #${channel.name}`,
    description: "Update the channel name or topic later whenever you need.",
    submitLabel: "Save changes",
    fields: [
      {
        name: "channelName",
        label: "Channel name",
        required: true,
        value: channel.name,
      },
      {
        name: "channelTopic",
        label: "Channel topic",
        type: "textarea",
        rows: 3,
        value: channel.topic,
      },
    ],
    onSubmit: async (values) => {
      const payload = await api(`/api/channels/${channel.channelId}`, {
        method: "PATCH",
        body: {
          channelName: values.channelName,
          channelTopic: values.channelTopic,
        },
      });

      showToast(payload.message || "Channel updated.", "success");
      await loadServerDetails(state.serverDetails.server.serverId, {
        preferredChannelId: channel.channelId,
        focusUnread: false,
      });
    },
  });
}

function openDeleteChannelModal(channelId) {
  const channel = getChannelById(channelId);

  if (!channel) {
    return;
  }

  openModal({
    eyebrow: "Danger zone",
    title: `Delete #${channel.name}?`,
    description: "The channel and its message history will be removed permanently.",
    submitLabel: "Delete channel",
    submitVariant: "danger",
    fields: [],
    onSubmit: async () => {
      const payload = await api(`/api/channels/${channel.channelId}`, {
        method: "DELETE",
      });

      showToast(payload.message || "Channel deleted.", "success");
      await loadServerDetails(state.serverDetails.server.serverId, {
        focusUnread: false,
      });
    },
  });
}

function openJoinRequestModal(serverId) {
  const server =
    state.discoverServers.find(
      (candidate) => Number(candidate.serverId) === Number(serverId)
    ) ||
    state.serverSearchResults.find(
      (candidate) => Number(candidate.serverId) === Number(serverId)
    );

  if (!server) {
    return;
  }

  openModal({
    eyebrow: "Join request",
    title: `Request access to ${server.name}`,
    description: "Send a short note to the server admins.",
    submitLabel: "Send request",
    fields: [
      {
        name: "requestMessage",
        label: "Message",
        type: "textarea",
        rows: 4,
        placeholder: "Tell them why you want to join.",
      },
    ],
    onSubmit: async (values) => {
      const payload = await api(`/api/servers/${server.serverId}/join-requests`, {
        method: "POST",
        body: {
          requestMessage: values.requestMessage,
        },
      });

      showToast(payload.message || "Join request sent.", "success");
      await loadBootstrap({
        preferredServerId: state.activeServerId,
        preferredChannelId: state.activeChannelId,
        focusUnread: false,
      });
    },
  });
}

function openEditMessageModal(messageId) {
  const message = state.messages.find(
    (candidate) => Number(candidate.messageId) === Number(messageId)
  );

  if (!message || message.isDeleted) {
    return;
  }

  openModal({
    eyebrow: "Message edit",
    title: "Edit message",
    description: "Update the text and manage attachments before saving.",
    submitLabel: "Save message",
    fields: [
      {
        name: "messageText",
        label: "Message",
        type: "textarea",
        rows: 5,
        value: message.messageText,
      },
    ],
    customHtml: `
      <div class="modal-helper">
        ${message.attachments.length > 0
          ? "Uncheck any attachment you want to remove, or add more below."
          : "This message has no attachments yet. You can add some below."}
      </div>
      ${
        message.attachments.length > 0
          ? `
              <div class="modal-attachment-grid">
                ${message.attachments
                  .map(
                    (attachment) => `
                      <label class="checkbox-field">
                        <input
                          type="checkbox"
                          name="keepAttachmentIds"
                          value="${attachment.attachmentId}"
                          checked
                        >
                        <span>${escapeHtml(attachment.fileName)} (${formatFileSize(attachment.fileSize || 0)})</span>
                      </label>
                    `
                  )
                  .join("")}
              </div>
            `
          : ""
      }
      <label>
        <span>Add attachments</span>
        <input id="edit-message-attachments" type="file" multiple>
      </label>
    `,
    collectValues: async (form, values) => {
      const keepAttachmentIds = Array.from(
        form.querySelectorAll("input[name='keepAttachmentIds']:checked")
      ).map((input) => Number(input.value));
      const keptAttachments = message.attachments
        .filter((attachment) => keepAttachmentIds.includes(Number(attachment.attachmentId)))
        .map((attachment) => ({ size: attachment.fileSize || 0 }));
      const newAttachments = await prepareAttachments(
        form.querySelector("#edit-message-attachments")?.files,
        keptAttachments
      );

      return {
        ...values,
        keepAttachmentIds,
        attachments: newAttachments,
      };
    },
    onSubmit: async (values) => {
      const payload = await api(`/api/messages/${message.messageId}`, {
        method: "PATCH",
        body: {
          messageText: values.messageText,
          keepAttachmentIds: values.keepAttachmentIds,
          attachments: values.attachments,
        },
      });

      if (payload.message) {
        upsertMessage(payload.message);
      }

      state.firstUnreadMessageId = null;
      renderMessageList({ focusUnread: false, preserveScroll: true });
      showToast("Message edited.", "success");
    },
  });
}

function openDeleteMessageModal(messageId) {
  const message = state.messages.find(
    (candidate) => Number(candidate.messageId) === Number(messageId)
  );

  if (!message) {
    return;
  }

  openModal({
    eyebrow: "Delete message",
    title: "Delete this message?",
    description: "The chat will keep a deleted placeholder instead of removing the row completely.",
    submitLabel: "Delete message",
    submitVariant: "danger",
    fields: [],
    onSubmit: async () => {
      const payload = await api(`/api/messages/${message.messageId}`, {
        method: "DELETE",
      });

      if (payload.message) {
        upsertMessage(payload.message);
      }

      state.firstUnreadMessageId = null;
      renderMessageList({ focusUnread: false, preserveScroll: true });
      showToast("Message deleted.", "success");
    },
  });
}

async function handleRequestReview(requestId, status) {
  const payload = await api(`/api/join-requests/${requestId}/review`, {
    method: "POST",
    body: { status },
  });

  showToast(payload.message || "Request reviewed.", "success");
  await loadServerDetails(state.serverDetails.server.serverId, {
    preferredChannelId: state.activeChannelId,
    focusUnread: false,
    preserveScroll: true,
  });
}

async function handleMemberRemoval(userId) {
  const member = state.serverDetails?.members?.find(
    (candidate) => Number(candidate.userId) === Number(userId)
  );

  if (!member) {
    return;
  }

  openModal({
    eyebrow: "Remove member",
    title: `Remove ${member.displayName || member.username}?`,
    description: "They will lose access to this server and its channels immediately.",
    submitLabel: "Remove member",
    submitVariant: "danger",
    fields: [],
    onSubmit: async () => {
      const payload = await api(
        `/api/servers/${state.serverDetails.server.serverId}/members/${userId}`,
        {
          method: "DELETE",
        }
      );

      showToast(payload.message || "Member removed.", "success");
      await loadServerDetails(state.serverDetails.server.serverId, {
        preferredChannelId: state.activeChannelId,
        focusUnread: false,
        preserveScroll: true,
      });
    },
  });
}

async function handleRoleToggle(userId, nextRole) {
  const payload = await api(
    `/api/servers/${state.serverDetails.server.serverId}/members/${userId}/role`,
    {
      method: "POST",
      body: {
        serverRole: nextRole,
      },
    }
  );

  showToast(payload.message || "Role updated.", "success");
  await loadServerDetails(state.serverDetails.server.serverId, {
    preferredChannelId: state.activeChannelId,
    focusUnread: false,
    preserveScroll: true,
  });
}

async function handleSearchUserAdd(userId, serverId) {
  const targetServerId = Number(serverId);
  const selectedServer = getManageableServers().find(
    (server) => Number(server.serverId) === targetServerId
  );

  if (!targetServerId || !selectedServer) {
    showToast("Only server owners or admins can add people from search.", "error");
    return;
  }

  const payload = await api(`/api/servers/${targetServerId}/members`, {
    method: "POST",
    body: {
      userId,
    },
  });

  showToast(payload.message || "User added to the server.", "success");

  await loadBootstrap({
    preferredServerId: state.activeServerId,
    preferredChannelId: state.activeChannelId,
    focusUnread: false,
    preserveScroll: true,
  });

  await runUserSearch(false);
}

async function handleDocumentClick(event) {
  const currentMenu = event.target.closest(".action-menu");
  const membersDropdown = event.target.closest(".members-dropdown");
  const actionTarget = event.target.closest("[data-action]");

  if (!currentMenu) {
    closeActionMenus();
  }

  if (!membersDropdown && state.showMembers) {
    state.showMembers = false;
    renderMembers();
  }

  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;

  if (currentMenu && action !== "close-modal") {
    currentMenu.open = false;
  }

  try {
    switch (action) {
      case "switch-auth":
        event.preventDefault();
        setAuthMode(actionTarget.dataset.mode);
        return;

      case "close-modal":
        event.preventDefault();
        closeModal();
        return;

      case "toggle-members":
        event.preventDefault();
        state.showMembers = !state.showMembers;
        renderMembers();
        return;

      case "create-server":
        event.preventDefault();
        openCreateServerModal();
        return;

      case "search-users":
        event.preventDefault();
        openUserSearchModal();
        return;

      case "search-servers":
        event.preventDefault();
        openServerSearchModal();
        return;

      case "view-my-profile":
        event.preventDefault();
        openProfileModal();
        return;

      case "view-profile":
        event.preventDefault();
        openProfileModal(Number(actionTarget.dataset.userId));
        return;

      case "refresh":
        event.preventDefault();
        await refreshCurrentView(false, {
          focusUnread: false,
          preserveScroll: true,
        });
        showToast("Dashboard refreshed.", "success");
        return;

      case "logout":
        event.preventDefault();
        await handleLogout();
        return;

      case "create-channel":
        event.preventDefault();
        openCreateChannelModal();
        return;

      case "select-server":
        event.preventDefault();
        if (state.modal?.modalKey === "server-search") {
          closeModal({ suppressOnClose: true });
        }
        await loadServerDetails(Number(actionTarget.dataset.serverId), {
          focusUnread: true,
        });
        return;

      case "select-channel":
        event.preventDefault();
        await loadChannelMessages(Number(actionTarget.dataset.channelId), {
          focusUnread: true,
        });
        return;

      case "rename-server":
        event.preventDefault();
        openRenameServerModal(
          actionTarget.dataset.serverId ? Number(actionTarget.dataset.serverId) : null
        );
        return;

      case "delete-server":
        event.preventDefault();
        openDeleteServerModal(
          actionTarget.dataset.serverId ? Number(actionTarget.dataset.serverId) : null
        );
        return;

      case "leave-server":
        event.preventDefault();
        openLeaveServerModal(Number(actionTarget.dataset.serverId));
        return;

      case "rename-channel":
        event.preventDefault();
        openRenameChannelModal(Number(actionTarget.dataset.channelId));
        return;

      case "delete-channel":
        event.preventDefault();
        openDeleteChannelModal(Number(actionTarget.dataset.channelId));
        return;

      case "request-access":
        event.preventDefault();
        openJoinRequestModal(Number(actionTarget.dataset.serverId));
        return;

      case "review-request":
        event.preventDefault();
        await handleRequestReview(
          Number(actionTarget.dataset.requestId),
          String(actionTarget.dataset.status || "")
        );
        return;

      case "remove-member":
        event.preventDefault();
        await handleMemberRemoval(Number(actionTarget.dataset.userId));
        return;

      case "toggle-role":
        event.preventDefault();
        await handleRoleToggle(
          Number(actionTarget.dataset.userId),
          String(actionTarget.dataset.nextRole || "")
        );
        return;

      case "add-user-to-server":
        event.preventDefault();
        await handleSearchUserAdd(
          Number(actionTarget.dataset.userId),
          Number(actionTarget.dataset.serverId)
        );
        return;

      case "edit-message":
        event.preventDefault();
        openEditMessageModal(Number(actionTarget.dataset.messageId));
        return;

      case "delete-message":
        event.preventDefault();
        openDeleteMessageModal(Number(actionTarget.dataset.messageId));
        return;

      case "remove-attachment":
        event.preventDefault();
        state.pendingFiles.splice(Number(actionTarget.dataset.index), 1);
        renderAttachmentPreview();
        return;

      default:
        return;
    }
  } catch (error) {
    handleError(error);
  }
}

async function restoreSession() {
  const payload = await api("/api/auth/session");
  state.user = payload.user;
  showApp();
  setSidebarOpen(true);
  await loadBootstrap({ focusUnread: true });
  startPolling();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    void handleDocumentClick(event);
  });

  document.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target;

      if (!(menu instanceof HTMLDetailsElement) || !menu.classList.contains("action-menu")) {
        return;
      }

      if (menu.open) {
        closeActionMenus(menu);
        positionActionMenu(menu);
        return;
      }

      menu.dataset.positioned = "false";
    },
    true
  );

  elements.loginForm.addEventListener("submit", (event) => {
    void handleLoginSubmit(event).catch(handleError);
  });

  elements.registerForm.addEventListener("submit", (event) => {
    void handleRegisterSubmit(event).catch(handleError);
  });

  elements.composerForm.addEventListener("submit", (event) => {
    void handleComposerSubmit(event).catch(handleError);
  });

  elements.attachmentInput.addEventListener("change", (event) => {
    void handleAttachmentInputChange(event);
  });

  elements.composerText.addEventListener("input", autoResizeComposer);
  elements.composerText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });

  window.addEventListener("resize", () => {
    setSidebarOpen(true);
    closeActionMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modal) {
      closeModal();
    }
  });
}

async function initialize() {
  bindEvents();
  setAuthMode(window.location.hash === "#register" ? "register" : "login", false);
  setSidebarOpen(state.sidebarOpen);
  renderProfileCard();
  renderServerList();
  renderChannelList();
  renderMembers();
  renderDiscoverList();
  renderChatHeader();
  renderAttachmentPreview();
  renderMessageList({ focusUnread: false });
  autoResizeComposer();

  try {
    await restoreSession();
  } catch (error) {
    if (error.status !== 401) {
      handleError(error);
    }

    resetState();
    showAuth();
  }
}

void initialize();
