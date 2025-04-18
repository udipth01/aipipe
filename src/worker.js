import { budget, salt } from "./config.js";
import * as jose from "jose";
import { providers } from "./providers.js";
import { updateHeaders, addCors } from "./utils.js";
export { AIPipeCost } from "./cost.js";

export default {
  async fetch(request, env) {
    // If the request is a preflight request, return early
    if (request.method == "OPTIONS")
      return new Response(null, {
        headers: addCors(new Headers({ "Access-Control-Max-Age": "86400" })),
      });

    // We use providers to handle different LLMs.
    // The provider is the first part of the path between /.../ -- e.g. /openai/
    const url = new URL(request.url);
    const provider = url.pathname.split("/")[1];

    // If token was requested, verify user and share token
    if (provider == "token") return await tokenFromCredential(url.searchParams.get("credential"), env.AIPIPE_SECRET);

    // Check if the URL matches a valid provider. Else let the user know
    if (!providers[provider] && provider != "usage")
      return jsonResponse({ code: 404, message: `Unknown provider: ${provider}` });

    // Token must be present in Authorization: Bearer
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s*/, "").trim();
    if (!token) return jsonResponse({ code: 401, message: "Missing Authorization: Bearer token" });

    // Token must contain a valid JWT payload
    const payload = await validateToken(token, env.AIPIPE_SECRET);
    if (payload.error) return jsonResponse({ code: 401, message: payload.error });

    // Get the email and domain
    const email = payload.email;
    const domain = "@" + email.split("@").at(-1);
    // Get user's budget limit and time period based on email || domain || default (*) || zero limit
    const { limit, days } = budget[payload.email] ?? budget[domain] ?? budget["*"] ?? { limit: 0, days: 1 };

    // Get the SQLite database with cost data
    const aiPipeCostId = env.AIPIPE_COST.idFromName("default");
    const aiPipeCost = env.AIPIPE_COST.get(aiPipeCostId);

    // If usage data was requested, share usage and limit data
    if (provider == "usage") return jsonResponse({ code: 200, ...(await aiPipeCost.usage(email, days)), limit });

    // Reject if user's cost usage is at limit
    const cost = await aiPipeCost.cost(email, days);
    if (cost >= limit) return jsonResponse({ code: 429, message: `Use $${cost} / $${limit} in ${days} days` });

    // Allow providers to transform or reject
    const path = url.pathname.slice(provider.length + 1) + url.search;
    const { url: targetUrl, headers, error, ...params } = await providers[provider].transform({ path, request, env });
    if (error) return jsonResponse(error);

    // Make the actual request
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: updateHeaders(headers, skipRequestHeaders),
      ...params,
    });

    // Add the cost based on provider's cost
    const addCost = async ({ model, usage }) => {
      const { cost } = await providers[provider].cost({ model, usage });
      if (cost > 0) await aiPipeCost.add(email, cost);
    };

    // For JSON response, extract { model, usage } and add cost based on that
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) await addCost(await response.clone().json());

    // For streaming response, extract { model, usage } wherever it appears
    const body = contentType.includes("text/event-stream")
      ? response.body.pipeThrough(sseTransform(addCost))
      : response.body;
    // TODO: If the response is not JSON or SSE (e.g. image), handle cost.

    return new Response(body, {
      headers: addCors(updateHeaders(response.headers, skipResponseHeaders)),
      status: response.status,
      statusText: response.statusText,
    });
  },
};

const skipRequestHeaders = [/^content-length$/i, /^host$/i, /^cf-.*$/i, /^connection$/i, /^accept-encoding$/i];
const skipResponseHeaders = [/^transfer-encoding$/i, /^connection$/i];

function jsonResponse({ code, ...rest }) {
  return new Response(JSON.stringify(rest, null, 2), {
    status: code,
    headers: addCors(new Headers({ "Content-Type": "application/json" })),
  });
}

