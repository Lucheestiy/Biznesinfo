#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const sourceDir = (process.env.CODEX_AUTH_SYNC_SOURCE_DIR || "/host-codex").trim();
const outFile = (process.env.CODEX_AUTH_SYNC_OUT_FILE || "/repo-secrets/codex-auth.json").trim();
const intervalRaw = Number.parseInt((process.env.CODEX_AUTH_SYNC_INTERVAL_SEC || "60").trim(), 10);
const intervalSec = Number.isFinite(intervalRaw) ? Math.max(5, Math.min(3600, intervalRaw)) : 60;

let lastPayload = "";
let lastError = "";

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  process.stdout.write(`[codex-auth-sync ${nowIso()}] ${message}\n`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function ensureOutDir(targetFile) {
  const dir = path.dirname(targetFile);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function writeAtomicJson(targetFile, payload) {
  const tmp = `${targetFile}.tmp.${process.pid}`;
  await fs.writeFile(tmp, `${payload}\n`, { mode: 0o644 });
  await fs.rename(tmp, targetFile);
}

async function syncOnce() {
  const currentPath = path.join(sourceDir, "current");
  const currentAccount = (await fs.readFile(currentPath, "utf8")).trim();
  if (!currentAccount) throw new Error(`Empty current account in ${currentPath}`);

  const accountPath = path.join(sourceDir, "accounts", `${currentAccount}.json`);
  const accountJson = await readJson(accountPath);
  const token = accountJson?.tokens?.access_token;
  const accountId = accountJson?.tokens?.account_id;
  if (typeof token !== "string" || token.trim().length < 20) {
    throw new Error(`Missing tokens.access_token in ${accountPath}`);
  }

  const payload = JSON.stringify({
    tokens: {
      access_token: token.trim(),
      ...(typeof accountId === "string" && accountId.trim() ? { account_id: accountId.trim() } : {}),
    },
  });
  if (payload === lastPayload) return false;

  await ensureOutDir(outFile);
  await writeAtomicJson(outFile, payload);
  lastPayload = payload;
  log(`Synced token from account '${currentAccount}' to ${outFile}`);
  return true;
}

async function runLoop() {
  log(`Started. interval=${intervalSec}s source=${sourceDir} out=${outFile}`);
  for (;;) {
    try {
      await syncOnce();
      lastError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) log(`ERROR: ${message}`);
      lastError = message;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
  }
}

runLoop().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  log(`FATAL: ${message}`);
  process.exit(1);
});
