import t from "tap";
import * as jose from "jose";
import { readFileSync } from "fs";
import { salt } from "../src/config.js";

// Get base URL environment or default to localhost:8787
const BASE_URL = process.env.BASE_URL || "http://localhost:8787";
const AIPIPE_SECRET = readFileSync(".dev.vars", "utf8")
  .split("\n")
  .find((l) => l.startsWith("AIPIPE_SECRET="))
  .split("=")[1];

async function createToken(email = "test@example.com", salt) {
  return await new jose.SignJWT({ email, ...(salt ? { salt } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(AIPIPE_SECRET));
}

async function fetch(path, { headers, ...params } = {}) {
  const url = `${BASE_URL}${path}`;
  return await globalThis.fetch(url, { headers: { "Content-Type": "application/json", ...headers }, ...params });
}

async function getUsage(token) {
  return await fetch("/usage", { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json());
}

t.test("CORS headers", async (t) => {
  const res = await fetch("/openrouter/v1/models", { method: "OPTIONS" });
  t.equal(res.status, 200);
  t.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  t.equal(res.headers.get("Access-Control-Allow-Methods"), "GET, POST");
  t.equal(res.headers.get("Access-Control-Max-Age"), "86400");
});

t.test("Authorization required", async (t) => {
  const res = await fetch("/openrouter/v1/models");
  t.equal(res.status, 401);
  const body = await res.json();
  t.match(body.message, /Missing Authorization/);
});

t.test("Invalid JWT token", async (t) => {
  const res = await fetch("/openrouter/v1/models", {
    headers: { Authorization: "Bearer invalid-token" },
  });
  t.equal(res.status, 401);
  const body = await res.json();
  t.match(body.message, /invalid/i);
});

t.test("Valid JWT token", async (t) => {
  const token = await createToken();
  const res = await fetch("/openrouter/v1/models", { headers: { Authorization: `Bearer ${token}` } });
  t.not(res.status, 401);
});

t.test("Invalid provider", async (t) => {
  const token = await createToken();
  const res = await fetch("/invalid-provider/", { headers: { Authorization: `Bearer ${token}` } });
  t.equal(res.status, 404);
  const body = await res.json();
  t.match(body.message, /Unknown provider/);
});

t.test("Invalid salt", async (t) => {
  const token = await createToken(Object.keys(salt)[0]);
  const res = await fetch("/openrouter/v1/models", { headers: { Authorization: `Bearer ${token}` } });
  t.equal(res.status, 401);
  const body = await res.json();
  t.match(body.message, /no longer valid/);
});

t.test("Valid salt", async (t) => {
  const token = await createToken(...Object.entries(salt)[0]);
  const res = await fetch("/openrouter/v1/models", { headers: { Authorization: `Bearer ${token}` } });
  t.equal(res.status, 200);
  const body = await res.json();
  t.ok(body.data.length);
});

t.test("Usage endpoint", async (t) => {
  const token = await createToken();
  const usage = await getUsage(token);
  t.type(usage.limit, "number");
  t.type(usage.days, "number");
  t.type(usage.cost, "number");
  t.ok(Array.isArray(usage.usage));
});

t.test("Completion and cost", async (t) => {
  const token = await createToken();
  const usageStart = await getUsage(token);

  const model = "google/gemini-2.0-flash-lite-001";
  const res = await fetch("/openrouter/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "What is 2 + 2?" }] }),
  });
  t.equal(res.status, 200);
  const body = await res.json();
  t.match(body.id, /^gen-/);
  t.match(body.model, model);

  const usageEnd = await getUsage(token);
  t.ok(usageEnd.cost > usageStart.cost);
});

t.test("Streaming completion and cost", async (t) => {
  const token = await createToken();
  const usageStart = await getUsage(token);

  const model = "google/gemini-2.0-flash-lite-001";
  const res = await fetch("/openrouter/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "What is 2 + 2?" }], stream: true }),
  });
  t.equal(res.status, 200);
  t.equal(res.headers.get("Content-Type").split(";")[0], "text/event-stream");

  await res.text();
  const usageEnd = await getUsage(token);
  t.ok(usageEnd.cost > usageStart.cost);
});

t.test("OpenAI completion and cost", async (t) => {
  const token = await createToken();
  const usageStart = await getUsage(token);

  const model = "gpt-4.1-nano";
  const res = await fetch("/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "What is 2 + 2?" }] }),
  });
  t.equal(res.status, 200);
  const body = await res.json();
  t.match(body.object, "chat.completion");

  const usageEnd = await getUsage(token);
  t.ok(usageEnd.cost > usageStart.cost);
});

t.test("OpenAI responses streaming completion and cost", async (t) => {
  const token = await createToken();
  const usageStart = await getUsage(token);

  const model = "gpt-4.1-nano";
  const res = await fetch("/openai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model, input: "What is 2 + 2?", stream: true }),
  });
  t.equal(res.status, 200);
  t.equal(res.headers.get("Content-Type").split(";")[0], "text/event-stream");

  await res.text();
  const usageEnd = await getUsage(token);
  t.ok(usageEnd.cost > usageStart.cost);
});

t.test("Budget limit exceeded", async (t) => {
  // This test assumes the user has already exceeded their budget
  const token = await createToken("blocked@example.com");
  const res = await fetch("/openrouter/v1/models", { headers: { Authorization: `Bearer ${token}` } });
  t.equal(res.status, 429);
  const body = await res.json();
  t.match(body.message, /\$0 in 1 days/);
});