/* Process an SSE stream to extract model, usage and add cost based on that */
function sseTransform(addCost) {
  let model, usage;
  return new TransformStream({
    start() {
      this.buffer = "";
    },
    transform(chunk, controller) {
      const lines = (this.buffer + new TextDecoder().decode(chunk, { stream: true })).split("\n");
      this.buffer = lines.pop() || ""; // Store partial line
      lines.forEach((line) => {
        if (line.startsWith("data: ")) {
          try {
            let event = JSON.parse(line.slice(6));
            // OpenAI's Response API returns the event inside a { response }
            event = event.response ?? event;
            [model, usage] = [model ?? event.model, usage ?? event.usage];
          } catch {}
        }
      });
      controller.enqueue(chunk);
    },
    async flush() {
      await addCost({ model, usage });
    },
  });
}

async function validateToken(token, secret) {
  // Verify the token using the secret. If it's invalid, report an error
  let payload;
  const secretBytes = new TextEncoder().encode(secret);
  try {
    payload = (await jose.jwtVerify(token, secretBytes)).payload;
  } catch (err) {
    return { error: `Bearer ${token} is invalid: ${err}` };
  }
  if (salt[payload.email] && salt[payload.email] != payload.salt)
    return { error: `Bearer ${token} is no longer valid` };
  return payload;
}

/** Return { token } given valid Google credentials */
async function tokenFromCredential(credential, secret) {
  // From https://www.googleapis.com/oauth2/v3/certs
  const JWKS = jose.createLocalJWKSet({
    keys: [
      {
        use: "sig",
        e: "AQAB",
        kid: "c37da75c9fbe18c2ce9125b9aa1f300dcb31e8d9",
        n: "vUiHFY8O45dBoYLGipsgaVOk7rGpim6CK1iPG2zSt3sO9-09S9dB5nQdIelGye-mouQXaW5U7H8lZnv5wLJ8VSzquaSh3zJkbDq-Wvgas6U-FJaMy35kiExr5gUKUGPAIjI2sLASDbFD0vT_jxtg0ZRknwkexz_gZadZQ-iFEO7unjpE_zQnx8LhN-3a8dRf2B45BLY5J9aQJi4Csa_NHzl9Ym4uStYraSgwW93VYJwDJ3wKTvwejPvlW3n0hUifvkMke3RTqnSDIbP2xjtNmj12wdd-VUw47-cor5lMn7LG400G7lmI8rUSEHIzC7UyzEW7y15_uzuqvIkFVTLXlQ",
        kty: "RSA",
        alg: "RS256",
      },
      {
        kty: "RSA",
        n: "up_Ts3ztawVy5mKB9fFwdj_AtqtYWWLh_feqL-PGY7aMF0DXpw0su6g90nvp-ODLSbc4OJac7iNYcJ2Fk_25nWqDLAC_LiRClSkfQXMTPQPl3jFs8jaDHxLjM_jOXacTxnWxFFFfUTBvz5p5GrmH504nfNAmNTvrUEJFlYHOG8TF3TbgD4h7MzZDjGCYvfcO47BVMLBPflX4fSYD6QHaYlrdwXUyMwjwaoVHxFaK4_T_MScjPEER3JrS26Dd9kzmzMRX0Dy49HHCtX7NYedHSDf51uRmVSNXefJYp1_RbPwi7U40dY57ufuqxXcihTmmZvKUHpfxHJRBXktgkD2RFQ",
        use: "sig",
        alg: "RS256",
        kid: "bc19ca8f1fad75678318adc4b24229ad75dd1a12",
        e: "AQAB",
      },
    ],
  });
  const { payload } = await jose.jwtVerify(credential, JWKS, {
    issuer: "https://accounts.google.com",
    audience: "1098061226510-1gn6mjnpdi30jiehanff71ri0ejva0t7.apps.googleusercontent.com",
  });
  if (!payload.email_verified) return jsonResponse({ code: 401, message: "Invalid Google credentials" });

  const params = { email: payload.email };
  if (salt[payload.email]) params.salt = salt[payload.email];
  const token = await new jose.SignJWT(params)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
  return jsonResponse({ code: 200, token, ...payload });
}
