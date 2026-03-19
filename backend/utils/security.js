const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const PASSWORD_PREFIX = "scrypt";
const SESSION_COOKIE_NAME = "messageme_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_ATTACHMENT_SIZE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const COLOR_PALETTE = [
  "#7C5CFF",
  "#2DD4BF",
  "#FF7A59",
  "#38BDF8",
  "#FB7185",
  "#FACC15",
  "#8B5CF6",
  "#F97316",
];

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${PASSWORD_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  if (!storedHash.startsWith(`${PASSWORD_PREFIX}$`)) {
    return storedHash === password;
  }

  const [, salt, existingHash] = storedHash.split("$");

  if (!salt || !existingHash) {
    return false;
  }

  const derivedKey = await scryptAsync(password, salt, 64);
  const existingBuffer = Buffer.from(existingHash, "hex");

  return (
    existingBuffer.length === derivedKey.length &&
    crypto.timingSafeEqual(existingBuffer, derivedKey)
  );
}

function createSessionToken() {
  return crypto.randomBytes(48).toString("hex");
}

function createSessionExpiryDate() {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function buildClearedSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header = "") {
  return header
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((cookies, segment) => {
      const separatorIndex = segment.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = segment.slice(0, separatorIndex).trim();
      const value = decodeURIComponent(segment.slice(separatorIndex + 1).trim());

      cookies[key] = value;
      return cookies;
    }, {});
}

function pickAvatarColor(seed = "") {
  const digest = crypto.createHash("sha256").update(seed).digest();
  return COLOR_PALETTE[digest[0] % COLOR_PALETTE.length];
}

function generateInviteCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function sanitizeFileName(fileName = "file") {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

function classifyMimeType(mimeType = "") {
  if (mimeType.startsWith("image/")) {
    return "IMAGE";
  }

  if (mimeType.startsWith("video/")) {
    return "VIDEO";
  }

  if (mimeType.startsWith("audio/")) {
    return "AUDIO";
  }

  return "DOCUMENT";
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  hashPassword,
  verifyPassword,
  createSessionToken,
  createSessionExpiryDate,
  buildSessionCookie,
  buildClearedSessionCookie,
  parseCookies,
  pickAvatarColor,
  generateInviteCode,
  sanitizeFileName,
  classifyMimeType,
};
