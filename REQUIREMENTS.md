# Post Studio — Requirements & One-Step Setup

This is the single setup reference for running Post Studio locally.

## What the app uses

| Capability | Default provider | Default model |
| --- | --- | --- |
| LinkedIn + X writing | Ollama | `gemma3:4b` |
| Local image generation | Draw Things CLI | `flux_2_klein_4b_q8p.ckpt` |
| Web app | Next.js + React | Node.js 22.12+ |
| LinkedIn publishing | LinkedIn API | Member OAuth token |
| X publishing | X web composer | Free / no API token |

## System requirements

- macOS for the included Draw Things local-image workflow
- Homebrew
- Node.js 22.12 or newer
- Internet connection for first-time package/model downloads
- Enough free disk space for local models (allow roughly 10+ GB; model sizes can change)

Apple Silicon is strongly preferred for local image generation.

## One-step local AI setup

From the repository root:

```bash
bash scripts/setup-local-ai.sh
```

The script will:

1. Check/install Node 22 when needed.
2. Install Ollama.
3. Install Draw Things CLI.
4. Run `npm install`.
5. Create `.env.local` from `.env.example` if it does not exist.
6. Start Ollama and download `gemma3:4b`.
7. Download the Draw Things image model.

Then run:

```bash
npm run dev:all
```

After the first setup, this is the only startup command you need.

Open:

```text
http://localhost:3000
```

## Check your local AI installation

```bash
npm run ai:check
```

## Personalize for another creator

**Edit one file:**

```text
config/creator.config.ts
```

That file contains:

- creator name and positioning
- target audience
- expertise
- public credentials
- approved experience/proof
- recurring professional opinions
- content pillars
- writing voice
- phrases to avoid
- LinkedIn/X formatting preferences
- trust and follower-growth strategy

Do not put secrets or confidential information in that file.

## Environment variables

The local AI defaults are:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b

IMAGE_PROVIDER=drawthings
DRAWTHINGS_BIN=draw-things-cli
DRAWTHINGS_MODEL=flux_2_klein_4b_q8p.ckpt
DRAWTHINGS_STEPS=4
```

### LinkedIn publishing

Optional until you want direct publishing:

```env
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_VERSION=202609
```

The member token should include:

```text
openid
profile
w_member_social
```

The app resolves the authenticated member with LinkedIn OIDC userinfo.

### X publishing

X uses the free web-composer flow.

No X API key, OAuth token, billing, or paid API access is required. The app opens X with the approved draft prefilled and you click Post manually.

Generated/uploaded images are not automatically attached to X in this free flow.

## Desktop installers

Post Studio can also be packaged as a native desktop application with Electron.

### Public downloads

After a GitHub Release is built, the README links directly to:

```text
Post-Studio-macOS.dmg (Apple Silicon)
Post-Studio-Windows.exe
```

### Desktop prerequisites

The current macOS installer targets Apple Silicon (M1/M2/M3/M4 and newer). This avoids universal-binary merge issues with architecture-specific native dependencies such as Sharp.

The installers do not bundle multi-GB AI models.

Both platforms require Ollama and the configured text model:

```bash
ollama pull gemma3:4b
```

The desktop app starts the Ollama server automatically when needed.

Local Draw Things image generation is currently macOS-only. Windows users can use text generation plus the upload/no-image workflow.

### Desktop development

```bash
npm install
npm run desktop
```

### Build macOS

```bash
npm run desktop:build:mac
```

### Build Windows

```bash
npm run desktop:build:win
```

For public releases, `.github/workflows/desktop-release.yml` builds both platforms and attaches them to GitHub Releases.

Packaged apps keep local secrets in a user-specific `.env.local`, accessible from:

```text
Post Studio → Open Local Config Folder
```

The installers are unsigned until code-signing certificates are configured, so operating-system security warnings can appear on first launch.

## Security

- `.env.local` is ignored by git.
- Never commit or paste access tokens into source files.
- Never put confidential client information in `creator.config.ts`.
- Rotate any token accidentally shown in a screenshot/chat.

## Content-growth philosophy

The system is optimized for:

```text
professional authority
        ↓
trust + authenticity
        ↓
saves / shares / useful discussion
        ↓
relevant follower growth
```

No prompt can guarantee virality. The app deliberately prioritizes credible, useful content over clickbait so growth supports the creator's professional reputation.
