import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const path = "manifest.json";
let text = readFileSync(path, "utf8");
text = text.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);
writeFileSync(path, text);
