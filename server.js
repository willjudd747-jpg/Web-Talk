const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bagelnet.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function localNetworkUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

function emptyData() {
  return {
    users: [],
    reservedFriendCodes: [],
    sessions: [],
    friendRequests: [],
    friendships: [],
    messages: [],
    nextUserId: 1,
    nextRequestId: 1,
    nextMessageId: 1
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData(), null, 2));
  }
}

function loadData() {
  ensureDataFile();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data.reservedFriendCodes = Array.isArray(data.reservedFriendCodes) ? data.reservedFriendCodes : [];
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    friendCode: user.friendCode,
    createdAt: user.createdAt
  };
}

function randomDigits(length) {
  let output = "";
  while (output.length < length) output += String(crypto.randomInt(0, 10));
  return output;
}

function formatFriendCode(digits) {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

function normalizeFriendCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 9);
}

function isWeakFriendCode(digits) {
  if (digits.length !== 9) return true;
  if (/^(\d)\1{8}$/.test(digits)) return true;
  if (/^(\d{3})\1\1$/.test(digits)) return true;

  const ascending = "01234567890123456789";
  const descending = "98765432109876543210";
  return ascending.includes(digits) || descending.includes(digits);
}

function createFriendCode(data) {
  const existing = new Set([
    ...data.users.map((user) => normalizeFriendCode(user.friendCode)),
    ...data.reservedFriendCodes.map(normalizeFriendCode)
  ]);

  for (let attempt = 0; attempt < 100; attempt++) {
    const digits = randomDigits(9);
    if (!existing.has(digits) && !isWeakFriendCode(digits)) {
      return formatFriendCode(digits);
    }
  }

  throw new Error("Could not create a unique friend code. Please try again.");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

function createSession(data, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  data.sessions = data.sessions.filter((session) => session.expiresAt > now);
  data.sessions.push({ token, userId, expiresAt: now + SESSION_TTL_MS });
  return token;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getSessionUser(req, data) {
  const token = parseCookies(req).bagelnet_session;
  if (!token) return null;
  const now = Date.now();
  const session = data.sessions.find((item) => item.token === token && item.expiresAt > now);
  if (!session) return null;
  return data.users.find((user) => user.id === session.userId) || null;
}

function isFriend(data, firstId, secondId) {
  return data.friendships.some((friendship) => friendship.userIds.includes(firstId) && friendship.userIds.includes(secondId));
}

function sortedPair(firstId, secondId) {
  return [firstId, secondId].sort((a, b) => a - b);
}

function friendshipKey(firstId, secondId) {
  return sortedPair(firstId, secondId).join(":");
}

function collectFriends(data, userId) {
  const friendIds = data.friendships
    .filter((friendship) => friendship.userIds.includes(userId))
    .map((friendship) => friendship.userIds.find((id) => id !== userId));

  return friendIds
    .map((id) => data.users.find((user) => user.id === id))
    .filter(Boolean)
    .map(publicUser);
}

function collectRequests(data, userId) {
  return data.friendRequests
    .filter((request) => request.status === "pending" && (request.toUserId === userId || request.fromUserId === userId))
    .map((request) => ({
      id: request.id,
      status: request.status,
      direction: request.toUserId === userId ? "incoming" : "outgoing",
      user: publicUser(data.users.find((user) => user.id === (request.toUserId === userId ? request.fromUserId : request.toUserId))),
      createdAt: request.createdAt
    }));
}

function requestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function setSessionCookie(token) {
  return `bagelnet_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie() {
  return "bagelnet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function routeStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(contents);
  });
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const data = loadData();
  const user = getSessionUser(req, data);

  try {
    if (req.method === "POST" && url.pathname === "/api/signup") {
      const body = await requestJson(req);
      const username = String(body.username || "").trim().toLowerCase();
      const displayName = String(body.displayName || "").trim();
      const password = String(body.password || "");

      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        return sendJson(res, 400, { error: "Username must be 3-20 letters, numbers, or underscores." });
      }
      if (displayName.length < 2 || displayName.length > 32) {
        return sendJson(res, 400, { error: "Display name must be 2-32 characters." });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { error: "Password must be at least 6 characters." });
      }
      if (data.users.some((item) => item.username === username)) {
        return sendJson(res, 409, { error: "That username is already taken." });
      }

      const friendCode = createFriendCode(data);
      const normalizedFriendCode = normalizeFriendCode(friendCode);

      const newUser = {
        id: data.nextUserId++,
        username,
        displayName,
        passwordHash: hashPassword(password),
        friendCode,
        createdAt: new Date().toISOString()
      };
      data.users.push(newUser);
      if (!data.reservedFriendCodes.map(normalizeFriendCode).includes(normalizedFriendCode)) {
        data.reservedFriendCodes.push(friendCode);
      }
      const token = createSession(data, newUser.id);
      saveData(data);
      return sendJson(res, 201, { user: publicUser(newUser) }, { "Set-Cookie": setSessionCookie(token) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await requestJson(req);
      const loginId = String(body.loginId || body.friendCode || body.username || "").trim();
      const friendCode = normalizeFriendCode(loginId);
      const username = loginId.toLowerCase();
      const password = String(body.password || "");
      const found = data.users.find((item) => item.username === username || normalizeFriendCode(item.friendCode) === friendCode);
      if (!found || !verifyPassword(password, found.passwordHash)) {
        return sendJson(res, 401, { error: "Username, friend code, or password is wrong." });
      }
      const token = createSession(data, found.id);
      saveData(data);
      return sendJson(res, 200, { user: publicUser(found) }, { "Set-Cookie": setSessionCookie(token) });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(req).bagelnet_session;
      if (token) {
        data.sessions = data.sessions.filter((session) => session.token !== token);
        saveData(data);
      }
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    }

    if (!user) return sendJson(res, 401, { error: "Please log in first." });

    if (req.method === "GET" && url.pathname === "/api/me") {
      return sendJson(res, 200, {
        user: publicUser(user),
        friends: collectFriends(data, user.id),
        requests: collectRequests(data, user.id)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/friend-requests") {
      const body = await requestJson(req);
      const code = normalizeFriendCode(body.friendCode);
      const target = data.users.find((item) => normalizeFriendCode(item.friendCode) === code);
      if (!target) return sendJson(res, 404, { error: "No user found with that friend code." });
      if (target.id === user.id) return sendJson(res, 400, { error: "That is your own friend code." });
      if (isFriend(data, user.id, target.id)) return sendJson(res, 409, { error: "You are already friends." });

      const existing = data.friendRequests.find(
        (request) =>
          request.status === "pending" &&
          ((request.fromUserId === user.id && request.toUserId === target.id) ||
            (request.fromUserId === target.id && request.toUserId === user.id))
      );
      if (existing) return sendJson(res, 409, { error: "A friend request is already waiting." });

      const request = {
        id: data.nextRequestId++,
        fromUserId: user.id,
        toUserId: target.id,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      data.friendRequests.push(request);
      saveData(data);
      return sendJson(res, 201, { request });
    }

    const requestMatch = url.pathname.match(/^\/api\/friend-requests\/(\d+)\/(accept|decline)$/);
    if (req.method === "POST" && requestMatch) {
      const requestId = Number(requestMatch[1]);
      const action = requestMatch[2];
      const request = data.friendRequests.find((item) => item.id === requestId && item.status === "pending");
      if (!request || request.toUserId !== user.id) return sendJson(res, 404, { error: "Friend request not found." });

      request.status = action === "accept" ? "accepted" : "declined";
      request.respondedAt = new Date().toISOString();
      if (action === "accept" && !isFriend(data, request.fromUserId, request.toUserId)) {
        data.friendships.push({
          key: friendshipKey(request.fromUserId, request.toUserId),
          userIds: sortedPair(request.fromUserId, request.toUserId),
          createdAt: new Date().toISOString()
        });
      }
      saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    const messagesMatch = url.pathname.match(/^\/api\/friends\/(\d+)\/messages$/);
    if (messagesMatch) {
      const friendId = Number(messagesMatch[1]);
      const friend = data.users.find((item) => item.id === friendId);
      if (!friend || !isFriend(data, user.id, friendId)) return sendJson(res, 404, { error: "Friend not found." });

      if (req.method === "GET") {
        const since = Number(url.searchParams.get("since") || 0);
        const key = friendshipKey(user.id, friendId);
        const messages = data.messages
          .filter((message) => message.friendshipKey === key && message.id > since)
          .slice(-100)
          .map((message) => ({
            id: message.id,
            body: message.body,
            fromUserId: message.fromUserId,
            createdAt: message.createdAt
          }));
        return sendJson(res, 200, { messages });
      }

      if (req.method === "POST") {
        const body = await requestJson(req);
        const messageBody = String(body.body || "").trim();
        if (messageBody.length < 1) return sendJson(res, 400, { error: "Message cannot be empty." });
        if (messageBody.length > 1000) return sendJson(res, 400, { error: "Message is too long." });
        const message = {
          id: data.nextMessageId++,
          friendshipKey: friendshipKey(user.id, friendId),
          fromUserId: user.id,
          toUserId: friendId,
          body: messageBody,
          createdAt: new Date().toISOString()
        };
        data.messages.push(message);
        saveData(data);
        return sendJson(res, 201, { message });
      }
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Something went wrong." });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url.startsWith("/api/")) {
    routeApi(req, res);
    return;
  }
  routeStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BagelNet is running at http://localhost:${PORT}`);
  for (const url of localNetworkUrls(PORT)) {
    console.log(`Network: ${url}`);
  }
});
