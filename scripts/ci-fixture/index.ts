import { registerProvider, text, userMessage } from "smoltalk";
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
