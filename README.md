# GIT-Photo_Gallery

A photo gallery web application with AI-powered image descriptions.

## Features

- **Image Gallery**: Browse a collection of 9 images
- **Image Detail View**: Click any image to view it full-size
- **AI Descriptions**: Generate creative descriptions using Groq's AI (requires API key)

## Setup

### Option 1: Using Replit Environment Variables (Recommended for Replit)

1. In your Replit project, click the **Secrets** button (lock icon) in the left sidebar
2. Add a new secret with:
   - **Key**: `GROQ_API_KEY`
   - **Value**: Your Groq API key from https://console.groq.com/keys
3. Run the project - the API key will be automatically available

### Option 2: Using .env File

1. Create or edit the `.env` file in your project root
2. Add your API key:
   ```
   GROQ_API_KEY=your_api_key_here
   ```
3. In Replit, the .env file is automatically loaded

### Option 3: Manual Input

You can also enter your Groq API key directly on the image detail page in the input field. It will be saved in your browser's localStorage for convenience.

## Running the Project

The project is a static HTML/CSS/JavaScript application. In Replit, it automatically serves on port 5000.

- Open the Replit Preview to view the gallery
- Click any image to see it in detail
- On the detail page, either:
  - The AI description will work automatically if you set up the environment variable
  - Or enter your Groq API key in the input field and click "Generate AI Description"

## Groq API

- Sign up at https://groq.com
- Get your API key from https://console.groq.com/keys
- The application uses the `llama3-8b-8192` model
