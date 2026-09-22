#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [inputPath, privateKeyPath, outputPath] = process.argv.slice(2);
if (!inputPath || !privateKeyPath || !outputPath) throw new Error("Usage: sign-rule-bundle.mjs unsigned.json /offline/ordinary-private.pem signed.json");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const privateReal = fs.realpathSync(privateKeyPath);
if (privateReal === projectRoot || privateReal.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Private signing keys must stay outside the application repository.");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const body = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const keys = ["schemaVersion", "rulesetId", "bundleVersion", "issuedAt", "expiresAt", "keyId", "payload"];
if (Object.keys(body).some((key) => ![...keys, "payloadHash", "signature"].includes(key)) || keys.some((key) => !(key in body))) throw new Error("Rule-bundle schema mismatch.");
if (!Number.isSafeInteger(body.bundleVersion) || body.bundleVersion < 1) throw new Error("bundleVersion must be a positive integer.");
body.payloadHash = crypto.createHash("sha256").update(canonical(body.payload)).digest("hex");
delete body.signature;
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateReal));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Rule signer must be an Ed25519 private key.");
body.signature = crypto.sign(null, Buffer.from(canonical(body)), privateKey).toString("base64");
fs.writeFileSync(outputPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`Signed rule bundle written to ${outputPath}\n`);