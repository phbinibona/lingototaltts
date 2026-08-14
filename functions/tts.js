import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cachedToken = "";
let tokenExpiresAt = 0;

function base64url(value) {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getCredentials() {
  const raw = process.env.GOOGLE_TTS_CREDENTIALS;
  if (!raw) throw new Error("GOOGLE_TTS_CREDENTIALS is not configured.");

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_TTS_CREDENTIALS is not valid JSON.");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service-account credentials are incomplete.");
  }

  return credentials;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && tokenExpiresAt - now > 120) return cachedToken;

  const credentials = getCredentials();
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned =
    `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();

  const assertion = `${unsigned}.${base64url(signer.sign(credentials.private_key))}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      "Could not obtain a Google access token."
    );
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + Number(data.expires_in || 3600);
  return cachedToken;
}

function normalizeLanguageCode(code) {
  return code === "ar-SA" ? "ar-XA" : code;
}

export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const text = String(body.text || "").trim();
    const languageCode = normalizeLanguageCode(
      String(body.languageCode || "en-GB").trim()
    );

    const allowed = new Set([
      "en-GB","ca-ES","es-ES","fr-FR","de-DE",
      "it-IT","pt-PT","eu-ES","ja-JP","ar-XA"
    ]);

    if (!text) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No text supplied." })
      };
    }

    if (text.length > 5000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Text is too long for one audio request." })
      };
    }

    if (!allowed.has(languageCode)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unsupported language code." })
      };
    }

    const requestedRate = Number(body.speakingRate);
    const speakingRate = Number.isFinite(requestedRate)
      ? Math.min(1.2, Math.max(0.75, requestedRate))
      : 1;

    const token = await getAccessToken();

    const googleResponse = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate
        }
      })
    });

    const data = await googleResponse.json();

    if (!googleResponse.ok) {
      console.error("Google TTS error", data);
      return {
        statusCode: googleResponse.status,
        headers,
        body: JSON.stringify({
          error: data?.error?.message ||
            `Google TTS returned HTTP ${googleResponse.status}`
        })
      };
    }

    if (!data?.audioContent) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Google TTS returned no audio." })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        audioContent: data.audioContent,
        mimeType: "audio/mpeg"
      })
    };

  } catch (error) {
    console.error("TTS function error", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error?.message || "Unexpected TTS server error."
      })
    };
  }
}
