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

  it("should handle legacy asyncData method", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: '',
          links: []
        };
      }
      async asyncData({ $axios, app, redirect, params }) {
        const data = await $axios.get('https://api.example.com/data');

        const links = ['nightowl'];
        return {
          title: data.title,
          links
        };
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref } from 'vue';
import { useAsyncData } from '@/composables/useAsyncData';

const data = await useAsyncData(async ({ $axios, app, redirect, params }) => {
  const data = await $axios.get('https://api.example.com/data');

  const links = ['nightowl'];
  return {
    title: data.title,
    links,
  };
});

const title = ref(data.title);
const links = ref(data.links);
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle nuxtI18n paths", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      nuxtI18n: {
        paths: {
          no: '/produkt/:slug',
          sv: '/produkt/:slug',
          fi: '/tuote/:slug',
          da: '/produkt/:slug',
          nl: '/product/:slug',
        },
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref } from 'vue';

const title = ref('Hello world');
</script>
<script>
export const i18n = {
  no: '/produkt/:slug',
  sv: '/produkt/:slug',
  fi: '/tuote/:slug',
  da: '/produkt/:slug',
  nl: '/product/:slug',
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });
});
