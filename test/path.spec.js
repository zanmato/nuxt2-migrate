import { describe, it } from "node:test";
import assert from "node:assert";
import { rewriteSFC } from "../src/index.js";

describe("Path rewriting", () => {
    it("should rewrite img paths", async () => {
        const input = `
<template>
  <img src="~/assets/logo.png" alt="Logo" />
</template>
<script>
export default {
  name: "MyComponent"
}
</script>`;

        const expected = `
<template>
  <img src="@/assets/logo.png" alt="Logo" />
</template>
<script setup></script>`;

        const res = await rewriteSFC(input);
        assert.equal(res.trim(), expected.trim());
    });
});