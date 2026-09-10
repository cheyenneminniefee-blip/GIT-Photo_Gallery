# GIT-Photo_Gallery

A photo gallery web application with AI-powered image descriptions.

## Features

- **Image Gallery**: Browse a collection of 9 game images (Hollow Knight, Dead Cells, Noita)
- **Image Detail View**: Click any image to view it full-size
- **AI Descriptions**: Generate creative descriptions using Groq's AI

## Setup

### Required: Replit Secrets

The Groq API key **must** be set via Replit Secrets:

1. In your Replit project, click the **Secrets** button (lock icon) in the left sidebar
2. Add a new secret with:
   - **Key**: `GROQ_API_KEY`
   - **Value**: Your Groq API key from https://console.groq.com/keys
3. Run the project

## Running the Project

The project is a static HTML/CSS/JavaScript application. In Replit, it automatically serves on port 5000.

- Open the Replit Preview to view the gallery
- Click any image to see it in detail
- On the detail page, click "Generate AI Description" to create an AI-generated description

## Groq API

- Sign up at https://groq.com
- Get your API key from https://console.groq.com/keys
- The application uses the `llama3-8b-8192` model
- **Important**: The API key must be set in Replit Secrets - there is no other input method
