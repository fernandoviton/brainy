# Open Brain (OB1) — Research Summary

**Date:** 2026-04-05
**Source TODO:** investigate-open-brain

---

## What Is Open Brain?

Open Brain (repo name: **OB1**) is an open-source personal knowledge infrastructure created by **Nate B. Jones**. It was released on GitHub on March 11, 2026. The tagline is:

> "The infrastructure layer for your thinking. One database, one AI gateway, one chat channel — any AI plugs in. No middleware, no SaaS."

It solves a specific problem: every AI tool (ChatGPT, Claude, Cursor, etc.) maintains its own isolated memory. When you switch tools or start a new chat, you start from zero. Open Brain provides a **shared, persistent memory layer** that any MCP-compatible AI can read from and write to.

## Who Is Nate B. Jones?

Nate B. Jones is a developer who has worked at Amazon and other companies. He runs a YouTube channel called **"AI News & Strategy Daily"** and publishes on Substack, TikTok, and podcasts. His content focuses on practical AI tooling, career strategy in the AI era, and "AI native" workflows. He is not primarily a PKM creator — his angle is AI infrastructure and productivity.

- Personal site: https://www.natebjones.com/
- YouTube: "AI News & Strategy Daily" (search @natebjones)
- Substack: https://natesnewsletter.substack.com/

## How It Works

### Architecture

| Component | Technology |
|---|---|
| Database | PostgreSQL (Supabase) with pgvector |
| AI Gateway | OpenRouter (one key for all models) |
| MCP Server | Supabase Edge Function (Deno/TypeScript) |
| Capture | Slack or Discord bot, or direct via AI |
| Frontend (optional) | SvelteKit or Next.js dashboards |

### Core Flow

1. You type a thought (via Slack, Discord, or directly through an AI tool)
2. The system generates a vector embedding and extracts metadata automatically
3. The thought is stored in a PostgreSQL `thoughts` table with content + embedding + metadata
4. Any MCP-connected AI can then **search by meaning** (semantic/vector search) or browse recent thoughts

### MCP Tools Exposed

The MCP server provides four tools to connected AI clients:

1. **Semantic search** — find thoughts by meaning, not keywords
2. **Browse recent thoughts** — list latest entries
3. **Stats** — overview of stored knowledge
4. **Capture** — write new thoughts into the database

### Setup

- ~45 minutes, designed for zero coding experience
- Uses two free services: **Supabase** (database) and **OpenRouter** (AI gateway)
- Running cost: **$0.10-$0.30/month**
- Connects to Claude Desktop, ChatGPT, Claude Code, Cursor, and any MCP-compatible client via a single URL

## Key Features

- **Cross-tool memory**: One brain accessible from Claude, ChatGPT, Cursor, etc.
- **Semantic search**: Vector similarity matching — "career changes" finds "Sarah's thinking about leaving" even with zero keyword overlap
- **Content deduplication**: SHA-256 fingerprinting prevents duplicate entries
- **Row-level security**: Multi-user isolation possible
- **Data ownership**: Everything lives in your own Supabase project
- **Extensible**: Extensions, recipes, and community contributions available

## Extensions & Ecosystem

The repo includes a curated learning path of extensions:

1. Household Knowledge Base (beginner)
2. Home Maintenance Tracker (beginner)
3. Family Calendar (intermediate)
4. Meal Planning (intermediate)
5. Professional CRM (intermediate)
6. Job Hunt Pipeline (advanced)

Community-contributed **data import recipes** exist for: ChatGPT, Perplexity, Obsidian, X/Twitter, Instagram, Google Activity, Grok, and email history.

There are also **agent skill packs**, **workflow recipes** (auto-capture, brain dump mining, deduplication), and optional **frontend dashboards** in SvelteKit and Next.js.

## Community & Traction

- **1,200+ GitHub stars**, 208 forks (as of early April 2026)
- Active Discord community
- FAQ based on real community questions from Substack, YouTube, and Discord
- Multiple community forks and adaptations (e.g., `RadixSeven/OpenBrain`, `niemesrw/openbrain`)
- Licensed under FSL-1.1-MIT (Functional Source License with MIT fallback)

## Relevance to Brainy

### Similarities

