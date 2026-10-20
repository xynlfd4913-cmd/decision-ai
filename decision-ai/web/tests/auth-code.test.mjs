import assert from "node:assert/strict";
import sendCodeHandler from "../api/auth/send-code.js";
import verifyCodeHandler from "../api/auth/verify-code.js";

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function callApi(handler, req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

const originalEnv = {
  AUTH_CODE_SECRET: process.env.AUTH_CODE_SECRET,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
};

delete process.env.AUTH_CODE_SECRET;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;

const invalidAccount = await callApi(sendCodeHandler, {
  method: "POST",
  body: { account: "not-an-account" }
});

assert.equal(invalidAccount.statusCode, 400);

const unconfiguredSend = await callApi(sendCodeHandler, {
  method: "POST",
  body: { account: "user@example.com" }
});

assert.equal(unconfiguredSend.statusCode, 503);
assert.equal("devCode" in unconfiguredSend.body, false);

const unconfiguredVerify = await callApi(verifyCodeHandler, {
  method: "POST",
  body: { account: "user@example.com", code: "123456" }
});

assert.equal(unconfiguredVerify.statusCode, 503);

const wrongMethod = await callApi(sendCodeHandler, {
  method: "GET",
  body: {}
});

assert.equal(wrongMethod.statusCode, 405);

for (const [key, value] of Object.entries(originalEnv)) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

console.log("auth/code production-mode tests passed");
