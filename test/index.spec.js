import { describe, it } from "node:test";
import assert from "node:assert";
import { rewriteSFC } from "../src/index.js";

describe("Vue options to composition API rewriter", () => {
  it("should convert data to refs", async () => {
    const sfc = `<template><h1>{{ count }}</h1></template>
    <script>
    export default {
      data() {
        return {
          count: 0
        };
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ count }}</h1>
</template>
<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle i18n methods", async () => {
    const sfc = `<template>
    <h1>{{ $t('hello') }}</h1>
    <span>{{ $n(count, 'currency') }}</span>
    <span :title="$t('hello')">{{ $d(Date.now(), 'short') }}</span>
    </template>
    <script>
    export default {
      data() {
        return {
          count: 0
        };
      },
      methods: {
        greet() {
          return this.$t('hello');
        }
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ t('hello') }}</h1>
  <span>{{ n(count, 'currency') }}</span>
  <span :title="t('hello')">{{ d(Date.now(), 'short') }}</span>
</template>
<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t, n, d } = useI18n();
const count = ref(0);

const greet = () => {
  return t('hello');
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle nuxt $fetch", async () => {
    const sfc = `<template><h1 @click="clickHandler">{{ data }}</h1></template>
    <script>
    export default {
      async fetch() {
        const res = await this.$axios.get('https://api.example.com/data');

        this.data = res.data;
        this.rows = res.headers['x-total-count'];
      },
      data() {
        return {
          data: null,
          rows: 0
        };
      },
      methods: {
        clickHandler() {
          this.$fetch();
        }
      },
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1 @click="clickHandler">{{ data }}</h1>
</template>
<script setup>
import { ref } from 'vue';
import { useHttp } from '@/composables/useHttp';

const data = ref(null);
const rows = ref(0);
const http = useHttp();

const clickHandler = () => {
  fetch();
};
const fetch = async () => {
  const res = await http.get('https://api.example.com/data');

  data.value = res.data;
  rows.value = res.headers['x-total-count'];
};

fetch();
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle custom mixins", async () => {
    const sfc = `<template><h1>{{ title }}{{ priceRaw(100) }}</h1></template>
    <script>
    import priceMixin from '@/mixins/price';

    export default {
      mixins: [priceMixin],
      data() {
        return {
          title: 'Hello World'
        };
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      mixins: {
        price: {
          name: "usePrice",
          imports: [
            "currency",
            "maximumFractionDigits",
            "priceRaw",
            "priceDiscountRaw",
            "filterPrices",
            "lowestPrice",
            "fromPrice",
            "price",
            "discountPrice",
            "priceRound",
          ],
        },
      },
    });

    const expected = `
<template>
  <h1>{{ title }}{{ priceRaw(100) }}</h1>
</template>
<script setup>
import { ref } from 'vue';
import { usePrice } from '@/composables/usePrice';

const title = ref('Hello World');
const { priceRaw } = usePrice();
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle vuex usage", async () => {
    const sfc = `<template><h1>{{ user.name }}{{ userID }}{{ $store.state.user.userID }}</h1></template>
    <script>
    import { mapState, mapGetters, mapActions, mapMutations } from 'vuex';

    export default {
      computed: {
        ...mapGetters({
          user: 'user/getUser'
        }),
        ...mapState('user', {
          userID: 'userID'
        })
      },
      methods: {
        someMethod() {
          if (
            this.$store.state.user.userID === '123'
          ) {
            console.log('YES!');
          }
        },
        async postSomething() {
          try {
            await this.$axios.post('https://api.example.com/data', {
              userID: this.$store.state.user.userID
            });
          } catch (error) {
            console.error('Error posting data:', error);
          }
        },
        ...mapActions({ fetchUser: 'user/fetchUser' }),
        ...mapMutations({ updateUser: 'user/updateUser' })
      },
      mounted() {
        this.fetchUser();

        console.log('Crazy user', this.$store.state.user.userID);
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      vuex: {
        user: {
          name: "user",
          importName: "useUserStore",
        },
      },
    });

    const expected = `
<template>
  <h1>{{ user.name }}{{ userID }}{{ userStore.userID }}</h1>
</template>
<script setup>
import { computed, onMounted } from 'vue';
import { useHttp } from '@/composables/useHttp';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const user = computed(() => userStore.getUser());
const userID = computed(() => userStore.userID);
const http = useHttp();

const someMethod = () => {
  if (userID.value === '123') {
    console.log('YES!');
  }
};

const postSomething = async () => {
  try {
    await http.post('https://api.example.com/data', {
      userID: userID.value,
    });
  } catch (error) {
    console.error('Error posting data:', error);
  }
};

onMounted(() => {
  userStore.fetchUser();

  console.log('Crazy user', userID.value);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle import rewrites", async () => {
    const sfc = `
<template>
  <ClientOnly>
    <h1 v-b-toggle>{{ title }}</h1>
  </ClientOnly>
  <nuxt-link :to="{ name: 'index' }">link</nuxt-link>
  <b-button></b-button>
  <BButton></BButton>
  <BSidebar></BSidebar>
  <b-sidebar></b-sidebar>
</template>
<script>
import { BSidebar, BButton } from 'bootstrap-vue';

export default {
  components: {
    BSidebar,
    BButton
  },
  data() {
    return {
      title: 'Hello Bootstrap Vue'
    };
  }
}
</script>`;

    // Look for components and directives that need to be rewritten
    const res = await rewriteSFC(sfc, {
      importsRewrite: {
        "bootstrap-vue": {
          name: "bootstrap-vue-next",
          componentRewrite: {
            BSidebar: "BOffcanvas",
          },
          directives: {
            // If the v-b-toggle directive is used, it should be imported
            "v-b-toggle": "vBToggle",
          },
        },
      },
      additionalImports: {
        ClientOnly: {
          importPath: "import ClientOnly from '@/components/ClientOnly.vue';",
        },
        NuxtLink: {
          rewriteTo: "router-link",
        },
      },
    });

    const expected = `
<template>
  <ClientOnly>
    <h1 v-b-toggle>{{ title }}</h1>
  </ClientOnly>
  <router-link :to="{ name: 'index' }">link</router-link>
  <b-button></b-button>
  <BButton></BButton>
  <BOffcanvas></BOffcanvas>
  <b-offcanvas></b-offcanvas>
</template>
<script setup>
import { ref } from 'vue';
import { BOffcanvas, BButton, vBToggle } from 'bootstrap-vue-next';
import ClientOnly from '@/components/ClientOnly.vue';

const title = ref('Hello Bootstrap Vue');
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle props", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      props: {
        title: {
          type: String,
          required: true
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
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle get, set computed properties", async () => {
    const sfc = `<template><h1>{{ fullName }}</h1></template>
    <script>
    export default {
      data() {
        return {
          firstName: 'John',
          lastName: 'Doe'
        };
      },
      computed: {
        fullName: {
          get() {
            return \`\${this.firstName} \${this.lastName}\`;
          },
          set(v) {
            const names = v.split(' ');
            this.firstName = names[0];
            this.lastName = names[1];
          }
        }
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);
    const expected = `
<template>
  <h1>{{ fullName }}</h1>
</template>
<script setup>
import { ref, computed } from 'vue';

const firstName = ref('John');
const lastName = ref('Doe');
const fullName = computed({
  get() {
    return \`\${firstName.value} \${lastName.value}\`;
  },
  set(v) {
    const names = v.split(' ');
    firstName.value = names[0];
    lastName.value = names[1];
  },
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle head() method", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello World'
        };
      },
      head() {
        return {
          title: this.title
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
import { useHead } from '@unhead/vue';

const title = ref('Hello World');
useHead({
  title: title.value,
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle complex head() method", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello World'
        };
      },
      head() {
        const head = {
          title: this.title,
          meta: [
            { name: 'description', content: 'This is a description' },
            { property: 'og:title', content: this.title }
          ]
        };

        return head;
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
import { useHead } from '@unhead/vue';

const title = ref('Hello World');
useHead(() => {
  const head = {
    title: title.value,
    meta: [
      { name: 'description', content: 'This is a description' },
      { property: 'og:title', content: title.value },
    ],
  };

  return head;
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle custom imports", async () => {
    const sfc = `<template><nuxt-link :to="localePath('my-account')">{{ title }}</nuxt-link>
    <span>{{ $i18n.locale }}</span>
    </template>
    <script>
    export default {
      data() {
        return {
          title: this.$i18n.localeProperties.brand
        };
      },
      mounted() {
        console.log('Great locale, tremendous', this.$i18n.locale);
      }
    }
    </script>`;

    // TODO: how do we tell rewriteSFC to use the custom imports?
    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <router-link :to="localePath('my-account')">{{ title }}</router-link>
  <span>{{ locale }}</span>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useI18nUtils } from '@/composables/useI18nUtils';

const { locale } = useI18n();
const { localePath, localeProperties } = useI18nUtils();
const title = ref(localeProperties.brand);

onMounted(() => {
  console.log('Great locale, tremendous', locale.value);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle legacy asyncData method", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: ''
        };
      }
      async asyncData({ $axios, app, redirect, params }) {
        const data = await $axios.get('https://api.example.com/data');
        return { title: data.title };
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
  return { title: data.title };
});
const title = ref(data.title);
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

  it("should handle all lifecycle hooks", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
      <script>
      export default {
        data() {
          return {
            title: 'Hello world'
          };
        },
        created() {
          console.log('Created');
        },
        mounted() {
          console.log('Mounted');
        },
        beforeUpdate() {
          console.log('Before Update');
        },
        updated() {
          console.log('Updated');
        },
        beforeUnmount() {
          console.log('Before Unmount');
        },
        unmounted() {
          console.log('Unmounted');
        },
        activated() {
          console.log('Activated');
        },
        deactivated() {
          console.log('Deactivated');
        },
        beforeDestroy() {
          console.log('Before Destroy');
        }
      }
      </script>`;

    const res = await rewriteSFC(sfc);

    // Note: `onCreated` is not a standard Vue lifecycle hook, so it will be placed in the script setup section.
    // beforeDestroy is merged into onBeforeUnmount
    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import {
  ref,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
} from 'vue';

const title = ref('Hello world');

console.log('Created');

onMounted(() => {
  console.log('Mounted');
});

onBeforeUpdate(() => {
  console.log('Before Update');
});

onUpdated(() => {
  console.log('Updated');
});

onBeforeUnmount(() => {
  console.log('Before Unmount');
});

onUnmounted(() => {
  console.log('Unmounted');

  console.log('Before Destroy');
});

onActivated(() => {
  console.log('Activated');
});

onDeactivated(() => {
  console.log('Deactivated');
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle nuxt event bus", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        this.$nuxt.$on('custom-event', this.handleCustomEvent);
      },
      beforeDestroy() {
        this.$nuxt.$off('custom-event', this.handleCustomEvent);
      },
      methods: {
        handleCustomEvent(data) {
          console.log('Custom event received:', data);

          this.$nuxt.$emit('another-event', { message: 'Hello from custom event' });
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
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useEventBus } from '@/composables/useEventBus';

const title = ref('Hello world');
const eventBus = useEventBus();
function handleCustomEvent(data) {
  console.log('Custom event received:', data);

  eventBus.emit('another-event', { message: 'Hello from custom event' });
}

onMounted(() => {
  eventBus.on('custom-event', handleCustomEvent);
});

onBeforeUnmount(() => {
  eventBus.off('custom-event', handleCustomEvent);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should keep listed imports", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    import vSelect from 'vue-select';
    import MyComponent from '@/components/MyComponent.vue';
    import AnotherComponent from '~/components/AnotherComponent.vue';

    const BigAsyncComponent = () => import('@/components/BigAsyncComponent.vue');

    export default {
      components: {
        MyComponent,
        AnotherComponent,
        BigAsyncComponent
      },
      data() {
        return {
          title: 'Hello world'
        };
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      importKeeplist: [/^.\/components\//, /^vue-select$/],
    });

    // Note it should always rewrite ~ to @
    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref } from 'vue';
import vSelect from 'vue-select';
import MyComponent from '@/components/MyComponent.vue';
import AnotherComponent from '@/components/AnotherComponent.vue';
const BigAsyncComponent = () => import('@/components/BigAsyncComponent.vue');

const title = ref('Hello world');
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle $refs", async () => {
    const sfc = `<template>
    <a href="#">anchor</a><h1 ref="titleRef">{{ title }}</h1><div ref="cat-row"></div>
    </template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        if (this.$refs?.titleRef) {
          console.log(this.$refs.titleRef);
        }

        console.log('Alternative syntax', this.$refs['cat-row']);
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <a href="#">anchor</a>
  <h1 ref="titleRef">{{ title }}</h1>
  <div ref="cat-row"></div>
</template>
<script setup>
import { ref, onMounted, useTemplateRef } from 'vue';

const title = ref('Hello world');
const titleRef = useTemplateRef('titleRef');
const catRowRef = useTemplateRef('cat-row');

onMounted(() => {
  if (titleRef.value) {
    console.log(titleRef.value);
  }

  console.log('Alternative syntax', catRowRef.value);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle $config", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: this.$config[this.$i18n.locale].appName
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
import { useI18n } from 'vue-i18n';
import { useRuntimeConfig } from '@/composables/useRuntimeConfig';

const { locale } = useI18n();
const config = useRuntimeConfig();
const title = ref(config[locale.value].appName);
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle nextTick", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        this.$nextTick(() => {
          console.log('Next tick executed');
        });
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, onMounted, nextTick } from 'vue';

const title = ref('Hello world');

onMounted(() => {
  nextTick(() => {
    console.log('Next tick executed');
  });
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle $route and $router", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        console.log(this.$route.path);
        this.$router.push('/new-path');
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const title = ref('Hello world');
const route = useRoute();
const router = useRouter();

onMounted(() => {
  console.log(route.path);
  router.push('/new-path');
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle event listeners", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        window.addEventListener('resize', this.handleResize);
      },
      beforeDestroy() {
        window.removeEventListener('resize', this.handleResize);
      },
      methods: {
        handleResize() {
          console.log('Window resized');
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
import { ref, onMounted, onBeforeUnmount } from 'vue';

const title = ref('Hello world');

const handleResize = () => {
  console.log('Window resized');
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle async methods", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      methods: {
        async fetchData() {
          const res = await this.$axios.get('https://api.example.com/data');
          this.title = res.data.title;
        }
      },
      mounted() {
        this.fetchData();
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { useHttp } from '@/composables/useHttp';

const title = ref('Hello world');
const http = useHttp();

const fetchData = async () => {
  const res = await http.get('https://api.example.com/data');
  title.value = res.data.title;
};

onMounted(() => {
  fetchData();
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle alternative vuex map syntax", async () => {
    const sfc = `<template><h1>{{ user.name }}</h1></template>
    <script>
    import { mapState, mapGetters, mapActions, mapMutations } from 'vuex';

    export default {
      computed: {
        ...mapState('user', ['userID']),
        ...mapGetters('user', ['getUser'])
      },
      methods: {
        ...mapActions('user', ['fetchUser']),
        ...mapMutations('user', ['updateUser'])
      },
      mounted() {
        console.log(this.userID);
        this.fetchUser();
        this.updateUser();
        console.log('User updated');
        console.log('User ID:', this.userID);
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      vuex: {
        user: {
          name: "user",
          importName: "useUserStore",
        },
      },
    });

    const expected = `
<template>
  <h1>{{ user.name }}</h1>
</template>
<script setup>
import { computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const userID = computed(() => userStore.userID);
const user = computed(() => userStore.getUser());

onMounted(() => {
  console.log(userID.value);
  userStore.fetchUser();
  userStore.updateUser();
  console.log('User updated');
  console.log('User ID:', userID.value);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should add FIXME if the variable doesn't exist", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        console.log(this.nonExistentVariable);
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, onMounted } from 'vue';

const title = ref('Hello world');

onMounted(() => {
  // FIXME: undefined variable 'nonExistentVariable'
  // console.log(this.nonExistentVariable);
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle vuex commit and dispatch", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world'
        };
      },
      mounted() {
        this.$store.commit('user/updateUser', { name: 'New User' });
        this.$store.dispatch('user/fetchUser');
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      vuex: {
        user: {
          name: "user",
          importName: "useUserStore",
        },
      },
    });

    const expected = `
<template>
  <h1>{{ title }}</h1>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

const title = ref('Hello world');
const userStore = useUserStore();

onMounted(() => {
  userStore.updateUser({ name: 'New User' });
  userStore.fetchUser();
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle spread operator with this", async () => {
    const sfc = `<template><h1 @click="handleClick">{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world',
          messageSent: false,
          sending: false,
          errorSending: false,
          form: {
            name: '',
            email: ''
          }
        };
      },
      methods: {
        handleClick() {
          this.sending = true;
          this.$axios
            .post('/api/form', { ...this.form })
            .then(() => {
              this.messageSent = true;
            })
            .catch(() => {
              this.errorSending = true;
            })
            .finally(() => {
              this.sending = false;
            });
        }
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template>
  <h1 @click="handleClick">{{ title }}</h1>
</template>
<script setup>
import { ref } from 'vue';
import { useHttp } from '@/composables/useHttp';

const title = ref('Hello world');
const messageSent = ref(false);
const sending = ref(false);
const errorSending = ref(false);
const form = ref({
  name: '',
  email: '',
});
const http = useHttp();

const handleClick = () => {
  sending.value = true;
  http
    .post('/api/form', { ...form.value })
    .then(() => {
      messageSent.value = true;
    })
    .catch(() => {
      errorSending.value = true;
    })
    .finally(() => {
      sending.value = false;
    });
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle simple components", async () => {
    const sfc = `<template><h1>Dummy content</h1></template>
    <script>
    export default {
      name: 'DummyComponent',
    };
    </script>
    <style scoped>
    h1 {
      color: red;
    }
    </style>`;

    const res = await rewriteSFC(sfc);

    const expected = `<template><h1>Dummy content</h1></template>
<script setup></script>
<style scoped>
h1 {
  color: red;
}
</style>`;

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
        }
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
watch(count, (newVal, oldVal) => {
  console.log('Count changed from', oldVal, 'to', newVal);
  shout();
});

const shout = () => {
  console.log('Shouting:', title.value);
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle regex data", async () => {
    const sfc = `<template><h1>{{ title }}</h1></template>
    <script>
    export default {
      data() {
        return {
          title: 'Hello world',
          regex: /\\d+/g
        };
      },
      methods: {
        testRegex() {
          return this.regex.test('123');
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
import { ref } from 'vue';

const title = ref('Hello world');
const regex = ref(/\\d+/g);

const testRegex = () => {
  return regex.value.test('123');
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle this in methods", async () => {
    const sfc = `<template><h1>Hello</h1></template>
<script>
export default {
  props: {
    productSku: {
      type: String,
      default: () => null,
    },
    value: {
      type: Boolean,
      default: () => false,
    },
  },
  computed: {
    showModal: {
      get() {
        return this.value;
      },
      set(v) {
        this.$emit('input', v);
      }
    },
  },
  methods: {
    notify() {
      this.$axios
        .post('/api/product-bulk-order', {
          sku: this.productSku,
        });
    },
  },
};
</script>`;

    const res = await rewriteSFC(sfc);

    const expected = `
<template><h1>Hello</h1></template>
<script setup>
import { computed } from 'vue';
import { useHttp } from '@/composables/useHttp';

const props = defineProps({
  productSku: {
    type: String,
    default: () => null,
  },
  value: {
    type: Boolean,
    default: () => false,
  },
});
const emit = defineEmits(['update:value']);
const showModal = computed({
  get() {
    return props.value;
  },
  set(v) {
    emit('update:value', v);
  },
});
const http = useHttp();

const notify = () => {
  http.post('/api/product-bulk-order', {
    sku: props.productSku,
  });
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });
});
