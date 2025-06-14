import { describe, it } from "node:test";
import assert from "node:assert";
import { rewriteSFC } from "../src/index.js";

describe("Nuxt magic", () => {
    it("should handle special $nuxt object", async () => {
        const input = `
<template>
  <h1>Hello</h1>
</template>
<script>
export default {
  name: "MyComponent",
  methods: {
    handleClick() {
      try {
        this.$nuxt.refresh();
      } catch (error) {
        this.$nuxt.context.redirect(this.localePath("home"));
      }
    }
  },
  mounted() {
    this.$nuxt.$emit("custom-event", { data: "test" });
  }
}
</script>`;

        const expected = `
<template>
  <h1>Hello</h1>
</template>
<script setup>
import { onMounted } from 'vue';
import { useI18nUtils } from '@/composables/useI18nUtils';
import { useEventBus } from '@/composables/useEventBus';
import { useNuxtCompat } from '@/composables/useNuxtCompat';

const { localePath } = useI18nUtils();
const eventBus = useEventBus();
const { refresh, redirect } = useNuxtCompat();

const handleClick = () => {
  try {
    refresh();
  } catch (error) {
    redirect(localePath('home'));
  }
};

onMounted(() => {
  eventBus.emit('custom-event', { data: 'test' });
});
</script>`;

        const res = await rewriteSFC(input);
        assert.equal(res.trim(), expected.trim());
    });
});