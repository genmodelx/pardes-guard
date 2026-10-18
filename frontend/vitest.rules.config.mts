import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Security-rules tests. They need the Firestore emulator, so they are not part of `npm test`.
// Run them with `npm run test:rules` (Java 21 or newer must be installed).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests-rules/**/*.test.ts"], environment: "node", testTimeout: 20_000, hookTimeout: 30_000, fileParallelism: false },
});
