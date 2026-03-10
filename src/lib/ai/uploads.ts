import { randomUUID } from "node:crypto";
import { basename, extname, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";

export const AI_UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const AI_UPLOAD_MAX_FILES = 10;
export const AI_UPLOAD_ALLOWED_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const DEFAULT_AI_UPLOADS_DIR = "/tmp/biznesinfo-ai-uploads";
const SAFE_STORED_FILE_NAME_RE = /^[A-Za-z0-9._-]{1,220}$/u;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
};

const AI_UPLOAD_TEXT_EXTRACT_DEFAULT_MAX_CHARS_PER_FILE = 6_000;
const AI_UPLOAD_TEXT_EXTRACT_DEFAULT_MAX_TOTAL_CHARS = 18_000;
const AI_UPLOAD_IMAGE_OCR_TIMEOUT_MS = 20_000;
const AI_UPLOAD_IMAGE_OCR_MAX_BUFFER = 2 * 1024 * 1024;
const IMAGE_TEXT_LANG_PRIMARY = "rus+eng";
const IMAGE_TEXT_LANG_FALLBACK = "eng";

type AiUploadTextExtractKind = "pdf" | "docx" | "txt" | "image";

export type AiStoredUploadFile = {
  name: string;
  size: number;
  type: string;
  storagePath: string;
  url: string;
};

export type AiUploadTextExtractionStatus = "ok" | "empty" | "unsupported" | "error" | "limit";

export type AiUploadTextExtraction = {
  name: string;
  type: string;
  size: number;
  storagePath: string;
  parser: AiUploadTextExtractKind | null;
  status: AiUploadTextExtractionStatus;
  text: string;
  truncated: boolean;
};

export type AiUploadValidationCode = "TooManyFiles" | "UnsupportedType" | "FileTooLarge" | "EmptyFile";

export class AiUploadValidationError extends Error {
  readonly code: AiUploadValidationCode;
  readonly fileName: string | null;

  constructor(code: AiUploadValidationCode, message: string, fileName: string | null = null) {
    super(message);
    this.name = "AiUploadValidationError";
    this.code = code;
    this.fileName = fileName;
  }
}

function normalizeMimeType(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

function getUploadsRootDir(): string {
  const custom = (process.env.AI_UPLOADS_DIR || "").trim();
  return custom || DEFAULT_AI_UPLOADS_DIR;
}

function isSafePathSegment(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (!value || value.length > 180) return false;
  if (value === "." || value === "..") return false;
  return !(/[\\/\0]/u.test(value));
}

function sanitizeNameStem(fileName: string): string {
  const stemRaw = basename(fileName, extname(fileName || ""));
  const stem = stemRaw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);
  return stem || "file";
}

function pickFileExtension(fileName: string, mimeType: string): string {
  const fromName = extname(fileName || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  if (fromName && fromName.length <= 12) return fromName;
  return MIME_EXTENSION_MAP[mimeType] || "";
}

function buildStoredFileName(fileName: string, mimeType: string): string {
  const safeStem = sanitizeNameStem(fileName);
  const ext = pickFileExtension(fileName, mimeType);
  return `${Date.now()}-${randomUUID()}-${safeStem}${ext}`;
}

function assertPathInsideRoot(rootDir: string, candidatePath: string): void {
  const root = resolve(rootDir);
  const target = resolve(candidatePath);
  if (target === root) return;
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error("UnsafePath");
  }
}

function contentTypeByFileName(fileName: string, fallbackMimeType = ""): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  const normalized = normalizeMimeType(fallbackMimeType);
  if (normalized) return normalized;
  return "application/octet-stream";
}

function detectTextExtractKind(file: AiStoredUploadFile): AiUploadTextExtractKind | null {
  const mimeType = normalizeMimeType(file.type);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "text/plain") return "txt";

  const ext = extname(file.name || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".gif" || ext === ".webp") return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".txt") return "txt";
  return null;
}

function resolveStoredUploadAbsPath(storagePath: string): string | null {
  const rawPath = String(storagePath || "").trim().replace(/^[/\\]+/u, "");
  if (!rawPath || rawPath.includes("\0")) return null;
  const rootDir = getUploadsRootDir();
  const absPath = resolve(rootDir, rawPath);
  try {
    assertPathInsideRoot(rootDir, absPath);
    return absPath;
  } catch {
    return null;
  }
}

