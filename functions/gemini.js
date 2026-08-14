const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash"
]);

const MAX_PROMPT_LENGTH = 12000;

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Mètode no permès." }, 405, {
      Allow: "POST"
    });
  }

  const apiKey = Netlify.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY environment variable");
    return jsonResponse(
      { error: "La clau de Gemini no està configurada al servidor." },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "La petició no conté JSON vàlid." }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const requestedModel =
    typeof body.model === "string" ? body.model : "gemini-2.5-flash";
  const temperature = Number.isFinite(Number(body.temperature))
    ? Math.min(2, Math.max(0, Number(body.temperature)))
    : 0.8;

  if (!prompt) {
    return jsonResponse({ error: "Falta el text de la petició." }, 400);
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: "La petició és massa llarga." }, 413);
  }

  const model = ALLOWED_MODELS.has(requestedModel)
    ? requestedModel
    : "gemini-2.5-flash";

  const apiUrl =
    `https://generativelanguage.googleapis.com/v1/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  try {
    const geminiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: 2048
        }
      })
    });

    const responseText = await geminiResponse.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = {
        error: "Gemini ha retornat una resposta no vàlida."
      };
    }

    if (!geminiResponse.ok) {
      const providerMessage =
        responseData?.error?.message || "No s’ha pogut generar l’exercici.";
      console.error("Gemini API error:", geminiResponse.status, providerMessage);

      return jsonResponse(
        { error: `Error de Gemini (${geminiResponse.status}): ${providerMessage}` },
        geminiResponse.status
      );
    }

    return jsonResponse(responseData, 200);
  } catch (error) {
    console.error("Function error:", error);
    return jsonResponse(
      { error: "No s’ha pogut connectar amb Gemini." },
      502
    );
  }
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}
