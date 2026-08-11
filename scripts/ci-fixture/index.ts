import { hasProvider, loadLlamaCpp, registerProvider, text, userMessage } from "smoltalk";
import { TestProvider } from "smoltalk/testing";

registerProvider("test", TestProvider);

const result = await text({
  model: "any-model",
  provider: "test",
  metadata: { testResponse: "ci-fixture-ok" },
  messages: [userMessage("hi")],
});

if (!result.success) {
  console.error("call failed:", result.error);
  process.exit(1);
}
if (result.value.output !== "ci-fixture-ok") {
  console.error("unexpected output:", result.value.output);
  process.exit(1);
}
console.log("OK:", result.value.output);

// Optional-peer resolution check: the bare import("smoltalk-llama-cpp") that
// loadLlamaCpp() performs must resolve from inside the *installed* smoltalk
// package. This is the check that catches optional-peer / package-manager
// layout regressions that the stubbed unit tests cannot.
const llamaMod = await loadLlamaCpp();
if (typeof llamaMod.resolveModel !== "function") {
  console.error("loadLlamaCpp returned a module without resolveModel");
  process.exit(1);
}
if (!hasProvider("llama-cpp")) {
  console.error("llama-cpp was not registered by loadLlamaCpp");
  process.exit(1);
}
console.log("OK: bare loadLlamaCpp() resolved and registered llama-cpp");
