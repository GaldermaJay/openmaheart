import { randomBytes, webcrypto } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const password = process.env.DASHBOARD_PASSWORD || "";
const iterations = Number(process.env.DASHBOARD_KDF_ITERATIONS || 310000);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mode = process.argv[2];

if (password.length < 12) {
  throw new Error("DASHBOARD_PASSWORD must be set to a strong password with at least 12 characters.");
}

function base64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function bytesFromBase64(value) {
  return Buffer.from(value, "base64");
}

async function deriveKey(salt, usages) {
  const keyMaterial = await webcrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function encryptJson(value) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(salt, ["encrypt"]);
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(ciphertext),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptJson(path) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  const salt = bytesFromBase64(payload.salt);
  const iv = bytesFromBase64(payload.iv);
  const key = await deriveKey(salt, ["decrypt"]);
  const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytesFromBase64(payload.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

async function writeFileMap(targetDir, files) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const outputPath = join(targetDir, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  }
}

function shouldBundleFile(relativePath) {
  if (relativePath.startsWith(".git/")) return false;
  if (relativePath.startsWith(".github/")) return false;
  if (relativePath.startsWith("data/")) return false;
  if (relativePath.startsWith("dist/")) return false;
  if (relativePath.startsWith("node_modules/")) return false;
  if (relativePath === ".DS_Store") return false;
  if (relativePath === "CLOUD_DEPLOY.md") return false;
  return true;
}

async function readFileMap(sourceDir, relativeRoot = "") {
  const entries = await readdir(join(sourceDir, relativeRoot), { withFileTypes: true });
  const files = {};

  for (const entry of entries) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (!shouldBundleFile(relativePath)) continue;

    if (entry.isDirectory()) {
      Object.assign(files, await readFileMap(sourceDir, relativePath));
    } else if (entry.isFile()) {
      files[relativePath] = await readFile(join(sourceDir, relativePath), "utf8");
    }
  }

  return files;
}

async function encryptSource() {
  const sourceDir = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : join(rootDir, "work");
  const files = await readFileMap(sourceDir);
  const encrypted = await encryptJson({ files });
  await writeFile(join(rootDir, "source.enc"), `${JSON.stringify(encrypted)}\n`, "utf8");
  console.log(`encrypted source files: ${Object.keys(files).length}`);
}

async function decryptSource() {
  const bundle = await decryptJson(join(rootDir, "source.enc"));
  await writeFileMap(join(rootDir, "work"), bundle.files || {});
  console.log(`decrypted source files: ${Object.keys(bundle.files || {}).length}`);
}

async function decryptState() {
  const state = await decryptJson(join(rootDir, "state.enc"));
  const outputPath = join(rootDir, "work", "data", "market-pulse.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`decrypted state: ${state.updatedAt || "unknown"}`);
}

async function encryptState() {
  const state = JSON.parse(await readFile(join(rootDir, "work", "data", "market-pulse.json"), "utf8"));
  const encrypted = await encryptJson(state);
  await writeFile(join(rootDir, "state.enc"), `${JSON.stringify(encrypted)}\n`, "utf8");
  console.log(`encrypted state: ${state.updatedAt || "unknown"}`);
}

if (mode === "decrypt-source") {
  await decryptSource();
} else if (mode === "encrypt-source") {
  await encryptSource();
} else if (mode === "decrypt-state") {
  await decryptState();
} else if (mode === "encrypt-state") {
  await encryptState();
} else {
  throw new Error("Usage: node scripts/crypto-bundle.mjs <decrypt-source|encrypt-source [source-dir]|decrypt-state|encrypt-state>");
}
