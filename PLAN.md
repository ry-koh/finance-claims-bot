# Finance Claims Bot — Implementation Plan

## Phase 1 — Foundation
- [x] 1.1 Project structure + git init
- [ ] 1.2 Supabase schema SQL migrations
- [ ] 1.3 FastAPI foundation (main.py, models, auth middleware)
- [ ] 1.4 React + Vite Mini App scaffold
- [ ] 1.5 GitHub Actions keepalive + env templates

## Phase 2 — Backend Core
- [ ] 2.1 Auth middleware (Telegram user ID whitelist)
- [ ] 2.2 Claims CRUD router
- [ ] 2.3 Claimers CRUD router
- [ ] 2.4 Receipt image pipeline (upload → Pillow → Drive)
- [ ] 2.5 Auto-grouping logic (receipts → line items, split triggers)

## Phase 3 — Document Generation
- [ ] 3.1 LOA PDF generation (fpdf2, receipt images per page)
- [ ] 3.2 Summary Sheet generation (Google Sheets API)
- [ ] 3.3 RFP generation (Google Docs API, placeholder replacement)
- [ ] 3.4 Transport Form generation (Google Sheets API, optional per claim)
- [ ] 3.5 PDF compilation (pypdf merge: RFP → LOA → Transport → Screenshot → Summary)

## Phase 4 — Email
- [ ] 4.1 Gmail OAuth setup + token storage
- [ ] 4.2 Email send endpoint
- [ ] 4.3 Email screenshot upload endpoint

## Phase 5 — Frontend Mini App
- [ ] 5.1 React + Vite setup with Tailwind + TanStack Query + Telegram SDK
- [ ] 5.2 Home screen (claims list, status filters)
- [ ] 5.3 New claim flow (3-step form)
- [ ] 5.4 Receipt upload + Cropper.js editor
- [ ] 5.5 Claim detail view (sequential actions, CRUD)
- [ ] 5.6 Identifier Data view

## Phase 6 — Infrastructure
- [ ] 6.1 Render deployment config
- [ ] 6.2 Vercel deployment config
- [ ] 6.3 GitHub Actions keepalive
- [ ] 6.4 One-time setup documentation
