# Kasra — Autonomous Business Operations Agent

Kasra is an AI‑powered autonomous agent that manages business operations end‑to‑end. It plans, executes tools, learns from mistakes, and proactively suggests next steps. Built for the **Google Cloud Rapid Agent Hackathon 2026**.

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
- Backend runs on **Cloud Run** (or Render for demo)
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

    subgraph Backend["Backend – Express.js"]
        API[REST API]
        Orchestrator[Orchestrator – Agentic Loop]
        ToolsHub[ToolsHub – 30+ Tools]
        Memory[Memory System – 4 Layers]
        SelfImprove[Self‑Improvement Engine]
        Scheduler[Cron Scheduler]
        SSE_Server[SSE Event Emitter]
        Confirmation[Confirmation Handler]
    end

    subgraph LLM["LLM Providers"]
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
        Arize[Arize AI – Tracing]
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
Layer	Technology
Frontend	Next.js 14 (React), TypeScript, Tailwind CSS, Framer Motion, Three.js
Backend	Node.js, Express, TypeScript
Database	SQLite (via better‑sqlite3) with FTS5
LLM Providers	Google Gemini, Cloudflare Workers AI, Groq, Cerebras, HuggingFace, OpenRouter
OCR	Tesseract.js, pdf‑parse, pdfreader, mammoth, xlsx
Code Execution	Child process Python sandbox
Memory	Vector store (JSON) + SQLite tables (memoire, self‑improve, session facts)
Real‑time	Server‑Sent Events (SSE)
Scheduling	Custom cron engine (cron‑parser)
Deployment	Render (backend), Vercel (frontend)
Google Cloud Services Used
Vertex AI Agent Builder – agent reasoning pattern (Gemini as primary model)

Gemini API – primary LLM for multi‑step reasoning

Cloud Run – serverless container hosting (Dockerfile ready)

Cloud Storage – persistent storage for generated files (Excel, PDF, screenshots)

Cloud Scheduler + Cloud Tasks – managed cron job execution (portable from local scheduler)

Getting Started
Prerequisites
Node.js ≥ 20

Python ≥ 3.8 (for code execution)

API keys for at least one LLM provider (Gemini recommended)

Installation
bash
git clone https://github.com/akdi3679/kasra-agent.git
cd kasra-agent
cd backend && npm install
cd ../frontend && npm install
Environment Variables
Create a .env file in the backend/ folder:

env
# Required (at least one)
GEMINI_API_KEY=
OPENROUTER_API_KEY=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
GROQ_API_KEY=
CEREBRAS_API_KEY=
HUGGINGFACE_TOKEN=

# Arize tracing
ARIZE_API_KEY=
ARIZE_SPACE_ID=

# Optional integrations
TELEGRAM_BOT_TOKEN=
Run Locally
bash
cd backend && npm run dev    # Terminal 1
cd frontend && npm run dev   # Terminal 2
Open http://localhost:3000.

Usage
Request	Outcome
"Show inventory"	Fetches data, displays a table
"Show inventory as table, export to Excel, and generate a PDF report"	Multi‑step execution with three outputs
"Using Python, compute the square root of total stock"	Executes real Python code, shows result
"Send an email with the inventory report"	Confirmation dialog, then email sent
"Find budget.csv on my computer and summarise it"	AI‑controlled file discovery
"Schedule a weekly inventory check every Monday at 9 AM"	Creates a cron job
"Set iPhone 15 Pro stock to 0"	Confirmation dialog, then update
Use /tool to suggest a specific tool, or /model to switch the preferred LLM provider.

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

Traces are sent to Arize Cloud via OTLP. Set ARIZE_API_KEY and ARIZE_SPACE_ID in your .env file.

Demo Video
Watch the full demo here: Kasra Demo Video

The video demonstrates:

Multi‑step workflow (table → Excel → PDF)

Human‑in‑the‑loop confirmation

AI‑controlled file discovery

Python code execution

Slash command panel

Self‑improvement in action

Live deployment

License
MIT License – see LICENSE for details.
