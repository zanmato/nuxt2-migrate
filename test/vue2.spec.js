import { describe, it } from "node:test";
import assert from "node:assert";
import { rewriteSFC } from "../src/index.js";

describe("Vue2", () => {
    it("should handle filters", async () => {
        const input = `
<template>
  <h1>{{ thumbURL }}</h1>
</template>
<script>
export default {
  data() {
    return {
      product: {
        images: [
          { type: 'thumb', url: 'thumb1.png' },
          { type: 'full', url: 'full1.png' }
        ]
      }
    };
  },
  computed: {
    thumbURL() {
      return this.$options.filters.imagesByType(
        this.product.images,
        'thumb'
      );
    }
  }
}
</script>`;

        const expected = `
<template>
  <h1>{{ thumbURL }}</h1>
</template>
<script setup>
import { ref, computed } from 'vue';
import { useFilters } from '@/composables/useFilters';

const { imagesByType } = useFilters();

const product = ref({
  images: [
    { type: 'thumb', url: 'thumb1.png' },
    { type: 'full', url: 'full1.png' },
  ],
});

const thumbURL = computed(() => {
  return imagesByType(product.value.images, 'thumb');
});
</script>`;

        const res = await rewriteSFC(input);
        assert.equal(res.trim(), expected.trim());
    });
});