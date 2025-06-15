# Vue 2 to Vue 3 Migration Tool

A CLI tool to automatically transform Vue 2 Single File Components (SFCs) to Vue 3 Composition API syntax. With a focus on nuxt2 migration.

## Features

- 🔄 **Complete Vue 2 → Vue 3 transformation**

  - Options API to Composition API conversion
  - Data properties to `ref()` declarations
  - Methods to arrow functions
  - Computed properties with getter/setter support
  - Lifecycle hooks transformation
  - Watchers migration
  - Props and emits handling

- 📦 **Library and Framework Migration**

  - Vuex to Pinia store transformations
  - Custom mixins to composables conversion
  - Import path rewriting (e.g., bootstrap-vue → bootstrap-vue-next)
  - Component name transformations
  - Directive transformations

- 🔧 **Vue 2 API Compatibility**

  - `$set` and `$delete` → Vue 3 reactive assignments
  - `$refs` → `useTemplateRef()` composable
  - `$router`/`$route` → Vue Router composables
  - `$i18n` → Vue I18n composables
  - `$axios` → custom HTTP composables
  - Template transformations for directives and components

- 📁 **Flexible Processing**
  - Single file or directory processing
  - Recursive directory scanning
  - In-place transformation or output to different location
  - Configuration file support

## Usage

### Command Line Interface

```bash
node cli.js <input-path> [options]
```

#### Options

For complete usage information, run:

```bash
node cli.js --help
```

This will display all available options and examples.

#### Quick Examples

```bash
# Transform a single Vue component
node cli.js components/MyComponent.vue

# Transform all Vue files in a directory with configuration
node cli.js src/components/ -c config.json

# Transform to a different output directory
node cli.js src/ -o dist/ -c migration-config.json
```

## Configuration File

The migration tool uses a JSON configuration file to customize transformations. Create a `config.json` file to define:

- **Import rewrites**: Transform import statements and component names
- **Vuex to Pinia**: Map Vuex modules to Pinia stores
- **Mixins to Composables**: Convert mixins to composition functions
- **Additional imports**: Handle auto-imported components

### Example Configuration

See `config.example.json` for a complete example configuration file.

### Configuration Schema

#### `importsRewrite`

Rewrite import statements and transform component/directive names:

```json
{
  "importsRewrite": {
    "bootstrap-vue": {
      "name": "bootstrap-vue-next",
      "componentRewrite": {
        "BSidebar": "BOffcanvas"
      },
      "directives": {
        "v-b-toggle": "vBToggle"
      }
    }
  }
}
```

#### `vuex`

Map Vuex modules to Pinia stores:

```json
{
  "vuex": {
    "user": {
      "name": "user",
      "importName": "useUserStore"
    },
    "cart": {
      "name": "cart",
      "importName": "useCartStore"
    }
  }
}
```

#### `mixins`

Convert mixins to composables:

```json
{
  "mixins": {
    "price": {
      "name": "usePrice",
      "imports": ["priceRaw", "priceRound", "currency"]
    }
  }
}
```

#### `additionalImports`

Handle additional component imports:

```json
{
  "additionalImports": {
    "ClientOnly": {
      "importPath": "import ClientOnly from '@/components/ClientOnly.vue';"
    },
    "NuxtLink": {
      "rewriteTo": "router-link"
    }
  }
}
```

## Transformation Examples

### Data Properties

```javascript
// Vue 2
export default {
  data() {
    return {
      count: 0,
      user: { name: "John" },
    };
  },
};

// Vue 3
import { ref } from "vue";

const count = ref(0);
const user = ref({ name: "John" });
```

### Methods and Computed

```javascript
// Vue 2
export default {
  computed: {
    fullName: {
      get() {
        return `${this.firstName} ${this.lastName}`;
      },
      set(value) {
        const parts = value.split(" ");
        this.firstName = parts[0];
        this.lastName = parts[1];
      },
    },
  },
  methods: {
    greet() {
      console.log(`Hello ${this.fullName}`);
    },
  },
};

// Vue 3
import { ref, computed } from "vue";

const firstName = ref("");
const lastName = ref("");

const fullName = computed({
  get() {
    return `${firstName.value} ${lastName.value}`;
  },
  set(value) {
    const parts = value.split(" ");
    firstName.value = parts[0];
    lastName.value = parts[1];
  },
});

const greet = () => {
  console.log(`Hello ${fullName.value}`);
};
```

### Vuex to Pinia

```javascript
// Vue 2 + Vuex
export default {
  computed: {
    ...mapGetters("user", ["isLoggedIn"]),
    ...mapState("cart", ["items"]),
  },
  methods: {
    ...mapActions("user", ["login"]),
    addItem() {
      this.$store.commit("cart/addItem", item);
    },
  },
};

// Vue 3 + Pinia
import { useUserStore } from "@/stores/user";
import { useCartStore } from "@/stores/cart";

const userStore = useUserStore();
const cartStore = useCartStore();

const isLoggedIn = computed(() => userStore.isLoggedIn);
const items = computed(() => cartStore.items);

const login = userStore.login;

const addItem = () => {
  cartStore.addItem(item);
};
```

## Supported Transformations

- ✅ Data properties → `ref()`
- ✅ Computed properties (get/set)
- ✅ Methods → Arrow functions
- ✅ Lifecycle hooks → Composition API hooks
- ✅ Watchers → `watch()`
- ✅ Props → `defineProps()`
- ✅ Emits → `defineEmits()`
- ✅ Vuex → Pinia stores
- ✅ Mixins → Composables
- ✅ `$refs` → `useTemplateRef()`
- ✅ `$router`/`$route` → Router composables
- ✅ `$i18n` → I18n composables
- ✅ `$set`/`$delete` → Native assignments
- ✅ Template transformations
- ✅ Import path rewriting
- ✅ Component name mapping

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request
