import { describe, it } from "node:test";
import assert from "node:assert";
import { rewriteSFC } from "../src/index.js";

describe("vuex", () => {
  it("should handle direct vuex usage", async () => {
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
        this.$store.state.cart.items = [];
      }
    }
    </script>`;

    const res = await rewriteSFC(sfc, {
      vuex: {
        user: {
          name: "user",
          importName: "useUserStore",
        },
        cart: {
          name: "cart",
          importName: "useCartStore",
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
import { useCartStore } from '@/stores/cart';

const userStore = useUserStore();
const cartStore = useCartStore();

const title = ref('Hello world');

onMounted(() => {
  userStore.updateUser({ name: 'New User' });
  userStore.fetchUser();
  cartStore.items = [];
});
</script>`;

    assert.equal(res.trim(), expected.trim());
  });

  it("should handle vuex usage", async () => {
    const sfc = `<template>
        <h1>{{ user.name }}{{ userID }}{{ $store.state.user.userID }}</h1>
        <span v-if="$store.state.user.userID === '123'" :title="$store.state.user.userID">User is 123</span>
      </template>
      <script>
      import { mapState, mapGetters, mapActions, mapMutations } from 'vuex';

      export default {
        computed: {
          ...mapGetters({
            user: 'user/getUser',
            hasGrants: 'cart/hasGrants',
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
          ...mapActions({ fetchUser: 'user/fetchUser', checkoutEvent: 'cart/checkoutEvent' }),
          ...mapMutations({ updateUser: 'user/updateUser' })
        },
        mounted() {
          this.fetchUser();
          this.checkoutEvent();

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
  <span v-if=\"userStore.userID === '123'\" :title=\"userStore.userID\">
    User is 123
  </span>
</template>
<script setup>
import { computed, onMounted } from 'vue';
import { useHttp } from '@/composables/useHttp';
import { useUserStore } from '@/stores/user';
import { useCartStore } from '@/stores/cart';

const http = useHttp();
const userStore = useUserStore();
const cartStore = useCartStore();

const user = computed(() => userStore.getUser());
const hasGrants = computed(() => cartStore.hasGrants);
const userID = computed(() => userStore.userID);

const someMethod = () => {
  if (userStore.userID === '123') {
    console.log('YES!');
  }
};

const postSomething = async () => {
  try {
    await http.post('https://api.example.com/data', {
      userID: userStore.userID,
    });
  } catch (error) {
    console.error('Error posting data:', error);
  }
};

onMounted(() => {
  userStore.fetchUser();
  cartStore.checkoutEvent();

  console.log('Crazy user', userStore.userID);
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

  it("should handle imports for direct vuex usage", async () => {
    const sfc = `<template><h1>Hello</h1></template>
    <script>
    export default {
      methods: {
        async fetchData() {
          try {
            const response = await this.$axios.get('https://api.example.com/data', {
              params: { userID: this.$store.state.user.userID }
            });
            console.log('Data fetched:', response.data);
          } catch (error) {
            console.error('Error fetching data:', error);
          }
        }
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
<template><h1>Hello</h1></template>
<script setup>
import { useHttp } from '@/composables/useHttp';
import { useUserStore } from '@/stores/user';

const http = useHttp();
const userStore = useUserStore();

const fetchData = async () => {
  try {
    const response = await http.get('https://api.example.com/data', {
      params: { userID: userStore.userID },
    });
    console.log('Data fetched:', response.data);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
};
</script>`;

    assert.equal(res.trim(), expected.trim());
  });
});
