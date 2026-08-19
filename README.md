# ReachInbox Full-stack Email Job Scheduler (Monorepo)

A production-grade email scheduler service and dashboard. This service features persistent campaign scheduling, multi-sender round-robin pooling, worker concurrency, and resilient hourly rate limits with automatic next-hour rescheduling.

---

## 🚀 Tech Stack

- **Backend:** Node.js, TypeScript, Express.js, Prisma ORM, MySQL, BullMQ, ioredis.
- **Frontend:** React, TypeScript, Tailwind CSS, Vite, @react-oauth/google, Axios, PapaParse.
- **SMTP Service:** Ethereal Email (fake SMTP for safe, isolated delivery testing).
- **Queue/Scheduler Cache:** Portable native Redis (running on local port 6379, no Docker required!).

---

## ⚙️ Architecture & Implementation Details

### 1. How Scheduling & Queueing Work
- When a campaign is submitted via the Compose UI, it includes a list of recipients (parsed from CSV), a start date/time, a spacing delay (e.g. 2s), and an hourly send limit.
- The backend parses these parameters. For each recipient, it creates a database record in the `EmailJob` table with a status of `PENDING` and calculates its precise scheduled time:
  $$\text{Scheduled Time} = \text{Start Time} + (\text{Index} \times \text{Spacing Delay})$$
- The backend schedules a delayed job in **BullMQ** using the calculated delay. Each queue job ID combines the database UUID with its scheduled timestamp. This gives a rate-limit reschedule a new ID while making recovery of the same scheduled occurrence idempotent.
- Delayed jobs are stored in Redis sorted sets. When a job becomes due, Redis moves it to the active queue, and the BullMQ worker picks it up.

### 2. Concurrency & Rate Limiting (Provider Throttling)
- **Worker Concurrency:** BullMQ worker is configured with a concurrency of `5` (configurable via `.env`). Multiple workers run safely in parallel.
- **Between-Email Spacing Delay:**
  - **Campaign Spacing Delay:** The delay spacing (e.g. 2s) selected when creating the campaign in the Compose form. This spaces out the initial calculated scheduling times for each recipient to stagger job releases.
  - **Provider Minimum Delay:** A global safety throttle per sender configured via `DEFAULT_MIN_DELAY_MS` in the backend environment. If multiple jobs for the same sender attempt to execute concurrently or closer than this threshold, the worker will sleep for the difference before connecting to the SMTP provider.
- **Emails Per Hour (Rate Limiting):**
  - We track hourly sends in Redis using keys formatted as `sender:rate:${senderId}:${YYYYMMDDHH}`.
  - When a worker processes an email, it increments the sender's current hour counter.
  - If the counter exceeds the hourly limit, the job is **rescheduled** for the start of the next hour window:
    - The worker decrements the hour counter (since the email wasn't sent).
    - It updates the database `EmailJob` status back to `PENDING` and sets `scheduledAt` to the start of the next hour.
    - It creates a new delayed BullMQ job with the next-hour timestamp in its ID, so it cannot collide with the currently active queue job.

### 3. Persistence & Restart Resilience
- **Redis Queue Persistence:** Delayed queue states are persisted in Redis. If the server restarts, BullMQ reads its state back from Redis, resuming campaign sends without losing jobs or starting from scratch.
- **Database Checking:** The worker atomically acquires a database processing lease before sending. On startup, stale `PROCESSING` leases are returned to `PENDING` and all pending records are reconciled back into BullMQ, so a crash cannot leave an email permanently stranded.

---

## 📂 Repository Structure

```
├── backend/                  # Express.js backend & BullMQ worker
│   ├── prisma/               # Prisma schema & migrations
│   ├── src/
│   │   ├── routes/           # Auth and Email router endpoints
│   │   ├── config.ts         # Environment settings
│   │   ├── prisma.ts         # DB Client helper
│   │   ├── queue.ts          # BullMQ queue handlers
│   │   ├── worker.ts         # BullMQ worker processor
│   │   └── server.ts         # Express entry point
│   ├── tsconfig.json
│   ├── package.json
│   └── .env
├── frontend/                 # React Vite frontend dashboard
│   ├── src/
│   │   ├── pages/            # Login and Dashboard layouts
│   │   ├── App.tsx           # Router and auth state manager
│   │   ├── index.css         # Tailwind & glassmorphism theme
│   │   └── main.tsx          # App entry point
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   └── .env
├── redis/                    # Portable Redis 5.0.14 instance (unzipped)
├── package.json              # Monorepo coordinator
└── README.md
```

---

## 🛠️ Environmental Variables

### Backend Configuration (`backend/.env`)
Create a `.env` file in the `backend/` folder:
```env
PORT=5000
DATABASE_URL="mysql://root:password@localhost:3306/outbox_scheduler"
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=reachinbox_campaign_secret_key_9988
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
WORKER_CONCURRENCY=5
DEFAULT_MIN_DELAY_MS=2000
DEFAULT_MAX_EMAILS_PER_HOUR=200
```

### Frontend Configuration (`frontend/.env`)
Create a `.env` file in the `frontend/` folder:
```env
VITE_API_URL=http://localhost:5000/api
VITE_GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```

---

## 📦 Getting Started & Running Locally

### Prerequisites
- Node.js (v20+ recommended)
- MySQL running on port 3306

### Step 1: Install Dependencies
From the monorepo root directory:
```bash
# Install root, backend, and frontend dependencies
npm run install:all
```

### Step 2: Database Migration
By default, the database is configured to use MySQL. Provide your connection string in `backend/.env` and run:
```bash
npm run db:migrate
```

*Note: Ensure your MySQL service is running and credentials in `backend/.env` are correctly configured before running migrations.*

### Step 3: Run the Application
Start Redis, Express Backend, and Vite Frontend concurrently:
```bash
npm run dev
```
The services will start on:
- **Redis Server:** Port 6379
- **Express Backend:** Port 5000 (health check at `http://localhost:5000/api/health`)
- **Vite Frontend:** Port 5173 (open `http://localhost:5173` in your browser)

---

## ⚙️ Verification & Campaigns Testing

### Manual Walkthrough on Frontend
1. Open `http://localhost:5173`.
2. Sign in using your Google Account (make sure your Client ID is configured in both `.env` files).
3. Click **Compose New Campaign**.
4. Fill in the Campaign Subject and Body, then upload `sample_leads.csv` (located at the root folder).
5. Set delay to `2s` and limit to `5`.
6. Click **Schedule Campaign**.
7. Refresh the **Scheduled Queue** tab to view the pending leads.
8. Wait a few seconds and check the **Sent Log History** tab. You will see delivery logs and clickable **View Fake Ethereal Email Preview** links that open the sent mock email in Ethereal.

---

## 🛠️ Features Mapped

### Backend
- **Scheduler:** Delayed BullMQ jobs linked to relational models.
- **State Persistence:** Redis queue persistence + database idempotency checks.
- **Round-robin Senders Pool:** Auto-creates multiple Ethereal SMTP accounts on start and round-robins campaigns.
- **Throttling Delay:** Strict spacing delay (sleep) between sends verified by Redis state keys.
- **Rescheduling Rate Limiter:** Reschedules jobs to `nextHourStart` when hourly limit is reached.

### Frontend
- **Auth:** Real Google OAuth Login component.
- **Dashboard Layout:** Premium theme showing campaigns counts and tables.
- **Compose Modal:** CSV parsing with PapaParse, delay throttling configurations, and start date-time scheduler.
- **Ethereal Mail Previews:** Direct clickable preview links in sent email tables.
- **Resilience UX:** Loading indicators and empty queue states.
