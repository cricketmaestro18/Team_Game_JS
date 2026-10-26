import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [storePath = join(root, "data/team-game.json"), themesPath = join(root, "data/themes.json")] = process.argv.slice(2);
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.");
}

const documents = await Promise.all([
  { key: "team-game", path: storePath },
  { key: "themes", path: themesPath },
].map(async ({ key, path }) => ({ key, value: JSON.parse(await readFile(path, "utf8")) })));

for (const document of documents) {
  if (document.key === "team-game" && (!Array.isArray(document.value.users) || !Array.isArray(document.value.history))) {
    throw new Error(`The backup at ${storePath} does not look like a team-game store.`);
  }
}

const response = await fetch(`${supabaseUrl}/rest/v1/app_state?on_conflict=key`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(documents),
});

if (!response.ok) {
  throw new Error(`Supabase import failed (${response.status}): ${await response.text()}`);
}

console.log(`Imported ${documents[0].value.users.length} users and ${documents[0].value.history.length} history records, plus saved themes.`);
