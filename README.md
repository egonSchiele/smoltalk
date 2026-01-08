# Smoltalk

## Install

```bash 
pnpm install smoltalk
```

## Usage

```typescript
import { getClient } from "smoltalk";

const client = getClient({
  apiKey: process.env.GEMINI_API_KEY || "",
  logLevel: "debug",
  model: "gemini-2.0-flash-lite",
});

async function main() {
  const resp = await client.text("Hello, how are you?");
  console.log(resp);
}

main();
```