function normalizeExtractedText(raw: string): string {
  if (!raw) return "";
  const unix = raw.replace(/\r\n?/g, "\n");
  const withoutControl = unix.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  const compactLines = withoutControl
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return compactLines.trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParseModule = await import("pdf-parse");
  const parser = new pdfParseModule.PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return typeof result?.text === "string" ? result.text : "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return typeof result?.value === "string" ? result.value : "";
}

function runTesseract(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tesseract",
      args,
      {
        timeout: AI_UPLOAD_IMAGE_OCR_TIMEOUT_MS,
        maxBuffer: AI_UPLOAD_IMAGE_OCR_MAX_BUFFER,
      },
      (error, stdout = "", stderr = "") => {
        if (!error) {
          resolve(stdout || "");
          return;
        }
        const err = new Error(String(stderr || (error as Error).message || "tesseract_failed"));
        (err as Error & { cause?: unknown }).cause = error;
        reject(err);
      },
    );
  });
}

async function extractImageTextFromPath(absPath: string): Promise<string> {
  const baseArgs = [absPath, "stdout", "--psm", "6", "--oem", "1"];
  try {
    return await runTesseract([...baseArgs, "-l", IMAGE_TEXT_LANG_PRIMARY]);
  } catch (error) {
    const message = `${(error as Error)?.message || ""}`.toLowerCase();
    if (/failed loading language|error opening data file|language/.test(message)) {
      return runTesseract([...baseArgs, "-l", IMAGE_TEXT_LANG_FALLBACK]);
    }
    throw error;
  }
}

async function extractTextFromBuffer(kind: Exclude<AiUploadTextExtractKind, "image">, buffer: Buffer): Promise<string> {
  if (kind === "pdf") return extractPdfText(buffer);
  if (kind === "docx") return extractDocxText(buffer);
  if (kind === "txt") return buffer.toString("utf8");
  return "";
}

export function buildAiUploadFileUrl(params: { ownerId: string; requestId: string; fileName: string }): string {
  return `/api/ai/files/${encodeURIComponent(params.ownerId)}/${encodeURIComponent(params.requestId)}/${encodeURIComponent(params.fileName)}`;
}

export function validateAiUploadFiles(files: File[]): void {
  if (!Array.isArray(files) || files.length === 0) return;

  if (files.length > AI_UPLOAD_MAX_FILES) {
    throw new AiUploadValidationError("TooManyFiles", `Можно загрузить не более ${AI_UPLOAD_MAX_FILES} файлов`);
  }

  for (const file of files) {
    const displayName = basename(file?.name || "file");
    const mimeType = normalizeMimeType(file?.type);

    if (!file || typeof file !== "object") {
      throw new AiUploadValidationError("UnsupportedType", "Некорректный формат файла");
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new AiUploadValidationError("EmptyFile", `Файл «${displayName}» пустой`, displayName);
    }

    if (file.size > AI_UPLOAD_MAX_FILE_SIZE) {
      throw new AiUploadValidationError(
        "FileTooLarge",
        `Файл «${displayName}» превышает лимит 10 МБ`,
        displayName,
      );
    }

    if (!AI_UPLOAD_ALLOWED_TYPES.has(mimeType)) {
      throw new AiUploadValidationError(
        "UnsupportedType",
        `Формат файла «${displayName}» не поддерживается`,
        displayName,
      );
    }
  }
}

export async function storeAiUploadedFiles(params: {
  userId: string;
  requestId: string;
  files: File[];
}): Promise<AiStoredUploadFile[]> {
  const files = Array.isArray(params.files) ? params.files : [];
  if (files.length === 0) return [];
  validateAiUploadFiles(files);

  if (!isSafePathSegment(params.userId) || !isSafePathSegment(params.requestId)) {
    throw new Error("InvalidUploadPath");
  }

  const uploadsRootDir = getUploadsRootDir();
  const uploadDir = resolve(uploadsRootDir, params.userId, params.requestId);
  assertPathInsideRoot(uploadsRootDir, uploadDir);
  await mkdir(uploadDir, { recursive: true });

  const storedAbsPaths: string[] = [];
  const result: AiStoredUploadFile[] = [];
  try {
    for (const file of files) {
      const originalName = basename(file.name || "file");
      const mimeType = normalizeMimeType(file.type);
      const storedFileName = buildStoredFileName(originalName, mimeType);
      if (!SAFE_STORED_FILE_NAME_RE.test(storedFileName)) {
        throw new Error("UnsafeFileName");
      }

      const absPath = resolve(uploadDir, storedFileName);
      assertPathInsideRoot(uploadsRootDir, absPath);

      const content = Buffer.from(await file.arrayBuffer());
      await writeFile(absPath, content);
      storedAbsPaths.push(absPath);

      result.push({
        name: originalName,
        size: file.size,
        type: mimeType || contentTypeByFileName(storedFileName),
        storagePath: `${params.userId}/${params.requestId}/${storedFileName}`,
        url: buildAiUploadFileUrl({
          ownerId: params.userId,
          requestId: params.requestId,
          fileName: storedFileName,
        }),
      });
    }

    return result;
  } catch (error) {
    await Promise.allSettled(storedAbsPaths.map((absPath) => unlink(absPath)));
    throw error;
  }
}

