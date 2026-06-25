const state = {
  mode: "signup",
  user: null,
  friends: [],
  requests: [],
  activeFriendId: null,
  lastMessageId: 0,
  messageTimer: null,
  appTimer: null
};

const $ = (selector) => document.querySelector(selector);

const authView = $("#authView");
const appView = $("#appView");
const authForm = $("#authForm");
const signupTab = $("#signupTab");
const loginTab = $("#loginTab");
const authEyebrow = $("#authEyebrow");
const authTitle = $("#authTitle");
const identityLabel = $("#identityLabel");
const displayNameLabel = $("#displayNameLabel");
const displayNameInput = $("#displayNameInput");
const authSubmit = $("#authSubmit");
const authMessage = $("#authMessage");
const usernameInput = $("#usernameInput");
const passwordInput = $("#passwordInput");
const displayNameText = $("#displayNameText");
const usernameText = $("#usernameText");
const copyCodeButton = $("#copyCodeButton");
const logoutButton = $("#logoutButton");
const friendForm = $("#friendForm");
const friendCodeInput = $("#friendCodeInput");
const friendMessage = $("#friendMessage");
const requestList = $("#requestList");
const friendList = $("#friendList");
const refreshButton = $("#refreshButton");
const chatTitle = $("#chatTitle");
const messages = $("#messages");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const sendButton = $("#sendButton");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function setMode(mode) {
  state.mode = mode;
  signupTab.classList.toggle("active", mode === "signup");
  loginTab.classList.toggle("active", mode === "login");
  displayNameLabel.classList.toggle("hidden", mode === "login");
  displayNameInput.required = mode === "signup";
  usernameInput.value = "";
  usernameInput.placeholder = mode === "signup" ? "pixelchef" : "462-234-349";
  usernameInput.inputMode = mode === "signup" ? "text" : "numeric";
  usernameInput.maxLength = mode === "signup" ? 20 : 11;
  usernameInput.minLength = mode === "signup" ? 3 : 9;
  usernameInput.autocomplete = mode === "signup" ? "username" : "one-time-code";
  identityLabel.textContent = mode === "signup" ? "Username" : "Friend code";
  authEyebrow.textContent = mode === "signup" ? "New account" : "Return path";
  authTitle.textContent = mode === "signup" ? "Create your BagelNet ID" : "Login with your code";
  authSubmit.textContent = mode === "signup" ? "Create account" : "Login";
  authMessage.textContent = "";
}

function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function showAuth() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  clearInterval(state.messageTimer);
  clearInterval(state.appTimer);
}

function renderProfile() {
  displayNameText.textContent = state.user.displayName;
  usernameText.textContent = `@${state.user.username}`;
  copyCodeButton.textContent = state.user.friendCode;
}

function renderRequests() {
  requestList.innerHTML = "";
  if (!state.requests.length) {
    requestList.innerHTML = '<p class="empty-note">No pending requests.</p>';
    return;
  }

  for (const request of state.requests) {
    const item = document.createElement("div");
    item.className = "request-item";

    if (request.direction === "incoming") {
      item.innerHTML = `
        <strong></strong>
        <span>Wants to connect</span>
        <div class="request-actions">
          <button type="button" data-action="accept">Accept</button>
          <button type="button" data-action="decline">Decline</button>
        </div>
      `;
      item.querySelector("strong").textContent = request.user.displayName;
      item.querySelector('[data-action="accept"]').addEventListener("click", () => answerRequest(request.id, "accept"));
      item.querySelector('[data-action="decline"]').addEventListener("click", () => answerRequest(request.id, "decline"));
    } else {
      item.innerHTML = "<strong></strong><span>Request sent</span>";
      item.querySelector("strong").textContent = request.user.displayName;
    }

    requestList.append(item);
  }
}

