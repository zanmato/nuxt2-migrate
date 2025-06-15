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

  it("should handle watchers", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
        <script>
        export default {
          data() {
            return {
              title: 'Hello world',
              count: 0
            };
          },
          watch: {
            count(newVal, oldVal) {
              console.log('Count changed from', oldVal, 'to', newVal);
              this.shout();
            },
            async userTrackingID(newID, oldID) {
              if (
                newID !== 'shiny'
              ) {
                return;
              }

              if (newID !== oldID && newID !== null) {
                await new Promise((resolve) => { resolve(123) });
              }
            },
          },
          methods: {
            shout() {
              console.log('Shouting:', this.title);
            }
          }
        }
        </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, watch } from 'vue';

const title = ref('Hello world');
const count = ref(0);

const shout = () => {
  console.log('Shouting:', title.value);
};

watch(count, (newVal, oldVal) => {
  console.log('Count changed from', oldVal, 'to', newVal);
  shout();
});

watch(userTrackingID, async (newID, oldID) => {
  if (newID !== 'shiny') {
    return;
  }

  if (newID !== oldID && newID !== null) {
    await new Promise((resolve) => {
      resolve(123);
    });
  }
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should keep script usage between import and export", async () => {
    const sfc = `<template>
<h1>Hello</h1>
</template>
<script>
import { Something } from './local.js';

const CookieName = '__consent';

const ConsentOption = Object.freeze({
  Necessary: 1,
  AdStorage: 1 << 1,
  AnalyticsStorage: 1 << 2,
  AdPersonalization: 1 << 3,
  AdUserData: 1 << 4,
});

export default {
  name: 'ConsentBanner',
};
</script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>Hello</h1>
</template>
<script setup>
import { Something } from './local.js';

const CookieName = '__consent';

const ConsentOption = Object.freeze({
  Necessary: 1,
  AdStorage: 1 << 1,
  AnalyticsStorage: 1 << 2,
  AdPersonalization: 1 << 3,
  AdUserData: 1 << 4,
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle alternative data declaration", async () => {
    const sfc = `<template>
<h1>{{ scrollAmount }}</h1>
</template>
<script>
export default {
  data: () => ({
    scrollAmount: 0,
    catRow: {
      scrollWidth: 0,
      clientWidth: 0,
    },
  })
};
</script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ scrollAmount }}</h1>
</template>
<script setup>
import { ref } from 'vue';

const scrollAmount = ref(0);
const catRow = ref({
  scrollWidth: 0,
  clientWidth: 0,
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle $set and $delete", async () => {
    const sfc = `<template>
<h1>Hej</h1>
</template>
<script>
export default {
  data() {
    return {
      filters: {}
    };
  },
  mounted() {
    const bob = 'color';

    this.$set(this.filters, 'normal', 'red');
    this.$set(this.filters, \`f[\${bob}]\`, ['blue', 'green'].join(', '));
    this.$delete(this.filters, 'normal');
    this.$delete(this.filters, \`f[\${bob}]\`);
  }
}
</script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>Hej</h1>
</template>
<script setup>
import { ref, onMounted } from 'vue';

const filters = ref({});

onMounted(() => {
  const bob = 'color';

  filters.value.normal = 'red';
  filters.value[\`f[\${bob}]\`] = ['blue', 'green'].join(', ');
  delete filters.value.normal;
  delete filters.value[\`f[\${bob}]\`];
});
</script>`;
    assert.equal(res.trim(), expected.trim());
  });
});
