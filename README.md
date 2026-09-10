# GIT-Photo_Gallery

A photo gallery web application with AI-powered image descriptions using Groq.

## Features

- **Image Gallery**: Browse a collection of 9 game images (Hollow Knight, Dead Cells, Noita)
- **Image Detail View**: Click any image to view it full-size with its description
- **AI Descriptions**: Generate creative descriptions using Groq's AI (via server proxy)

## Setup

### Required: Replit Secrets

The Groq API key **must** be set via Replit Secrets:

1. In your Replit project, click the **Secrets** button (lock icon) in the left sidebar
2. Add a new secret with:
   - **Key**: `GROQ_API_KEY`
   - **Value**: Your Groq API key from https://console.groq.com/keys
3. Run the project

### How It Works

**Security Architecture:**
- The frontend (browser JavaScript) **cannot** access Replit Secrets directly
- A Python Flask server (`server.py`) runs on port 5000
- The server has access to `process.env.GROQ_API_KEY` from Replit Secrets
- When you click "Generate AI Description", the frontend sends a POST request to `/api/generate-description`
- The server receives the request, uses the API key (which stays hidden on the server), calls Groq, and returns only the description text
- The API key **never** leaves the server - it's never exposed to the browser

## Running the Project

The project uses a Python Flask server to serve the static files and handle AI requests.

- Click **Run** in Replit
- The server starts on port 5000
- Open the Replit Preview to view the gallery
- Click any image to see it in detail
- On the detail page, click "Generate AI Description" to create an AI-generated description

## File Structure

- `index.html` - Main gallery page
- `image.html` - Image detail page with AI description button
- `script.js` - Gallery click handler
- `styles.css` - Styling for the gallery
- `server.py` - Flask backend that proxies Groq API requests

## Groq API

- Sign up at https://groq.com
- Get your API key from https://console.groq.com/keys
- The application uses the `llama3-8b-8192` model
- **Important**: The API key must be set in Replit Secrets - there is no other way to configure it
- The key is used server-side only and is never exposed to the browser
