const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5000;
const ROOT = path.resolve(__dirname);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function getImageTitle(imageName) {
  return imageName.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replaceAll("_", " ");
}

async function generateDescription(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": 2,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end("{}");
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      sendJson(response, 413, { error: "Request body too large" });
      return;
    }
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON" });
    return;
  }

  const imageName = data?.imageName || "";
  if (!imageName) {
    sendJson(response, 400, { error: "No image name provided" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    sendJson(response, 400, { error: "GROQ_API_KEY not configured in Replit Secrets" });
    return;
  }

  const imageTitle = getImageTitle(imageName);
  const prompt = `Describe the image titled "${imageTitle}" in a creative and detailed way. Focus on what the image might contain based on its title. Provide a 2-3 sentence description.`;

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (groqResponse.status !== 200) {
      let errorMessage = await groqResponse.text();
      try {
        const errorData = JSON.parse(errorMessage);
        errorMessage = errorData?.error?.message || errorMessage;
      } catch {
        // Keep the raw response text, matching the Python fallback.
      }
      sendJson(response, 500, { error: `API request failed: ${errorMessage}` });
      return;
    }

    const result = await groqResponse.json();
    sendJson(response, 200, {
      description: result.choices[0].message.content,
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      sendJson(response, 504, { error: "Request timed out after 30 seconds" });
      return;
    }
    sendJson(response, 500, { error: error.message });
  }
}

function serveStatic(request, response, requestPath) {
  const requestedFile = requestPath === "/favicon.ico" ? "/favicon.svg" : requestPath;
  const decodedPath = decodeURIComponent(requestedFile === "/" ? "/index.html" : requestedFile);
  const filePath = path.resolve(ROOT, `.${decodedPath}`);

  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendText(response, 404, "File not found");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(response, 404, "File not found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/generate-description" && ["POST", "OPTIONS"].includes(request.method)) {
    await generateDescription(request, response);
    return;
  }

  serveStatic(request, response, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving photo gallery on http://0.0.0.0:${PORT}`);
});