| Aspect | Brainy | Open Brain |
|---|---|---|
| Core idea | Second brain / personal knowledge system | Second brain / personal knowledge system |
| Database | Supabase (PostgreSQL) | Supabase (PostgreSQL + pgvector) |
| Storage model | Structured: TODOs, captures, knowledge docs | Flat: "thoughts" table with embeddings |
| AI access | CLI-based, used by Claude Code | MCP server, used by any MCP client |
| Data ownership | Self-hosted Supabase | Self-hosted Supabase |

### Key Differences

| Aspect | Brainy | Open Brain |
|---|---|---|
| **Structure** | Highly structured (TODOs with status/priority, knowledge paths, captures with processing) | Flat/unstructured (everything is a "thought" with auto-extracted metadata) |
| **Retrieval** | Path-based lookup, CLI commands | Semantic/vector search via pgvector |
| **Multi-tool access** | Single tool (Claude Code) | Any MCP-compatible AI client |
| **Capture** | Manual via CLI or Claude Code | Slack/Discord bots, AI tool capture |
| **Organization** | Explicit (categories, paths, statuses) | Emergent (meaning-based, metadata tags) |
| **Processing** | Explicit capture-to-knowledge pipeline | Auto-embedding on ingest |

### What Brainy Could Learn From Open Brain

1. **Vector search**: Adding pgvector embeddings to knowledge entries would enable semantic retrieval — finding related knowledge by meaning rather than exact path lookup.
2. **MCP server**: Exposing Brainy as an MCP server would allow access from Claude Desktop, ChatGPT, Cursor, and other tools — not just Claude Code.
3. **Passive capture**: Slack/Discord integration for low-friction thought capture is a compelling pattern.
4. **Multi-client access**: The single-URL MCP approach is elegant for cross-tool access.

### Where Brainy Is Already Stronger

1. **Structure**: Brainy's TODO lifecycle (inbox -> active -> later -> scheduled -> archived) with priorities, blocking relationships, and notes is far richer than Open Brain's flat thought model.
2. **Processing pipeline**: The capture -> process -> knowledge/TODO flow adds intentional curation that Open Brain lacks.
3. **Proactive behavior**: Brainy suggests actions, flags blocked items, and connects related TODOs. Open Brain is passive storage.
4. **Knowledge organization**: Hierarchical knowledge paths (`category/topic.yml`) provide structure that pure semantic search cannot.

## Pros

- Very low cost ($0.10-$0.30/month)
- Excellent onboarding — detailed guides for non-technical users
- True cross-tool memory via MCP standard
- Full data ownership
- Active community and growing ecosystem
- Semantic search is powerful for recall

## Cons & Limitations

- **No editing UI**: Browsing/editing stored thoughts requires Supabase Table Editor or SQL — no purpose-built interface
- **Flat data model**: Everything is a "thought" — no inherent structure for different content types (TODOs, projects, references)
- **Retrieval quality scales with data**: Semantic search is weak with few entries; needs volume to work well
- **Configuration-heavy setup**: Despite good docs, issues are typically config mismatches (secrets, URLs, skipped steps)
- **ChatGPT quirks**: ChatGPT doesn't auto-select MCP tools as reliably as Claude
- **No processing/curation layer**: Thoughts go in and come out, but there's no built-in pipeline for refining raw captures into structured knowledge
- **FSL license**: Not pure open source — the Functional Source License has some restrictions (converts to MIT after a period)

## Links

- **GitHub repo**: https://github.com/NateBJones-Projects/OB1
- **Setup guide**: https://promptkit.natebjones.com/20260224_uq1_guide_main
- **FAQ**: https://promptkit.natebjones.com/20260224_uq1_guide_02
- **Companion prompts**: https://github.com/NateBJones-Projects/OB1/blob/main/docs/02-companion-prompts.md
- **Nate's Substack**: https://natesnewsletter.substack.com/
- **Nate's site**: https://www.natebjones.com/
- **SimpleNews coverage**: https://www.simplenews.ai/news/ob1-open-brain-offers-dollar010month-personal-knowledge-infrastructure-for-ai-agents-ssf5
- **MindStudio writeup**: https://www.mindstudio.ai/blog/what-is-openbrain-personal-ai-memory-database
