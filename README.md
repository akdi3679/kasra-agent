# Kasra — Autonomous Business Operations Agent

Kasra is an AI‑powered autonomous agent that manages business operations end‑to‑end. It plans, executes tools, learns from mistakes, and proactively suggests next steps. Built entirely on Google Cloud for the **Google Cloud Rapid Agent Hackathon 2026**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Demo Video](https://img.shields.io/badge/Demo-Video-blue)](https://youtu.be/your-demo-link)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Google Cloud Services Used](#google-cloud-services-used)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Evaluation & Tracing](#evaluation--tracing)
- [Demo Video](#demo-video)
- [License](#license)

---

## Features

### 🧠 Autonomous Multi‑Step Execution
- 15‑turn agentic loop with state ledger
- Tool dependency graph (providers → consumers)
- Automatic retry with circuit breaker and timeouts

### 🛠️ 30+ Real‑World Tools
- **Inventory**: get, update, forecast
- **Exports**: Excel, PDF, iCal
- **Web**: search, browse, OCR (images, PDF, Word, Excel)
- **Desktop**: screenshots, open apps, type, press keys
- **Browser**: navigate, click, fill forms (Playwright)
- **Communication**: email, Telegram
- **Integrations**: GitLab, Fivetran, Elasticsearch, Dynatrace (MCP + REST)
- **Code Execution**: Python sandbox
- **Scheduling**: cron tasks (pause/resume/stop/edit/delete)

### 🧬 Self‑Improvement Engine
- Automatic skill creation from successful workflows
- Quality‑ranked memory with auto‑pruning
- Episodic memory with semantic search

### 🧾 Transparent Reasoning
- Real‑time reasoning steps shown as a collapsible timeline
- Loading indicator with current step description

### 👤 Human‑in‑the‑Loop
- Confirmation dialog for dangerous operations (update stock, delete cron, send email, desktop control)

### 🔍 AI‑Controlled File Discovery
- Agent can search the filesystem, extract file content, and inject it into the chat automatically

### ⌨️ Slash Command Panel
- `/model` to select preferred LLM provider
- `/tool` to suggest a specific tool for the next request

### 🌐 Multi‑LLM Fallback
- Providers: Gemini, Cloudflare Workers AI, Groq, Cerebras, HuggingFace, OpenRouter
- Preferred model selection with automatic fallback

### 🖥️ Google Cloud Deployment
- Backend runs on **Cloud Run**
- Files stored in **Cloud Storage**
- Cron jobs managed by **Cloud Scheduler**
- Tracing & evaluation via **Arize AI**

---

## Architecture

```mermaid
flowchart TD
    subgraph Frontend["Frontend – Next.js"]
        UI[Chat Interface]
        Dash[Live Dashboard]
        Task[Task Log]
        Session[Session Slide Panel]
        Slash[Slash Command Panel]
        SSE_Client[SSE Event Listener]
    end

    subgraph Backend["Backend – Express.js on Cloud Run"]
        API[REST API /api/run]
        Orchestrator[Orchestrator – Agentic Loop]
        ToolsHub[ToolsHub – 30+ Tools]
        Memory[Memory System – 4 Layers]
        SelfImprove[Self‑Improvement Engine]
        Scheduler[Cron Scheduler]
        SSE_Server[SSE Event Emitter]
        Confirmation[Confirmation Handler]
    end

    subgraph LLM["LLM Providers – Multi‑Fallback"]
        Gemini[Google Gemini]
        Cloudflare[Cloudflare Workers AI]
        Groq[Groq]
        Cerebras[Cerebras]
        HuggingFace[HuggingFace]
        OpenRouter[OpenRouter]
    end

    subgraph GCP["Google Cloud Services"]
        CloudRun[Cloud Run]
        VertexAI[Vertex AI Agent Builder]
        CloudStorage[Cloud Storage]
        CloudScheduler[Cloud Scheduler]
    end

    subgraph Partners["Partner Integrations"]
        Elastic[Elasticsearch – MCP]
        GitLab[GitLab API]
        Fivetran[Fivetran API]
        Dynatrace[Dynatrace API]
        Arize[Arize AI – Tracing & Evaluation]
    end

    UI --> API
    API --> Orchestrator
    Orchestrator --> ToolsHub
    Orchestrator --> Memory
    Orchestrator --> SelfImprove
    Orchestrator --> LLM
    Orchestrator --> Confirmation
    Scheduler --> Orchestrator
    SSE_Server --> SSE_Client
    ToolsHub --> Partners
    ToolsHub --> GCP
    LLM --> Gemini
    LLM --> Cloudflare
    LLM --> Groq
    LLM --> Cerebras
    LLM --> HuggingFace
    LLM --> OpenRouter
    CloudRun --> Backend
    VertexAI --> Gemini
    CloudStorage --> ToolsHub
    CloudScheduler --> Scheduler
    Arize --> Orchestrator
Tech Stack
Layer Technology
Frontend Next.js 14 (React), TypeScript, Tailwind CSS, Framer Motion, Three.js
Backend  Node.js, Express, TypeScript
Database SQLite (via better‑sqlite3) with FTS5
LLM Providers  Google Gemini, Cloudflare Workers AI, Groq, Cerebras, HuggingFace, OpenRouter
OCR   Tesseract.js, pdf‑parse, pdfreader, mammoth, xlsx
Code Execution Child process Python sandbox
Memory   Vector store (JSON) + SQLite tables (memoire, self‑improve, session facts)
Real‑time   Server‑Sent Events (SSE)
Scheduling  Custom cron engine (cron‑parser)
Deployment  Google Cloud Run, Cloud Storage, Cloud Scheduler
Google Cloud Services Used
Vertex AI Agent Builder – agent reasoning pattern (Gemini as primary model)

Cloud Run – serverless container hosting for the backend

Cloud Storage – persistent storage for generated files (Excel, PDF, screenshots)

Cloud Scheduler + Cloud Tasks – managed cron job execution (portable from local scheduler)

Gemini API – primary LLM for multi‑step reasoning

Getting Started
Prerequisites
Node.js ≥ 20

Python ≥ 3.8 (for code execution)

Google Cloud CLI (for deployment)

API keys for at least one LLM provider (Gemini recommended)

Installation
bash
# Clone the repository
git clone https://github.com/your-username/kasra.git
cd kasra

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
Environment Variables
Create a .env file in the backend/ folder with your API keys:

env
# Required (at least one)
GEMINI_API_KEY=your_gemini_key
CLOUDFLARE_ACCOUNT_ID=your_cf_account
CLOUDFLARE_API_TOKEN=your_cf_token
GROQ_API_KEY=your_groq_key
CEREBRAS_API_KEY=your_cerebras_key
HUGGINGFACE_TOKEN=your_hf_token
OPENROUTER_API_KEY=your_openrouter_key

# Optional integrations
TELEGRAM_BOT_TOKEN=your_telegram_token
GITLAB_TOKEN=your_gitlab_token
GITLAB_PROJECT_ID=your_gitlab_project
ELASTICSEARCH_URL=your_es_url
ELASTICSEARCH_API_KEY=your_es_key
FIVETRAN_API_KEY=your_fivetran_key
FIVETRAN_API_SECRET=your_fivetran_secret
FIVETRAN_CONNECTOR_ID=your_fivetran_connector
DYNATRACE_URL=your_dynatrace_url
DYNATRACE_API_TOKEN=your_dynatrace_token
EMAIL_USER=your_email
EMAIL_PASS=your_email_pass

# Arize tracing
PHOENIX_ENDPOINT=http://localhost:6006
ARIZE_API_KEY=your_arize_key
Run Locally
bash
# Terminal 1 – Backend
cd backend
npm run dev

# Terminal 2 – Frontend
cd frontend
npm run dev
Open http://localhost:3000 in your browser.

Deploy to Google Cloud Run
bash
# Build and deploy backend
cd backend
gcloud run deploy kasra-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=xxx,..." \
  --memory 1Gi

# Update frontend API URL
cd ../frontend
# Edit .env.local: NEXT_PUBLIC_API_URL=https://kasra-api-xxxx-uc.a.run.app
npm run build
# Deploy frontend to Vercel / Cloud Run / Firebase Hosting
Usage
Kasra responds to natural language requests. Here are some examples:

Request  Outcome
"Show inventory"  Fetches data, displays a table
"Show inventory as table, export to Excel, and generate a PDF report"   Multi‑step execution with three outputs
"Using Python, compute the square root of total stock"   Executes real Python code, shows result
"Send an email with the inventory report" Confirmation dialog, then email sent
"Find budget.csv on my computer and summarise it"  AI‑controlled file discovery
"Schedule a weekly inventory check every Monday at 9 AM" Creates a cron job
"Set iPhone 15 Pro stock to 0"   Confirmation dialog, then update
Use /tool to suggest a specific tool for the next request, or /model to switch the preferred LLM provider.

Project Structure
text
kasra/
├── backend/                # Express.js agent backend
│   ├── src/
│   │   ├── orchestrator.ts # Core agent loop
│   │   ├── files.ts        # Database operations
│   │   ├── server.ts       # Express entry point
│   │   ├── lib/llm.ts      # Multi‑provider LLM client
│   │   ├── tools/hub.ts    # Tool registration & execution
│   │   ├── prompts/system.ts # System prompt builder
│   │   ├── memory/         # Self‑improvement & memory
│   │   ├── events.ts       # SSE event emitter
│   │   └── ...             # Other modules
│   └── public/             # Generated files (Excel, PDF, etc.)
├── frontend/               # Next.js frontend
│   ├── app/                # Pages & layout
│   ├── components/         # React components
│   │   ├── Chat.tsx        # Chat history & message bubbles
│   │   ├── InputArea.tsx   # User input with slash commands
│   │   ├── TaskLog.tsx     # Real‑time task panel
│   │   ├── SessionSlidePanel.tsx # Session manager
│   │   └── ...             # 20+ components
│   └── hooks/useAgentEvents.ts # SSE hook
├── scripts/                # Project check utilities
├── LICENSE
└── README.md
Evaluation & Tracing
Kasra integrates with Arize AI for agent evaluation. Every agent step is traced:

Turn number, session ID, goal

Reasoning text

Commands used

Output produced

Status (success / failed / retry)

Traces are sent to Arize Phoenix (self‑hosted) or Arize Cloud. To enable tracing, set PHOENIX_ENDPOINT or ARIZE_API_KEY in your .env file.

Demo Video
Watch the full demo here: Kasra Demo Video (under 4 minutes)

The video demonstrates:

Multi‑step workflow (table → Excel → PDF)

Human‑in‑the‑loop confirmation

AI‑controlled file discovery

Python code execution

Slash command panel

Self‑improvement in action

Google Cloud deployment

License
This project is licensed under the MIT License – see the LICENSE file for details.