import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const READMES = [
  "../../README.md",
  "../smoltalk/README.md",
  "../smoltalk-llama-cpp/README.md",
  "../smoltalk-webllm/README.md",
];

const SKIP_MARKER = "// example: skip-typecheck";
const BLOCK_RE = /```(?:ts|typescript)\n([\s\S]*?)```/g;

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, "tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let blockIndex = 0;
const sources = [];

function lineNumberFor(content, charIndex) {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

for (const readmePath of READMES) {
  const fullPath = path.resolve(here, readmePath);
  const content = readFileSync(fullPath, "utf8");
  BLOCK_RE.lastIndex = 0;
  let m;
  let i = 0;
  while ((m = BLOCK_RE.exec(content))) {
    const block = m[1];
    if (block.includes(SKIP_MARKER)) {
      i += 1;
      continue;
    }
    const fname = `block-${blockIndex}.ts`;
    writeFileSync(path.join(tmp, fname), block);
    sources.push({
      file: readmePath,
      index: i,
      line: lineNumberFor(content, m.index),
      path: fname,
    });
    blockIndex += 1;
    i += 1;
  }
}

if (sources.length === 0) {
  console.log("No TS code blocks found in READMEs.");
  process.exit(0);
}

console.log(`Typechecking ${sources.length} TS code block(s) from READMEs...`);

try {
  execSync("pnpm exec tsc --noEmit", { cwd: here, stdio: "inherit" });
  console.log("All README code blocks typecheck.");
} catch (err) {
  console.error("\nFailed README blocks:");
  for (const s of sources) {
    console.error(`  ${s.file}:${s.line} (block #${s.index}) -> ${s.path}`);
  }
  process.exit(1);
}
