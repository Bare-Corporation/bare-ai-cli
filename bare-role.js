#!/usr/bin/env node
/* eslint-env node */
/* global fetch, AbortSignal */
"use strict";
/* bare-role - fetch and activate a Bare-AI role constitution (session-only).
 * Usage:
 *   bare-role <alias>              fetch + activate (roles/<alias>.md + roles/current.md)
 *   bare-role <alias> --path       print file path only
 *   bare-role <alias> --export     print markdown to stdout
 *   bare-role --list               list Approved roles
 * Session-only: activation never changes a persistent default role.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "https://api.bare-ai.net";
const UA = "bare-ai-council-agent/" + (process.env.BARE_AI_CLI_VERSION || "1.0.0");
const ROOT = path.join(os.homedir(), ".bare-ai", "roles");

function ensureDir() { fs.mkdirSync(ROOT, { recursive: true }); }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) { throw new Error("role not found or not Approved (HTTP 404)"); }
  if (res.status === 429) { throw new Error("rate limited - try again later (HTTP 429)"); }
  if (!res.ok) { throw new Error("council api error (HTTP " + res.status + ")"); }
  return res.json();
}

function aliasOf(v) { return String(v || "").toLowerCase(); }

async function listRoles() {
  const d = await fetchJson(API + "/v1/council/bare-roles");
  const roles = (d && d.roles) || [];
  console.log("Bare-AI role library (" + roles.length + " Approved):");
  for (const r of roles) {
    console.log(String(r.alias || "") + "  | " + String(r.category || "") + "  | " + String(r.name || ""));
  }
}

async function fetchRole(alias) {
  return fetchJson(API + "/v1/council/bare-roles/" + encodeURIComponent(alias));
}

function saveRole(role) {
  ensureDir();
  const safe = aliasOf(role.alias).replace(/[^a-z0-9._-]/g, "-");
  const mdPath = path.join(ROOT, safe + ".md");
  const tmp = mdPath + ".tmp";
  fs.writeFileSync(tmp, role.constitution_markdown || "", "utf8");
  fs.renameSync(tmp, mdPath);
  const meta = {
    alias: role.alias, name: role.name, category: role.category,
    description: role.description, is_official: role.is_official,
    fetched_at_utc: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  const cur = path.join(ROOT, "current.md");
  const ctmp = cur + ".tmp";
  fs.writeFileSync(ctmp, role.constitution_markdown || "", "utf8");
  fs.renameSync(ctmp, cur);
  return mdPath;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set();
  const positional = [];
  for (const a of args) {
    if (a.startsWith("--")) { flags.add(a); } else { positional.push(a); }
  }
  const alias = positional[0];
  try {
    if (flags.has("--list") || !alias) {
      await listRoles();
      return;
    }
    const role = await fetchRole(alias);
    if (flags.has("--export")) {
      console.log(role.constitution_markdown || "");
      return;
    }
    const mdPath = saveRole(role);
    if (flags.has("--path")) {
      console.log(mdPath);
      return;
    }
    console.log("Role activated (session-only): " + String(role.name || alias));
    console.log("Saved: " + mdPath);
    console.log("Active session file: " + path.join(ROOT, "current.md"));
    console.log("Load it into this session's system prompt / role file to apply the constitution.");
  } catch (e) {
    console.error("bare-role: " + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  }
}

main();