export async function extractAiUploadedFilesText(params: {
  files: AiStoredUploadFile[];
  maxCharsPerFile?: number;
  maxTotalChars?: number;
}): Promise<AiUploadTextExtraction[]> {
  const files = Array.isArray(params.files) ? params.files : [];
  if (files.length === 0) return [];

  const maxCharsPerFile = Math.max(
    400,
    Math.min(20_000, Math.floor(params.maxCharsPerFile ?? AI_UPLOAD_TEXT_EXTRACT_DEFAULT_MAX_CHARS_PER_FILE)),
  );
  const maxTotalChars = Math.max(
    maxCharsPerFile,
    Math.min(80_000, Math.floor(params.maxTotalChars ?? AI_UPLOAD_TEXT_EXTRACT_DEFAULT_MAX_TOTAL_CHARS)),
  );

  let remainingChars = maxTotalChars;
  const extracted: AiUploadTextExtraction[] = [];

  for (const file of files) {
    const parser = detectTextExtractKind(file);
    const base: Omit<AiUploadTextExtraction, "status" | "text" | "truncated"> = {
      name: file.name,
      type: file.type,
      size: file.size,
      storagePath: file.storagePath,
      parser,
    };

    if (!parser) {
      extracted.push({ ...base, status: "unsupported", text: "", truncated: false });
      continue;
    }

    if (remainingChars <= 0) {
      extracted.push({ ...base, status: "limit", text: "", truncated: false });
      continue;
    }

    const absPath = resolveStoredUploadAbsPath(file.storagePath);
    if (!absPath) {
      extracted.push({ ...base, status: "error", text: "", truncated: false });
      continue;
    }

    let rawText = "";
    try {
      if (parser === "image") {
        rawText = await extractImageTextFromPath(absPath);
      } else {
        const content = await readFile(absPath);
        rawText = await extractTextFromBuffer(parser, content);
      }
    } catch {
      extracted.push({ ...base, status: "error", text: "", truncated: false });
      continue;
    }

    const normalized = normalizeExtractedText(rawText);
    if (!normalized) {
      extracted.push({ ...base, status: "empty", text: "", truncated: false });
      continue;
    }

    const limitForFile = Math.min(maxCharsPerFile, remainingChars);
    const truncated = normalized.length > limitForFile;
    const text = normalized.slice(0, limitForFile).trimEnd();
    if (!text) {
      extracted.push({ ...base, status: "limit", text: "", truncated: false });
      continue;
    }

    remainingChars = Math.max(0, remainingChars - text.length);
    extracted.push({ ...base, status: "ok", text, truncated });
  }

  return extracted;
}

export async function readAiUploadFile(params: {
  ownerId: string;
  requestId: string;
  fileName: string;
}): Promise<{ fileName: string; contentType: string; content: Buffer } | null> {
  let ownerId = "";
  let requestId = "";
  let fileName = "";
  try {
    ownerId = decodeURIComponent(params.ownerId || "").trim();
    requestId = decodeURIComponent(params.requestId || "").trim();
    fileName = decodeURIComponent(params.fileName || "").trim();
  } catch {
    return null;
  }
  if (!isSafePathSegment(ownerId) || !isSafePathSegment(requestId) || !SAFE_STORED_FILE_NAME_RE.test(fileName)) {
    return null;
  }

  const rootDir = getUploadsRootDir();
  const absPath = resolve(rootDir, ownerId, requestId, fileName);
  try {
    assertPathInsideRoot(rootDir, absPath);
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) return null;
    const content = await readFile(absPath);
    return {
      fileName,
      contentType: contentTypeByFileName(fileName),
      content,
    };
  } catch {
    return null;
  }
}
