const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5000;
const ROOT = path.resolve(__dirname);
const DESCRIPTIONS_FILE = path.resolve(ROOT, "descriptions.json");
const ANIMATIONS_FILE = path.resolve(ROOT, "animations.json");
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_BASE_URL = "https://api.dev.runwayml.com/v1";

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

function readAnimations() {
  try {
    const raw = fs.readFileSync(ANIMATIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAnimations(animations) {
  fs.writeFileSync(ANIMATIONS_FILE, JSON.stringify(animations, null, 2), "utf-8");
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
    const errorText = await imageResponse.text();
    const contentType = imageResponse.headers.get("content-type") || "";
    if (contentType.includes("text/html") || errorText.includes("<html") || errorText.includes("File not found")) {
      throw new Error(`The URL returned an HTML error page. Please verify the image URL is correct and directly links to an image file.`);
    }
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

async function startAnimation(request, response) {
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

  if (!RUNWAY_API_KEY) {
    sendJson(response, 400, { error: "RUNWAY_API_KEY not configured in Replit Secrets" });
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
  const prompt = data?.prompt || "";

  if (!imageName) {
    sendJson(response, 400, { error: "No image name provided" });
    return;
  }

  if (!imageUrl) {
    sendJson(response, 400, { error: "No image URL provided" });
    return;
  }

  if (!prompt) {
    sendJson(response, 400, { error: "No prompt provided" });
    return;
  }

  try {
    const animations = readAnimations();
    if (animations[imageName] && animations[imageName][prompt]) {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(JSON.stringify({ 
        status: "completed",
        videoUrl: animations[imageName][prompt].videoUrl 
      }));
      return;
    }

    const imageDataUrl = await fetchImageAsDataUrl(imageUrl);
    const imageBuffer = Buffer.from(imageDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    const uploadResponse = await fetch(`${RUNWAY_BASE_URL}/uploads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RUNWAY_API_KEY}`,
        'Content-Type': 'application/octet-stream',
      },
      body: imageBuffer,
      signal: AbortSignal.timeout(60_000),
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const imageId = uploadData.id;

    const genResponse = await fetch(`${RUNWAY_BASE_URL}/models/gen3/txt2vid/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RUNWAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          image_id: imageId,
          seconds: 5,
          seed: Math.floor(Math.random() * 2147483647)
        }
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!genResponse.ok) {
      const errorText = await genResponse.text();
      throw new Error(`Generation failed: ${errorText}`);
    }

    const genData = await genResponse.json();
    const runId = genData.id;

    animations[imageName] = animations[imageName] || {};
    animations[imageName][prompt] = {
      runId: runId,
      imageId: imageId,
      status: "processing",
      createdAt: new Date().toISOString()
    };
    writeAnimations(animations);

    response.writeHead(202, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ 
      status: "processing",
      runId: runId,
      prompt: prompt
    }));

  } catch (error) {
    const statusCode = error.message.includes("Upload") || error.message.includes("Generation") ? 502 : 500;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function checkAnimation(request, response) {
  if (!RUNWAY_API_KEY) {
    sendJson(response, 400, { error: "RUNWAY_API_KEY not configured" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const imageName = url.searchParams.get("imageName");
  const prompt = url.searchParams.get("prompt");

  if (!imageName || !prompt) {
    sendJson(response, 400, { error: "imageName and prompt are required" });
    return;
  }

  try {
    const animations = readAnimations();
    const animationData = animations[imageName]?.[prompt];

    if (!animationData) {
      sendJson(response, 404, { error: "Animation not found" });
      return;
    }

    if (animationData.status === "completed") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(JSON.stringify({ 
        status: "completed",
        videoUrl: animationData.videoUrl
      }));
      return;
    }

    const runId = animationData.runId;
    const statusResponse = await fetch(`${RUNWAY_BASE_URL}/runs/${runId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${RUNWAY_API_KEY}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      throw new Error(`Status check failed: ${errorText}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.status === 'SUCCEEDED') {
      const outputs = statusData.outputs || [];
      const videoUrl = outputs[0]?.asset_url;

      if (videoUrl) {
        animations[imageName][prompt].status = "completed";
        animations[imageName][prompt].videoUrl = videoUrl;
        animations[imageName][prompt].completedAt = new Date().toISOString();
        writeAnimations(animations);

        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        response.end(JSON.stringify({ 
          status: "completed",
          videoUrl: videoUrl
        }));
        return;
      }
    } else if (statusData.status === 'FAILED') {
      animations[imageName][prompt].status = "failed";
      writeAnimations(animations);

      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(JSON.stringify({ 
        status: "failed",
        error: statusData.error || "Generation failed"
      }));
      return;
    }

    response.writeHead(202, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ 
      status: "processing",
      progress: statusData.progress || 0
    }));

  } catch (error) {
    response.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function getAnimation(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const imageName = url.searchParams.get("imageName");

  if (!imageName) {
    sendJson(response, 400, { error: "No image name provided" });
    return;
  }

  try {
    const animations = readAnimations();
    const imageAnimations = animations[imageName] || {};

    const result = {};
    for (const [prompt, data] of Object.entries(imageAnimations)) {
      if (data.status === "completed") {
        result[prompt] = data.videoUrl;
      }
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ animations: result }));

  } catch (error) {
    response.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function generateTitle(imageUrl) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const imageDataUrl = await fetchImageAsDataUrl(imageUrl);

  const groqPayload = {
    model: "qwen/qwen3.8-27b",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this image and provide a concise, accurate title that describes what is shown. Focus only on what you can see in the image. Return only the title, maximum 10 words.`,
          },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: 0.3,
    max_tokens: 50,
  };

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
    throw new Error(`API request failed: ${errorMessage}`);
  }

  const result = await groqResponse.json();
  return result.choices[0].message.content.trim();
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
    const statusCode = error.message.startsWith("The image ") || error.message.startsWith("The URL") ? 502 : 500;
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

async function generateTitleFromImage(request, response) {
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

  const imageUrl = data?.imageUrl || "";
  if (!imageUrl) {
    sendJson(response, 400, { error: "No image URL provided" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    sendJson(response, 400, { error: "GROQ_API_KEY not configured" });
    return;
  }

  try {
    const title = await generateTitle(imageUrl);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(JSON.stringify({ title: title }));
  } catch (error) {
    if (error.name === "TimeoutError") {
      response.writeHead(504, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end(JSON.stringify({ error: "Request timed out after 30 seconds" }));
      return;
    }
    const statusCode = error.message.startsWith("The image ") || error.message.startsWith("The URL") ? 502 : 500;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

  if (
    url.pathname === "/api/generate-title" &&
    ["POST", "OPTIONS"].includes(request.method)
  ) {
    await generateTitleFromImage(request, response);
    return;
  }

  if (url.pathname === "/api/start-animation" &&
    ["POST", "OPTIONS"].includes(request.method)
  ) {
    await startAnimation(request, response);
    return;
  }

  if (url.pathname === "/api/check-animation" && request.method === "GET") {
    await checkAnimation(request, response);
    return;
  }

  if (url.pathname === "/api/get-animation" && request.method === "GET") {
    await getAnimation(request, response);
    return;
  }

  serveStatic(request, response, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving photo gallery on http://0.0.0.0:${PORT}`);
});
