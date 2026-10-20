import crypto from "node:crypto";
import { redisCommand } from "./redis.js";

const CODE_TTL_SECONDS = 10 * 60;

export function normalizeAccount(account) {
  return String(account || "").trim().toLowerCase();
}

export function accountType(account) {
  const value = normalizeAccount(account);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
  if (/^1[3-9]\d{9}$/.test(value)) return "phone";
  return null;
}

export function isValidAccount(account) {
  return Boolean(accountType(account));
}

export function createCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashCode(code) {
  const secret = process.env.AUTH_CODE_SECRET;
  if (!secret) throw new Error("AUTH_CODE_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(String(code)).digest("hex");
}

export async function storeCode(account, code) {
  await redisCommand(["SET", `decision-ai:code:${normalizeAccount(account)}`, hashCode(code), "EX", CODE_TTL_SECONDS]);
}

export async function readCodeHash(account) {
  return redisCommand(["GET", `decision-ai:code:${normalizeAccount(account)}`]);
}

export async function deleteCode(account) {
  await redisCommand(["DEL", `decision-ai:code:${normalizeAccount(account)}`]);
}

export function safeEqualHash(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left), "hex");
  const rightBuffer = Buffer.from(String(right), "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function sendEmailCode(account, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "决策AI <onboarding@resend.dev>";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: account,
      subject: "决策AI 登录验证码",
      text: `你的决策AI验证码是：${code}。10分钟内有效，请勿转发给他人。`,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Email send failed");
  }
}

export async function sendSmsCode() {
  const required = [
    "ALIYUN_ACCESS_KEY_ID",
    "ALIYUN_ACCESS_KEY_SECRET",
    "ALIYUN_SMS_SIGN_NAME",
    "ALIYUN_SMS_TEMPLATE_CODE",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Aliyun SMS is not configured: ${missing.join(", ")}`);
  throw new Error("Aliyun SMS sender needs final template parameter mapping before production use");
}