function renderFriends() {
  friendList.innerHTML = "";
  if (!state.friends.length) {
    friendList.innerHTML = '<p class="empty-note">Accepted friends show up here.</p>';
    return;
  }

  for (const friend of state.friends) {
    const button = document.createElement("button");
    button.className = `friend-item${friend.id === state.activeFriendId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = "<div><strong></strong><span></span></div><span>Open</span>";
    button.querySelector("strong").textContent = friend.displayName;
    button.querySelector("span").textContent = `@${friend.username}`;
    button.addEventListener("click", () => selectFriend(friend.id));
    friendList.append(button);
  }
}

function renderShell() {
  renderProfile();
  renderRequests();
  renderFriends();
}

function formatTime(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function appendMessages(newMessages) {
  if (!newMessages.length) return;
  messages.classList.remove("empty");
  if (messages.querySelector("p")) messages.innerHTML = "";

  for (const message of newMessages) {
    const bubble = document.createElement("div");
    bubble.className = `message${message.fromUserId === state.user.id ? " mine" : ""}`;
    const body = document.createElement("div");
    const time = document.createElement("time");
    body.textContent = message.body;
    time.textContent = formatTime(message.createdAt);
    bubble.append(body, time);
    messages.append(bubble);
    state.lastMessageId = Math.max(state.lastMessageId, message.id);
  }

  messages.scrollTop = messages.scrollHeight;
}

async function refreshMe() {
  const payload = await api("/api/me");
  state.user = payload.user;
  state.friends = payload.friends;
  state.requests = payload.requests;
  renderShell();
  if (state.activeFriendId && !state.friends.some((friend) => friend.id === state.activeFriendId)) {
    state.activeFriendId = null;
    renderChatPlaceholder();
  }
}

function renderChatPlaceholder() {
  chatTitle.textContent = "Choose a friend";
  messages.classList.add("empty");
  messages.innerHTML = "<p>Select a friend after they accept your request.</p>";
  messageInput.disabled = true;
  sendButton.disabled = true;
}

async function selectFriend(friendId) {
  state.activeFriendId = friendId;
  state.lastMessageId = 0;
  const friend = state.friends.find((item) => item.id === friendId);
  chatTitle.textContent = friend ? friend.displayName : "Chat";
  messageInput.disabled = false;
  sendButton.disabled = false;
  messages.classList.add("empty");
  messages.innerHTML = "<p>Loading messages...</p>";
  renderFriends();
  await loadMessages();
}

async function loadMessages() {
  if (!state.activeFriendId) return;
  const payload = await api(`/api/friends/${state.activeFriendId}/messages?since=${state.lastMessageId}`);
  if (!payload.messages.length && state.lastMessageId === 0) {
    messages.classList.add("empty");
    messages.innerHTML = "<p>No messages yet.</p>";
    return;
  }
  appendMessages(payload.messages);
}

async function answerRequest(requestId, action) {
  friendMessage.textContent = "";
  await api(`/api/friend-requests/${requestId}/${action}`, { method: "POST", body: "{}" });
  await refreshMe();
}

signupTab.addEventListener("click", () => setMode("signup"));
loginTab.addEventListener("click", () => setMode("login"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  try {
    const path = state.mode === "signup" ? "/api/signup" : "/api/login";
    const body = {
      password: passwordInput.value,
      ...(state.mode === "signup"
        ? { username: usernameInput.value, displayName: displayNameInput.value }
        : { friendCode: usernameInput.value })
    };
    const payload = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.user = payload.user;
    await refreshMe();
    showApp();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

copyCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.user.friendCode);
  friendMessage.textContent = "Friend code copied.";
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  state.user = null;
  state.activeFriendId = null;
  showAuth();
});

friendCodeInput.addEventListener("input", () => {
  const digits = friendCodeInput.value.replace(/\D/g, "").slice(0, 9);
  friendCodeInput.value = digits.replace(/(\d{3})(?=\d)/g, "$1-");
});

usernameInput.addEventListener("input", () => {
  if (state.mode !== "login") return;
  const digits = usernameInput.value.replace(/\D/g, "").slice(0, 9);
  usernameInput.value = digits.replace(/(\d{3})(?=\d)/g, "$1-");
});

friendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  friendMessage.textContent = "";
  try {
    await api("/api/friend-requests", {
      method: "POST",
      body: JSON.stringify({ friendCode: friendCodeInput.value })
    });
    friendCodeInput.value = "";
    friendMessage.textContent = "Friend request sent.";
    await refreshMe();
  } catch (error) {
    friendMessage.textContent = error.message;
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !state.activeFriendId) return;
  messageInput.value = "";
  await api(`/api/friends/${state.activeFriendId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
  await loadMessages();
});

refreshButton.addEventListener("click", async () => {
  await refreshMe();
  await loadMessages();
});

async function boot() {
  setMode("signup");
  renderChatPlaceholder();
  try {
    await refreshMe();
    showApp();
  } catch {
    showAuth();
  }
  state.appTimer = setInterval(() => refreshMe().catch(() => {}), 4000);
  state.messageTimer = setInterval(() => loadMessages().catch(() => {}), 1500);
}

boot();
