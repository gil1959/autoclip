# 🎬 AutoClipper

> **SaaS AI Video Clipping & Auto-Posting Platform**  
> Upload long-form video → Gemini 1.5 Pro detects the 3 most viral moments → FFmpeg cuts & crops to 9:16 → Burn dynamic captions → Post directly to TikTok.

---

## ✨ Features

| Feature | Tech |
|---|---|
| AI-powered clip detection | Gemini 1.5 Pro + Google AI File API |
| Background job processing | BullMQ + Redis (non-blocking) |
| Vertical crop (9:16) | FFmpeg `crop=ih*9/16:ih` |
| Dynamic word-level captions | ASS subtitle burn-in via libass |
| Cloud storage | AWS S3 / MinIO |
| TikTok OAuth + Direct Post | TikTok Login Kit + Content Posting API v2 |
| Database | PostgreSQL + Prisma ORM |

---

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│   Client UI  │────▶│         Express API Server (port 3000)   │
└──────────────┘     │  /api/upload  /auth/tiktok  /api/post    │
                     └───────────┬──────────────────────────────┘
                                 │ enqueue
                     ┌───────────▼──────────────┐
                     │     BullMQ + Redis        │
                     │  video-processing queue   │
                     │  caption-burn-in queue    │
                     └───────────┬──────────────┘
                                 │ consume
                     ┌───────────▼──────────────┐
                     │      Worker Processes     │
                     │  videoWorker.js           │
                     │  captionWorker.js         │
                     └───┬──────┬───────┬───────┘
                         │      │       │
               ┌─────────▼┐  ┌──▼──┐  ┌▼────────────┐
               │  FFmpeg   │  │ S3/ │  │ Gemini 1.5  │
               │  (local)  │  │MinIO│  │  File API   │
               └───────────┘  └─────┘  └─────────────┘
                         │
               ┌─────────▼──────────┐
               │  PostgreSQL+Prisma  │
               └────────────────────┘
```

---

## 📁 Project Structure

```
autoclipper/
├── prisma/
│   └── schema.prisma          # DB models: User, TikTokCredential, VideoJob, Clip
├── src/
│   ├── config/index.js        # Centralised, validated env config
│   ├── lib/
│   │   ├── queue.js           # BullMQ queue definitions
│   │   ├── redis.js           # IORedis connection factory
│   │   ├── s3.js              # S3/MinIO client
│   │   ├── prisma.js          # Prisma singleton
│   │   └── logger.js          # Winston structured logger
│   ├── workers/
│   │   ├── videoWorker.js     # Workflow A: AI clipping pipeline
│   │   └── captionWorker.js   # Workflow B: ASS subtitle burn-in
│   ├── utils/
│   │   ├── ffmpegUtils.js     # FFmpeg: crop, cut, burn-in, probe
│   │   └── assGenerator.js    # .ass file generator from word timestamps
│   ├── services/
│   │   ├── geminiService.js   # Gemini 1.5 Pro + File API integration
│   │   ├── s3Service.js       # Upload, download, presigned URLs
│   │   └── tiktokService.js   # TikTok OAuth + Direct Post API
│   ├── routes/
│   │   ├── upload.js          # POST /api/upload
│   │   ├── clips.js           # GET/POST /api/clips
│   │   ├── auth.js            # GET /auth/tiktok (OAuth)
│   │   └── post.js            # POST /api/post/tiktok
│   └── app.js                 # Express entry point
├── .env.example               # All required environment variables
├── docker-compose.yml         # Redis + MinIO for local dev
└── package.json
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Node.js** ≥ 20
- **Docker + Docker Compose** (for Redis & MinIO)
- **FFmpeg** installed and on your `PATH` (`ffmpeg -version` to verify)
- **PostgreSQL** running locally or a cloud URL (Neon, Supabase, etc.)

### 1. Clone & Install

```bash
git clone https://github.com/gil1959/autoclip.git
cd autoclip
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `TIKTOK_CLIENT_KEY` | [TikTok for Developers](https://developers.tiktok.com/) |
| `TIKTOK_CLIENT_SECRET` | Same as above |
| `JWT_SECRET` | Any long random string |
| `SESSION_SECRET` | Any long random string |

> For local dev, leave `AWS_ACCESS_KEY_ID=minioadmin`, `AWS_SECRET_ACCESS_KEY=minioadmin`, and `STORAGE_ENDPOINT=http://localhost:9000` — MinIO handles everything.

### 3. Start Infrastructure (Redis + MinIO)

```bash
docker compose up -d
```

MinIO Console: http://localhost:9001 (user: `minioadmin` / pass: `minioadmin`)

### 4. Database Setup

```bash
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations (creates tables)
```

### 5. Run the Services

