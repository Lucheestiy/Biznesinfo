# AI Assistant Migration Plan (Biznesinfo Production)

Date: 2026-02-12  
Target: `biznesinfo.lucheestiy.com`  
Source reference: `biznesinfo-develop.lucheestiy.com`

## Goal

Bring production AI assistant setup to feature parity with develop where required, while enforcing complete runtime/data independence between:

- `biznesinfo.lucheestiy.com` (production)
- `biznesinfo-develop.lucheestiy.com` (develop)

## Definition Of Done

- Production has a dedicated AI chat review surface available from admin panel.
- Production AI chat review shows only production-instance chats.
- Production assistant session read/write paths are instance-scoped and cannot mix with develop chats even if a shared DB is configured.
- Production config no longer relies on implicit Show DB alias for AI chats.
- Build/runtime checks pass and smoke verification is documented.

## Step-By-Step Execution Checklist

- [x] 1. Baseline audit (code, env, DB reality)
  - Compared develop vs production AI-related routes/pages/libs.
  - Verified production currently lacks chat review page/API parity.
  - Verified running container env and DB table state.

- [x] 2. Add missing AI chat review functionality to production
  - Add API endpoints for chat sessions list/detail.
  - Add production AI chats page/client.
  - Add admin entry point/button for chat review.

- [x] 3. Enforce hard instance isolation for AI chats
  - Introduce canonical production instance ID resolution.
  - Tag assistant sessions with instance metadata.
  - Filter chat list/detail and session turn operations by instance.
  - Prevent implicit fallback to `SHOW_DATABASE_URL` for AI chat DB selection.

- [x] 4. Wire and document production-safe configuration
  - Update `.env.example` for explicit isolation guidance.
  - Ensure production defaults keep chats local unless explicitly overridden.

- [x] 5. Validate step-by-step
  - Run app build/smoke checks.
  - Query DB/session metadata to confirm instance scoping behavior.
  - Verify admin navigation and API access behavior.

- [x] 6. Deployment and runtime verification
  - Rebuild/restart production app container.
  - Validate app health endpoint and chat review route behavior.

- [x] 7. Finalize and record completion
  - Mark all steps complete.
  - Summarize exact changes and follow-up actions.

## Rollback Plan

If needed, rollback by reverting the AI chats route/page/admin files and isolation changes in:

- `app/src/lib/ai/db.ts`
- `app/src/lib/ai/conversations.ts`
- `app/src/app/api/admin/ai-chats/*`
- `app/src/app/admin/ai-chats/*`
- `app/src/app/admin/AdminClient.tsx`

Then rebuild the app container.

## Execution Notes

- Work only in `biznesinfo.lucheestiy.com`.
- Do not revert unrelated local changes in this repo.
- Validate with both code-level checks and live DB checks.
- Build check passed: `npm run build` in `app/` succeeded with new routes.
- Deploy completed: `docker compose up -d --build --force-recreate --no-deps app`.
- Runtime check passed:
  - App container restarted cleanly.
  - `GET /api/admin/ai-chats` returns `401 Unauthorized` when unauthenticated (endpoint active).
  - Running app env includes `AI_INSTANCE_ID=biznesinfo.lucheestiy.com`.
