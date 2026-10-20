import assert from "node:assert/strict";
import handler from "../api/analyze.js";

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

async function callApi(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

const originalKey = process.env.DEEPSEEK_API_KEY;
delete process.env.DEEPSEEK_API_KEY;

const ok = await callApi({
  method: "POST",
  body: {
    question: "我现在工作很累，但又担心房租压力，到底要不要辞职？",
    scene: "career",
    depth: "basic"
  }
});

assert.equal(ok.statusCode, 200);
assert.equal(ok.body.provider, "fallback");
assert.equal(ok.body.sceneLabel, "职业决策");
assert.ok(Array.isArray(ok.body.rational));
assert.ok(Array.isArray(ok.body.emotional));
assert.ok(Array.isArray(ok.body.actions));

const tooShort = await callApi({
  method: "POST",
  body: { question: "辞职吗", scene: "career", depth: "basic" }
});

assert.equal(tooShort.statusCode, 400);

const wrongMethod = await callApi({
  method: "GET",
  body: {}
});

assert.equal(wrongMethod.statusCode, 405);

if (originalKey) process.env.DEEPSEEK_API_KEY = originalKey;

console.log("api/analyze tests passed");