Open **3 terminals**:

```bash
# Terminal 1 — API Server
npm run dev

# Terminal 2 — Video Processing Worker (AI + FFmpeg)
npm run worker:video

# Terminal 3 — Caption Burn-in Worker
npm run worker:caption
```

Server is live at: **http://localhost:3000**  
Health check: **http://localhost:3000/health**

---

## 📡 API Reference

### Upload a Video

```http
POST /api/upload
Authorization: Bearer <jwt>
Content-Type: multipart/form-data

video: <file>
```

**Response:**
```json
{
  "success": true,
  "videoJobId": "clx...",
  "status": "PENDING"
}
```

### Poll Job Status

```http
GET /api/upload/status/:videoJobId
Authorization: Bearer <jwt>
```

### List Clips for a Job

```http
GET /api/clips?jobId=clx...
Authorization: Bearer <jwt>
```

### Generate Captions for a Clip

```http
POST /api/clips/:clipId/caption
Authorization: Bearer <jwt>
```

### Connect TikTok Account

```http
GET /auth/tiktok
Authorization: Bearer <jwt>
```
→ Redirects to TikTok OAuth page.

### Post a Clip to TikTok

```http
POST /api/post/tiktok
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "clipId": "clx...",
  "title": "This moment is insane 🔥",
  "hashtags": ["viral", "fyp", "trending"],
  "privacyLevel": "PUBLIC_TO_EVERYONE"
}
```

---

## 🔄 Workflow Details

### Workflow A — AI Video Clipping (`videoWorker.js`)

```
Upload to S3
    → Download to /tmp
    → ffprobe (get duration)
    → If file > 200 MB: extract audio .mp3 (lighter for Gemini)
    → Upload to Google AI File API
    → Poll until ACTIVE state
    → Gemini 1.5 Pro: identify 3 viral segments
        (returns: start_time, end_time, title, word_level_transcript)
    → Delete from Google AI Storage
    → FFmpeg: cut + crop to 9:16 for each clip
    → Upload clips to S3
    → Save Clip records to PostgreSQL
    → Clean up /tmp
```

### Workflow B — Caption Burn-in (`captionWorker.js`)

```
POST /api/clips/:id/caption
    → Read word_level_transcript from DB
    → Generate .ass subtitle file (bold yellow, centred, word-grouped)
    → Download raw clip from S3
    → FFmpeg: ass= filter burn-in
    → Upload captioned clip to S3
    → Update Clip.status = READY
```

### Workflow C — TikTok Post (`tiktokService.js`)

```
POST /api/post/tiktok
    → Fetch & auto-refresh TikTok access token
    → Download clip from S3
    → POST /v2/post/publish/video/init/ → get upload_url + publish_id
    → PUT video bytes to TikTok CDN
    → Poll /v2/post/publish/status/fetch/ until PUBLISH_COMPLETE
    → Update Clip.tiktokPostId + status = POSTED
```

---

## 🗄️ Database Schema

```
User ──────────── TikTokCredential (1:1)
 │
 └──────────────── VideoJob (1:N)
                       │
                       └──── Clip (1:N)
                                 ├── rawVideoKey   (S3 key)
                                 ├── finalVideoKey (S3 key, with captions)
                                 ├── transcriptJson (word[] with timestamps)
                                 └── tiktokPostId
```

**Job Statuses:** `PENDING → PROCESSING → COMPLETED | FAILED`  
**Clip Statuses:** `RAW → CAPTIONING → READY → POSTED`

---

## ⚙️ Environment Variables

See [`.env.example`](.env.example) for the full list with descriptions.

---

## 🐳 Production Deployment Notes

- Run `videoWorker.js` and `captionWorker.js` as **separate PM2 processes** or Kubernetes pods — they are stateless and scale horizontally.
- Set `STORAGE_ENDPOINT=` (empty) to use real AWS S3 in production.
- Use a connection pooler (e.g., **PgBouncer**) in front of PostgreSQL for high-concurrency.
- Store `JWT_SECRET` and `SESSION_SECRET` in a secrets manager (AWS Secrets Manager, Doppler, etc.).
- Set up a **BullMQ Dashboard** (e.g., Bull Board) for job monitoring.

---

## 📦 Tech Stack

- **Runtime:** Node.js 20+ (ESM)
- **Web:** Express 4
- **Queue:** BullMQ 5 + IORedis
- **ORM:** Prisma 5 + PostgreSQL
- **Storage:** AWS S3 / MinIO
- **AI:** Google Gemini 1.5 Pro (`@google/generative-ai`)
- **Video:** FFmpeg + fluent-ffmpeg
- **Auth:** TikTok Login Kit v2 + JWT

---

## 📄 License

MIT
