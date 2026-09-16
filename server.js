const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5000;
const ROOT = path.resolve(__dirname);
const DESCRIPTIONS_FILE = path.resolve(ROOT, "descriptions.json");

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
  return imageName
    .replace(".jpg", "")
    .replace(".jpeg", "")
    .replace(".png", "")
    .replaceAll("_", " ");
}

function readDescriptions() {
  try {
    const raw = fs.readFileSync(DESCRIPTIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeDescriptions(descriptions) {
  fs.writeFileSync(DESCRIPTIONS_FILE, JSON.stringify(descriptions, null, 2), "utf-8");
}

async function fetchImageAsDataUrl(imageUrl) {
  if (imageUrl.startsWith("data:image/")) {
    return imageUrl;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new Error("The image URL is invalid.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("The image URL must use HTTP or HTTPS.");
  }

  const imageResponse = await fetch(parsedUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; PhotoGallery/1.0)",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!imageResponse.ok) {
    throw new Error(`The image host returned HTTP ${imageResponse.status}.`);
  }

  const contentType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error("The image URL did not return an image.");
  }

  const declaredLength = Number(imageResponse.headers.get("content-length") || 0);
  if (declaredLength > 20 * 1024 * 1024) {
    throw new Error("The image is larger than Groq's 20 MB vision limit.");
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  if (imageBuffer.length > 20 * 1024 * 1024) {
    throw new Error("The image is larger than Groq's 20 MB vision limit.");
  }

  return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
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
  const imageUrl = data?.imageUrl || "";
  const forceRegenerate = data?.forceRegenerate || false;
  if (!imageName) {
    sendJson(response, 400, { error: "No image name provided" });
    return;
  }

  const descriptions = readDescriptions();
  if (!forceRegenerate && descriptions[imageName]) {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(JSON.stringify({ description: descriptions[imageName] }));
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    sendJson(response, 400, {
      error: "GROQ_API_KEY not configured in Replit Secrets",
    });
    return;
  }

  const imageTitle = getImageTitle(imageName);

  try {
    let groqPayload;
    if (imageUrl) {
      const imageDataUrl = await fetchImageAsDataUrl(imageUrl);
      groqPayload = {
        model: "qwen/qwen3.8-27b",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Describe this image in a creative and detailed way. The image title is "${imageTitle}". Focus on what you can see in the image. Provide a 2-3 sentence description.`,
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      };
    } else {
      groqPayload = {
        model: "llama3-8b-8192",
        messages: [
          {
            role: "user",
            content: `Describe the image titled "${imageTitle}" in a creative and detailed way. Focus on what the image might contain based on its title. Provide a 2-3 sentence description.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      };
    }

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(groqPayload),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!groqResponse.ok) {
      let errorMessage = await groqResponse.text();
      try {
        const errorData = JSON.parse(errorMessage);
        errorMessage = errorData?.error?.message || errorMessage;
      } catch {
        // Keep the raw response text
      }
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end(
        JSON.stringify({ error: `API request failed: ${errorMessage}` }),
      );
      return;
    }

    const result = await groqResponse.json();
    const description = result.choices[0].message.content;
    descriptions[imageName] = description;
    writeDescriptions(descriptions);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(JSON.stringify({ description: description }));
  } catch (error) {
    if (error.name === "TimeoutError") {
      response.writeHead(504, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end(
        JSON.stringify({ error: "Request timed out after 30 seconds" }),
      );
      return;
    }
    const statusCode = error.message.startsWith("The image ") ? 502 : 500;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function getDescription(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const imageName = url.searchParams.get("imageName");
  const imageUrl = url.searchParams.get("imageUrl");
  if (!imageName) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: "No image name provided" }));
    return;
  }

  const descriptions = readDescriptions();
  if (descriptions[imageName]) {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ description: descriptions[imageName] }));
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: "GROQ_API_KEY not configured" }));
    return;
  }

  const imageTitle = getImageTitle(imageName);
  try {
    let groqPayload;
    if (imageUrl) {
      const imageDataUrl = await fetchImageAsDataUrl(imageUrl);
      groqPayload = {
        model: "qwen/qwen3.8-27b",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Describe this image in a creative and detailed way. The image title is "${imageTitle}". Focus on what you can see in the image. Provide a 2-3 sentence description.`,
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      };
    } else {
      groqPayload = {
        model: "llama3-8b-8192",
        messages: [
          {
            role: "user",
            content: `Describe the image titled "${imageTitle}" in a creative and detailed way. Focus on what the image might contain based on its title. Provide a 2-3 sentence description.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      };
    }

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(groqPayload),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!groqResponse.ok) {
      let errorMessage = await groqResponse.text();
      try {
        const errorData = JSON.parse(errorMessage);
        errorMessage = errorData?.error?.message || errorMessage;
      } catch {
        // Keep the raw response text
      }
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(JSON.stringify({ error: `API request failed: ${errorMessage}` }));
      return;
    }

    const result = await groqResponse.json();
    const description = result.choices[0].message.content;
    descriptions[imageName] = description;
    writeDescriptions(descriptions);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ description: description }));
  } catch (error) {
    const statusCode = error.message.startsWith("The image ") ? 502 : 500;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
}

function serveStatic(request, response, requestPath) {
  const requestedFile =
    requestPath === "/favicon.ico" ? "/favicon.svg" : requestPath;
  const decodedPath = decodeURIComponent(
    requestedFile === "/" ? "/index.html" : requestedFile,
  );
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

    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );

  if (
    url.pathname === "/api/generate-description" &&
    ["POST", "OPTIONS"].includes(request.method)
  ) {
    await generateDescription(request, response);
    return;
  }

  if (url.pathname === "/api/get-description" && request.method === "GET") {
    await getDescription(request, response);
    return;
  }

  serveStatic(request, response, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving photo gallery on http://0.0.0.0:${PORT}`);
});
