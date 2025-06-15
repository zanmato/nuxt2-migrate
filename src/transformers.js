import Parser from "tree-sitter";
import javascript from "tree-sitter-javascript";

function transformToCompositionAPI(
  dataProperties,
  regularMethods,
  fetchMethod,
  i18nMethods,
  hasAxios,
  hasFilters,
  mixinData,
  vuexData,
  importRewriteData,
  templateVariables,
  propsData,
  computedData,
  headMethod,
  asyncDataMethod,
  lifecycleMethods,
  watchData,
  emitsData,
  hasEventBus,
  hasNuxtCompat,
  refsData,
  hasConfig,
  hasNextTick,
  routerData,
  nuxtI18nData,
  hasDirectStoreUsage,
  options,
  topLevelCode = [],
) {
  // Note: nuxtI18nData is used for the separate script tag generation in the main function
  // Determine what Vue imports we need
  const vueImports = [];

  // Add ref if we have data properties
  if (Object.keys(dataProperties).length > 0) {
    vueImports.push("ref");
  }

  if (vuexData && vuexData.computedProps.length > 0) {
    if (!vueImports.includes("computed")) {
      vueImports.push("computed");
    }
  }

  if (vuexData && vuexData.lifecycleMethods.length > 0) {
    if (
      vuexData.lifecycleMethods.some((m) => m.name === "mounted") &&
      !vueImports.includes("onMounted")
    ) {
      vueImports.push("onMounted");
    }
  }

  // Add computed import if we have computed properties
  if (computedData && Object.keys(computedData).length > 0) {
    if (!vueImports.includes("computed")) {
      vueImports.push("computed");
    }
  }

  // Add useTemplateRef import if refs are used
  if (refsData && refsData.hasRefs) {
    if (!vueImports.includes("useTemplateRef")) {
      vueImports.push("useTemplateRef");
    }
  }

  // Add lifecycle hook imports based on what's used
  if (lifecycleMethods && Object.keys(lifecycleMethods).length > 0) {
    const lifecycleMapping = {
      mounted: "onMounted",
      beforeUpdate: "onBeforeUpdate",
      updated: "onUpdated",
      beforeUnmount: "onBeforeUnmount",
      unmounted: "onUnmounted",
      beforeDestroy: "onBeforeUnmount", // Vue 2 -> Vue 3 mapping
      destroyed: "onUnmounted", // Vue 2 -> Vue 3 mapping
      activated: "onActivated",
      deactivated: "onDeactivated",
      // Note: 'created' doesn't have a direct equivalent in Vue 3 - code goes directly in setup
    };

    Object.keys(lifecycleMethods).forEach((lifecycleName) => {
      const vueHookName = lifecycleMapping[lifecycleName];
      if (vueHookName && !vueImports.includes(vueHookName)) {
        vueImports.push(vueHookName);
      }
    });
  }

  // Add nextTick import if needed
  if (hasNextTick && !vueImports.includes("nextTick")) {
    vueImports.push("nextTick");
  }

  // Add watch import if needed
  if (
    watchData &&
    Object.keys(watchData).length > 0 &&
    !vueImports.includes("watch")
  ) {
    vueImports.push("watch");
  }

  let result = "";
  if (vueImports.length > 0) {
    result = `import { ${vueImports.join(", ")} } from 'vue';`;
  }

  // Add vue-i18n import if needed
  const standardI18nMethods = new Set(["t", "n", "d", "locale"]);
  const customI18nMethods = new Set([
    "localeProperties",
    "localePath",
    "localeRoute",
  ]);

  const hasStandardI18n = Array.from(i18nMethods).some((method) =>
    standardI18nMethods.has(method),
  );
  const hasCustomI18n = Array.from(i18nMethods).some((method) =>
    customI18nMethods.has(method),
  );

  if (hasStandardI18n) {
    result += "\nimport { useI18n } from 'vue-i18n';";
  }

  if (hasCustomI18n) {
    result += "\nimport { useI18nUtils } from '@/composables/useI18nUtils';";
  }

  // Add useFilters import if needed
  if (hasFilters) {
    result += "\nimport { useFilters } from '@/composables/useFilters';";
  }

  // Add useHead import if needed
  if (headMethod) {
    result += "\nimport { useHead } from '@unhead/vue';";
  }

  // Add useAsyncData import if needed
  if (asyncDataMethod) {
    result += "\nimport { useAsyncData } from '@/composables/useAsyncData';";
  }

  // Add useEventBus import if needed
  if (hasEventBus) {
    result += "\nimport { useEventBus } from '@/composables/useEventBus';";
  }

  // Add useNuxtCompat import if needed
  if (hasNuxtCompat) {
    result += "\nimport { useNuxtCompat } from '@/composables/useNuxtCompat';";
  }

  // Add useRuntimeConfig import if needed
  if (hasConfig) {
    result +=
      "\nimport { useRuntimeConfig } from '@/composables/useRuntimeConfig';";
  }

  // Add router imports if needed
  if (routerData && routerData.hasRouterUsage) {
    const routerImports = [];
    if (routerData.hasRoute) routerImports.push("useRoute");
    if (routerData.hasRouter) routerImports.push("useRouter");
    result += `\nimport { ${routerImports.join(", ")} } from 'vue-router';`;
  }

  // Add useHttp import if axios is used
  if (hasAxios) {
    result += "\nimport { useHttp } from '@/composables/useHttp';";
  }

  // Add Pinia store imports
  if (vuexData && vuexData.usedStores.size > 0) {
    vuexData.usedStores.forEach((namespace) => {
      const storeConfig = options?.vuex?.[namespace];
      if (storeConfig) {
        result += `\nimport { ${storeConfig.importName} } from '@/stores/${storeConfig.name}';`;
      }
    });
  }

  // Add mixin composable imports
  if (mixinData && mixinData.usedMixins.length > 0) {
    mixinData.usedMixins.forEach((mixin) => {
      const composablePath = mixin.path
        .replace("/mixins/", "/composables/")
        .replace(mixin.mixinName, mixin.config.name);
      result += `\nimport { ${mixin.config.name} } from '${composablePath}';`;
    });
  }

  // Add rewritten imports (excluding Vuex imports which are handled separately)
  if (importRewriteData && importRewriteData.existingImports) {
    Object.entries(importRewriteData.existingImports).forEach(
      ([oldPath, components]) => {
        // Skip Vuex imports if we have Vuex transformations
        if (oldPath === "vuex" && vuexData && vuexData.hasVuexImports) {
          return;
        }

        const rewriteRule = importRewriteData.rewriteRules[oldPath];
        if (rewriteRule) {
          const newPath = rewriteRule.name;
          const rewrittenComponents = components.map((component) => {
            return rewriteRule.componentRewrite &&
              rewriteRule.componentRewrite[component]
              ? rewriteRule.componentRewrite[component]
              : component;
          });

          // Check for directives that need to be imported
          const directiveImports = [];
          if (rewriteRule.directives) {
            Object.entries(rewriteRule.directives).forEach(
              ([directive, importName]) => {
                if (templateVariables.has(directive)) {
                  directiveImports.push(importName);
                }
              },
            );
          }

          const allImports = [...rewrittenComponents, ...directiveImports];
          result += `\nimport { ${allImports.join(", ")} } from '${newPath}';`;
        } else {
          // Keep original import if no rewrite rule
          result += `\nimport { ${components.join(", ")} } from '${oldPath}';`;
        }
      },
    );
  }

  // Add additional imports for auto-imported components
  if (importRewriteData && importRewriteData.additionalImports) {
    Object.entries(importRewriteData.additionalImports).forEach(
      ([componentName, config]) => {
        if (config.importPath) {
          // Check if component is used in template (both kebab-case and PascalCase)
          const kebabCase = componentName
            .replace(/([A-Z])/g, "-$1")
            .toLowerCase()
            .replace(/^-/, "");
          const lowerCase = componentName.toLowerCase();
          const isUsed =
            templateVariables.has(componentName) ||
            templateVariables.has(lowerCase) ||
            templateVariables.has(kebabCase);

          if (isUsed) {
            result += `\n${config.importPath}`;
          }
        }
      },
    );
  }

  // Add keeplist imports
  if (importRewriteData && importRewriteData.keeplistImports) {
    Object.values(importRewriteData.keeplistImports).forEach(
      (importStatement) => {
        result += `\n${importStatement}`;
      },
    );
  }

  // Add keeplist declarations
  if (importRewriteData && importRewriteData.keeplistDeclarations) {
    Object.values(importRewriteData.keeplistDeclarations).forEach(
      (declaration) => {
        result += `\n${declaration}`;
      },
    );
  }

  result += "\n";

  // === TOP-LEVEL CODE (constants, etc.) ===
  if (topLevelCode && topLevelCode.length > 0) {
    // Filter out import statements and keeplist declarations since they're handled separately
    const nonImportCode = topLevelCode.filter((code) => {
      const trimmedCode = code.trim();
      // Skip import statements
      if (trimmedCode.startsWith("import ")) return false;

      // Skip declarations that are already in keeplist
      if (importRewriteData && importRewriteData.keeplistDeclarations) {
        for (const declaration of Object.values(
          importRewriteData.keeplistDeclarations,
        )) {
          if (declaration.trim() === trimmedCode) return false;
        }
      }

      return true;
    });

    if (nonImportCode.length > 0) {
      result += `\n${nonImportCode.join("\n\n")}\n`;
    }
  }

  // === 2. USES (COMPOSABLES) ===
  // Add i18n destructuring
  if (hasStandardI18n) {
    const standardMethods = Array.from(i18nMethods).filter((method) =>
      standardI18nMethods.has(method),
    );
    if (standardMethods.length > 0) {
      result += `\nconst { ${standardMethods.join(", ")} } = useI18n();`;
    }
  }

  if (hasCustomI18n) {
    const customMethods = Array.from(i18nMethods).filter((method) =>
      customI18nMethods.has(method),
    );
    if (customMethods.length > 0) {
      result += `\nconst { ${customMethods.join(", ")} } = useI18nUtils();`;
    }
  }

  // Add filters destructuring
  if (hasFilters) {
    // Extract filter names from $options.filters usage
    const filterNames = new Set();

    // Look for patterns like this.$options.filters.filterName
    Object.values(regularMethods).forEach((method) => {
      const filterMatches = method.content.match(
        /this\.\$options\.filters\.(\w+)/g,
      );
      if (filterMatches) {
        filterMatches.forEach((match) => {
          const filterName = match.replace("this.$options.filters.", "");
          filterNames.add(filterName);
        });
      }
    });

    // Also check computed properties
    Object.values(computedData).forEach((computed) => {
      const content =
        computed.type === "function"
          ? computed.value
          : computed.value.get || computed.value.set || "";
      const filterMatches = content.match(/this\.\$options\.filters\.(\w+)/g);
      if (filterMatches) {
        filterMatches.forEach((match) => {
          const filterName = match.replace("this.$options.filters.", "");
          filterNames.add(filterName);
        });
      }
    });

    if (filterNames.size > 0) {
      result += `\nconst { ${Array.from(filterNames).join(", ")} } = useFilters();`;
    }
  }

  // Add mixin destructuring (detect usage in both template and JavaScript)
  if (mixinData && mixinData.usedMixins.length > 0) {
    mixinData.usedMixins.forEach((mixin) => {
      // Collect used imports from template
      const usedImportsFromTemplate = mixin.config.imports.filter((importName) =>
        templateVariables.has(importName),
      );

      // Collect used imports from JavaScript content (methods, computed, etc.)
      const usedImportsFromJS = new Set();
      
      // Scan regular methods for mixin usage
      Object.values(regularMethods).forEach((methodData) => {
        const methodContent = typeof methodData === "string" ? methodData : methodData.content;
        mixin.config.imports.forEach((importName) => {
          if (methodContent.includes(`this.${importName}(`)) {
            usedImportsFromJS.add(importName);
          }
        });
      });

      // Scan computed properties for mixin usage
      if (computedData) {
        Object.values(computedData).forEach((propData) => {
          if (propData.type === "getterSetter") {
            const getterContent = propData.value.get?.content || propData.value.get || "";
            const setterContent = propData.value.set?.content || propData.value.set || "";
            
            mixin.config.imports.forEach((importName) => {
              if (getterContent.includes(`this.${importName}(`) || 
                  setterContent.includes(`this.${importName}(`)) {
                usedImportsFromJS.add(importName);
              }
            });
          } else if (propData.type === "function") {
            const content = propData.value || "";
            mixin.config.imports.forEach((importName) => {
              if (content.includes(`this.${importName}(`)) {
                usedImportsFromJS.add(importName);
              }
            });
          }
        });
      }

      // Combine all used imports (from template and JavaScript)
      const allUsedImports = new Set([
        ...usedImportsFromTemplate,
        ...Array.from(usedImportsFromJS)
      ]);

      if (allUsedImports.size > 0) {
        const imports = Array.from(allUsedImports).join(", ");
        result += `\nconst { ${imports} } = ${mixin.config.name}();`;
      }
    });
  }

  // Add composables
  if (hasAxios) {
    result += `\nconst http = useHttp();`;
  }

  if (hasEventBus) {
    result += `\nconst eventBus = useEventBus();`;
  }

  // Add Nuxt compatibility composable
  if (hasNuxtCompat) {
    result += `\nconst { refresh, redirect } = useNuxtCompat();`;
  }

  // Add router composables
  if (routerData && routerData.hasRouterUsage) {
    if (routerData.hasRoute) {
      result += `\nconst route = useRoute();`;
    }
    if (routerData.hasRouter) {
      result += `\nconst router = useRouter();`;
    }
  }

  // Add config composable
  if (hasConfig) {
    result += `\nconst config = useRuntimeConfig();`;
  }

  // Add store instances
  if (vuexData && vuexData.usedStores.size > 0) {
    vuexData.usedStores.forEach((namespace) => {
      const storeConfig = options?.vuex?.[namespace];
      if (storeConfig) {
        const instanceName = getStoreInstanceName(storeConfig);
        result += `\nconst ${instanceName} = ${storeConfig.importName}();`;
      }
    });
  }

  result += "\n\n";

  // === 3. REACTIVE STATE, REFS AND EMITS ===
  // Add props definition
  if (propsData) {
    result += `\nconst props = defineProps(${propsData});\n`;
  }

  // Add emits definition
  if (emitsData && emitsData.length > 0) {
    const emitsArray = emitsData.map((emit) => `'${emit}'`).join(", ");
    result += `\nconst emit = defineEmits([${emitsArray}]);\n`;
  }

  // Add data properties as refs (excluding those returned by asyncData)
  const asyncDataProps = asyncDataMethod
    ? new Set(asyncDataMethod.returnProperties)
    : new Set();
  Object.entries(dataProperties).forEach(([key, value]) => {
    // Skip properties that are returned by asyncData
    if (!asyncDataProps.has(key)) {
      // Transform this.$i18n and this.$config references in data property values
      let transformedValue = value
        .replace(/this\.\$([tnd])\(/g, "$1(") // Replace this.$t( with t(
        .replace(/this\.\$i18n\.localeProperties/g, "localeProperties")
        .replace(/this\.\$i18n\.locale/g, "locale.value")
        .replace(/this\.\$config/g, "config");
      result += `\nconst ${key} = ref(${transformedValue});`;
    }
  });

  // Add template refs
  if (refsData && refsData.hasRefs) {
    const allRefs = new Set([...refsData.templateRefs, ...refsData.scriptRefs]);
    allRefs.forEach((refName) => {
      // Normalize ref name for valid JavaScript variable (convert to camelCase)
      const normalizedName = refName.replace(/-([a-z])/g, (match, letter) =>
        letter.toUpperCase(),
      );
      // Avoid double "Ref" suffix if the name already ends with "Ref"
      const varName = normalizedName.endsWith("Ref")
        ? normalizedName
        : `${normalizedName}Ref`;
      result += `\nconst ${varName} = useTemplateRef('${refName}');`;
    });
  }

  // === 4. COMPUTED PROPERTIES ===
  // Add computed properties from Vuex mappers
  if (vuexData && vuexData.computedProps.length > 0) {
    vuexData.computedProps.forEach((mapData) => {
      Object.entries(mapData.mappings).forEach(([localName, storePath]) => {
        // Extract namespace from the storePath if it contains a slash
        let namespace = mapData.namespace;
        let actualPath = storePath;

        if (typeof storePath === "string" && storePath.includes("/")) {
          const parts = storePath.split("/");
          namespace = parts[0];
          actualPath = parts[1];
        }

        const storeConfig = options?.vuex?.[namespace];
        if (storeConfig) {
          const instanceName = getStoreInstanceName(storeConfig);
          if (mapData.type === "mapState") {
            result += `\nconst ${localName} = computed(() => ${instanceName}.${actualPath});`;
          } else if (mapData.type === "mapGetters") {
            // Check if getter should be called as function based on original code usage
            const shouldCallAsFunction =
              mapData.functionUsage && mapData.functionUsage[localName];
            // console.log(`Processing getter ${localName}: shouldCallAsFunction = ${shouldCallAsFunction}, functionUsage:`, mapData.functionUsage);
            if (shouldCallAsFunction) {
              result += `\nconst ${localName} = computed(() => ${instanceName}.${actualPath}());`;
            } else {
              result += `\nconst ${localName} = computed(() => ${instanceName}.${actualPath});`;
            }
          }
        }
      });
    });
  }

  // Add computed properties
  if (computedData && Object.keys(computedData).length > 0) {
    result += `\n`;
    Object.entries(computedData).forEach(([key, propData]) => {
      if (propData.type === "getterSetter") {
        let getterContent = propData.value.get?.content || propData.value.get || "{}";
        let setterContent = propData.value.set?.content || propData.value.set || "{}";
        let setterParams = propData.value.set?.parameters || "(v)";

        // Transform this references in getter/setter using the same logic as methods
        // But preserve the braces since computed properties expect full function bodies
        getterContent = transformComputedFunction(
          getterContent,
          hasAxios,
          hasEventBus,
          hasNuxtCompat,
          refsData,
          hasConfig,
          hasFilters,
          hasNextTick,
          routerData,
          options,
          regularMethods,
          dataProperties,
          computedData,
          propsData,
          vuexData,
          mixinData,
        );
        setterContent = transformComputedFunction(
          setterContent,
          hasAxios,
          hasEventBus,
          hasNuxtCompat,
          refsData,
          hasConfig,
          hasFilters,
          hasNextTick,
          routerData,
          options,
          regularMethods,
          dataProperties,
          computedData,
          propsData,
          vuexData,
          mixinData,
        );

        result += `\nconst ${key} = computed({\n  get() ${getterContent},\n  set${setterParams} ${setterContent}\n});\n`;
      } else if (propData.type === "function") {
        // Handle simple computed properties (not implemented in current test)
        let computedContent = propData.value;
        computedContent = transformComputedFunction(
          computedContent,
          hasAxios,
          hasEventBus,
          hasNuxtCompat,
          refsData,
          hasConfig,
          hasFilters,
          hasNextTick,
          routerData,
          options,
          regularMethods,
          dataProperties,
          computedData,
          propsData,
          vuexData,
          mixinData,
        );
        result += `\nconst ${key} = computed(() => ${computedContent});`;
      }
    });
  }

  // === 5. METHODS (INCLUDING FETCH AND ASYNCDATA) ===
  // Add asyncData transformation
  if (asyncDataMethod) {
    // Transform asyncData to useAsyncData call
    let asyncContent = asyncDataMethod.content;
    // Remove the opening and closing braces
    asyncContent = asyncContent.replace(/^\s*{\s*/, "").replace(/\s*}\s*$/, "");

    result += `\n\nconst data = await useAsyncData(async ${asyncDataMethod.parameters} => {\n${asyncContent}\n});\n`;

    // Create refs for each property returned by asyncData
    asyncDataMethod.returnProperties.forEach((prop) => {
      result += `\nconst ${prop} = ref(data.${prop});`;
    });
  }

  // Add head method transformation
  if (headMethod) {
    if (headMethod.type === "simple") {
      // Simple case: useHead({ ... })
      let headContent = headMethod.content;
      headContent = transformThisReferencesToRefs(headContent);
      result += `\n\nuseHead(${headContent});`;
    } else {
      // Complex case: useHead(() => { ... })
      let headContent = headMethod.content;
      headContent = transformThisReferencesToRefs(headContent);
      // Remove the opening and closing braces
      headContent = headContent.replace(/^\s*{\s*/, "").replace(/\s*}\s*$/, "");
      result += `\n\nuseHead(() => {\n${headContent}\n});`;
    }
  }

  // Add regular methods as arrow functions
  Object.entries(regularMethods).forEach(([methodName, methodData]) => {
    const methodBody =
      typeof methodData === "string" ? methodData : methodData.content;
    const isAsync = typeof methodData === "object" ? methodData.isAsync : false;
    const parameters =
      typeof methodData === "object" ? methodData.parameters : "()";

    let transformedBody = transformMethodBody(
      methodBody,
      hasAxios,
      hasEventBus,
      hasNuxtCompat,
      refsData,
      hasConfig,
      hasFilters,
      hasNextTick,
      routerData,
      options,
      regularMethods,
      dataProperties,
      computedData,
      propsData,
      vuexData,
      mixinData,
    );

    // Apply comprehensive store usage transformations for regular methods
    if (options?.vuex) {
      transformedBody = transformStoreUsageWithTreeSitter(
        transformedBody,
        options,
      );
    }

    const asyncKeyword = isAsync ? "async " : "";

    result += `\n\nconst ${methodName} = ${asyncKeyword}${parameters} => {\n${transformedBody}\n};`;
  });

  // Add fetch method as arrow function if it exists
  if (fetchMethod) {
    let transformedFetchBody = transformMethodBody(
      fetchMethod,
      hasAxios,
      hasEventBus,
      hasNuxtCompat,
      refsData,
      hasConfig,
      hasFilters,
      hasNextTick,
      routerData,
      options,
      regularMethods,
      dataProperties,
      computedData,
      propsData,
      vuexData,
      mixinData,
    );
    result += `\n\nconst fetch = async () => {\n${transformedFetchBody}\n};\n\n`;
  }

  // === 6. WATCHERS ===
  if (watchData && Object.keys(watchData).length > 0) {
    Object.entries(watchData).forEach(([watchName, watchConfig]) => {
      if (watchConfig.type === "function") {
        // Extract parameters and body from function
        let functionContent = watchConfig.content;

        // Check if the original function was async
        const isAsync = /^\s*async\s+/.test(functionContent);

        const paramsMatch = functionContent.match(/\(([^)]*)\)/);
        const params = paramsMatch ? paramsMatch[1] : "newVal, oldVal";

        // Extract function body
        const bodyMatch = functionContent.match(/(\{[\s\S]*\})$/);
        let body = bodyMatch ? bodyMatch[1].trim() : "";

        // Transform this references in watcher body
        body = transformMethodBody(
          body,
          hasAxios,
          hasEventBus,
          hasNuxtCompat,
          refsData,
          hasConfig,
          hasFilters,
          hasNextTick,
          routerData,
          options,
          regularMethods,
          dataProperties,
          computedData,
          propsData,
          vuexData,
          mixinData,
        );

        const asyncKeyword = isAsync ? "async " : "";
        result += `\n\nwatch(${watchName}, ${asyncKeyword}(${params}) => {\n  ${body}\n});`;
      }
    });
  }

  // === 7. LIFECYCLE HOOKS ===
  if (lifecycleMethods && Object.keys(lifecycleMethods).length > 0) {
    const lifecycleMapping = {
      mounted: "onMounted",
      beforeUpdate: "onBeforeUpdate",
      updated: "onUpdated",
      beforeUnmount: "onBeforeUnmount",
      unmounted: "onUnmounted",
      beforeDestroy: "onBeforeUnmount", // Vue 2 -> Vue 3 mapping
      destroyed: "onUnmounted", // Vue 2 -> Vue 3 mapping
      activated: "onActivated",
      deactivated: "onDeactivated",
    };

    // Handle created() method - its content goes directly in setup without wrapper
    if (lifecycleMethods.created) {
      let transformedContent = lifecycleMethods.created;

      if (options?.vuex) {
        transformedContent = transformStoreUsageInMethods(
          transformedContent,
          vuexData,
          options,
        );
      }

      transformedContent = transformMethodBody(
        transformedContent,
        hasAxios,
        hasEventBus,
        hasNuxtCompat,
        refsData,
        hasConfig,
        hasFilters,
        hasNextTick,
        routerData,
        options,
        regularMethods,
        dataProperties,
        computedData,
        propsData,
        vuexData,
        mixinData,
      );
      result += `\n\n${transformedContent}`;
    }

    // Handle other lifecycle methods
    Object.entries(lifecycleMethods).forEach(
      ([lifecycleName, methodContent]) => {
        if (lifecycleName === "created") return; // Already handled above

        const vueHookName = lifecycleMapping[lifecycleName];
        if (vueHookName) {
          let transformedContent = methodContent;

          if (options?.vuex) {
            transformedContent = transformStoreUsageInMethods(
              transformedContent,
              vuexData,
              options,
            );
          }

          transformedContent = transformMethodBody(
            transformedContent,
            hasAxios,
            hasEventBus,
            hasNuxtCompat,
            refsData,
            hasConfig,
            hasFilters,
            hasNextTick,
            routerData,
            options,
            regularMethods,
            dataProperties,
            computedData,
            propsData,
            vuexData,
            mixinData,
          );

          // Special case for beforeDestroy -> merge with beforeUnmount
          if (lifecycleName === "beforeDestroy") {
            // Check if we already have onBeforeUnmount, if so merge content
            if (lifecycleMethods.beforeUnmount) {
              // Content will be merged when we process beforeUnmount
              return;
            } else {
              const isAsync = transformedContent.includes("await");
              result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n});`;
            }
          } else if (
            lifecycleName === "beforeUnmount" &&
            lifecycleMethods.beforeDestroy
          ) {
            // Merge beforeDestroy content with beforeUnmount
            let beforeDestroyContent = transformMethodBody(
              lifecycleMethods.beforeDestroy,
              hasAxios,
              hasEventBus,
              hasNuxtCompat,
              refsData,
              hasConfig,
              hasNextTick,
              routerData,
              options,
              regularMethods,
              dataProperties,
              computedData,
              propsData,
              vuexData,
              mixinData,
            );
            if (options?.vuex) {
              beforeDestroyContent = transformStoreUsageInMethods(
                beforeDestroyContent,
                vuexData,
                options,
              );
            }
            const isAsync = transformedContent.includes("await");
            result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n});`;
          } else if (lifecycleName === "destroyed") {
            // Check if we already have unmounted, if so merge content
            if (lifecycleMethods.unmounted) {
              // Content will be merged when we process unmounted
              return;
            } else {
              const isAsync = transformedContent.includes("await");
              result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n});`;
            }
          } else if (lifecycleName === "unmounted") {
            // Check if we have beforeDestroy to merge
            if (lifecycleMethods.beforeDestroy) {
              let beforeDestroyContent = transformMethodBody(
                lifecycleMethods.beforeDestroy,
                hasAxios,
                hasEventBus,
                hasNuxtCompat,
                refsData,
                hasConfig,
                hasNextTick,
                routerData,
                options,
                regularMethods,
                dataProperties,
                computedData,
                propsData,
                vuexData,
                mixinData,
              );
              if (options?.vuex) {
                beforeDestroyContent = transformStoreUsageInMethods(
                  beforeDestroyContent,
                  vuexData,
                  options,
                );
              }

              const isAsync = transformedContent.includes("await");
              result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n\n${beforeDestroyContent}\n});`;
            } else {
              const isAsync = transformedContent.includes("await");
              result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n});`;
            }
          } else {
            const isAsync = transformedContent.includes("await");
            result += `\n\n${vueHookName}(${isAsync ? "async " : ""}() => {\n${transformedContent}\n});`;
          }
        }
      },
    );
  }

  // === 8. FETCH EXECUTIONS ===
  if (fetchMethod) {
    result += `\n\nfetch();`;
  }

  return result;
}

function transformComputedFunction(
  functionContent,
  hasAxios,
  hasEventBus = false,
  hasNuxtCompat = false,
  refsData = null,
  hasConfig = false,
  hasFilters = false,
  hasNextTick = false,
  routerData = null,
  options = null,
  availableMethods = {},
  dataProperties = {},
  computedData = {},
  propsData = null,
  vuexData = null,
  mixinData = null,
) {
  // For computed functions, we need to preserve the braces but transform the content inside
  if (!functionContent || functionContent === "{}") {
    return "{}";
  }

  // Use transformMethodBody but don't strip braces since computed needs them
  let transformedContent = transformMethodBody(
    functionContent,
    hasAxios,
    hasEventBus,
    hasNuxtCompat,
    refsData,
    hasConfig,
    hasFilters,
    hasNextTick,
    routerData,
    options,
    availableMethods,
    dataProperties,
    computedData,
    propsData,
    vuexData,
    mixinData,
  );

  // transformMethodBody strips braces, so we need to add them back for computed functions
  if (!transformedContent.startsWith("{")) {
    transformedContent = `{ ${transformedContent} }`;
  }

  return transformedContent;
}

function isPropProperty(propName, propsData) {
  if (!propsData) {
    return false;
  }

  try {
    // Parse props data (could be array or object format)
    if (typeof propsData === "string") {
      const propsObj = eval(`(${propsData})`);
      if (propsObj) {
        if (Array.isArray(propsObj)) {
          // Array format: ['prop1', 'prop2']
          return propsObj.includes(propName);
        } else if (typeof propsObj === "object") {
          // Object format: { prop1: { type: String }, prop2: Number }
          return propsObj.hasOwnProperty(propName);
        }
      }
    }
  } catch (error) {
    // If parsing fails, assume it's not a prop
    return false;
  }

  return false;
}

function transformStoreUsageInTemplate(content, vuexConfig) {
  // Transform $store.state.namespace.property to storeInstanceName.property
  Object.entries(vuexConfig).forEach(([namespace, config]) => {
    const storeInstanceName = getStoreInstanceName(config);
    const regex = new RegExp(`\\$store\\.state\\.${namespace}\\.(\\w+)`, "g");
    content = content.replace(regex, `${storeInstanceName}.$1`);
  });

  return content;
}

function transformComponentUsageInTemplate(content, options) {
  let transformedContent = content;

  // Handle additional imports component rewrites (like nuxt-link to router-link)
  if (options.additionalImports) {
    Object.entries(options.additionalImports).forEach(
      ([componentName, config]) => {
        if (config.rewriteTo) {
          // Convert PascalCase to kebab-case for template matching
          const kebabCase = componentName
            .replace(/([A-Z])/g, "-$1")
            .toLowerCase()
            .replace(/^-/, "");

          // Replace both kebab-case and PascalCase versions
          const kebabRegex = new RegExp(`<${kebabCase}(\\s|>)`, "g");
          const pascalRegex = new RegExp(`<${componentName}(\\s|>)`, "g");
          const kebabCloseRegex = new RegExp(`</${kebabCase}>`, "g");
          const pascalCloseRegex = new RegExp(`</${componentName}>`, "g");

          const targetKebab = config.rewriteTo
            .replace(/([A-Z])/g, "-$1")
            .toLowerCase()
            .replace(/^-/, "");

          transformedContent = transformedContent
            .replace(kebabRegex, `<${targetKebab}$1`)
            .replace(pascalRegex, `<${config.rewriteTo}$1`)
            .replace(kebabCloseRegex, `</${targetKebab}>`)
            .replace(pascalCloseRegex, `</${config.rewriteTo}>`);
        }
      },
    );
  }

  // Handle import rewrites component transformations
  if (options.importsRewrite) {
    Object.entries(options.importsRewrite).forEach(
      ([importPath, rewriteConfig]) => {
        if (rewriteConfig.componentRewrite) {
          Object.entries(rewriteConfig.componentRewrite).forEach(
            ([oldComponent, newComponent]) => {
              // Convert to kebab-case
              const oldKebab = oldComponent
                .replace(/([A-Z])/g, "-$1")
                .toLowerCase()
                .replace(/^-/, "");
              const newKebab = newComponent
                .replace(/([A-Z])/g, "-$1")
                .toLowerCase()
                .replace(/^-/, "");

              // Replace both PascalCase and kebab-case versions
              const oldPascalRegex = new RegExp(`<${oldComponent}(\\s|>)`, "g");
              const oldKebabRegex = new RegExp(`<${oldKebab}(\\s|>)`, "g");
              const oldPascalCloseRegex = new RegExp(`</${oldComponent}>`, "g");
              const oldKebabCloseRegex = new RegExp(`</${oldKebab}>`, "g");

              transformedContent = transformedContent
                .replace(oldPascalRegex, `<${newComponent}$1`)
                .replace(oldKebabRegex, `<${newKebab}$1`)
                .replace(oldPascalCloseRegex, `</${newComponent}>`)
                .replace(oldKebabCloseRegex, `</${newKebab}>`);
            },
          );
        }
      },
    );
  }

  return transformedContent;
}

function transformMethodBody(
  methodBody,
  hasAxios,
  hasEventBus = false,
  hasNuxtCompat = false,
  refsData = null,
  hasConfig = false,
  hasFilters = false,
  hasNextTick = false,
  routerData = null,
  options = null,
  availableMethods = {},
  dataProperties = {},
  computedData = {},
  propsData = null,
  vuexData = null,
  mixinData = null,
) {
  let transformedBody = methodBody
    .replace(/this\.\$([tnd])\(/g, "$1(") // Replace this.$t( with t(
    .replace(/this\.\$i18n\.localeProperties/g, "localeProperties") // Replace this.$i18n.localeProperties with localeProperties
    .replace(/this\.\$i18n\.locale/g, "locale.value") // Replace this.$i18n.locale with locale.value
    .replace(/^\s*{\s*/, "") // Remove opening brace and whitespace
    .replace(/\s*}\s*$/, ""); // Remove closing brace and whitespace

  // Transform filters usage
  if (hasFilters) {
    transformedBody = transformedBody.replace(
      /this\.\$options\.filters\.(\w+)/g,
      "$1",
    );
  }

  // Transform this.$emit calls to emit calls and convert 'input' to 'update:value'
  transformedBody = transformedBody.replace(
    /this\.\$emit\(\s*['"]([^'"]+)['"]\s*(,.*?)?\)/g,
    (match, eventName, args) => {
      // Transform 'input' events to 'update:value' for v-model compatibility
      const transformedEventName =
        eventName === "input" ? "update:value" : eventName;
      return `emit('${transformedEventName}'${args || ""})`;
    },
  );

  // Transform Vue 2 $set and $delete to Vue 3 syntax
  // this.$set(object, key, value) -> object[key] = value or object.key = value
  transformedBody = transformedBody.replace(
    /this\.\$set\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g,
    (match, object, key, value) => {
      // Check if key is a simple quoted string that can be converted to dot notation
      const trimmedKey = key.trim();
      // Match quoted strings that contain only valid identifier characters
      const simpleQuotedString = trimmedKey.match(/^['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]$/);
      
      if (simpleQuotedString) {
        // Simple quoted string - use dot notation
        return `${object}.${simpleQuotedString[1]} = ${value}`;
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmedKey)) {
        // Unquoted simple identifier - use dot notation
        return `${object}.${trimmedKey} = ${value}`;
      } else {
        // Complex key (template literal, expression, complex string) - use bracket notation
        return `${object}[${key}] = ${value}`;
      }
    },
  );

  // this.$delete(object, key) -> delete object[key] or delete object.key
  transformedBody = transformedBody.replace(
    /this\.\$delete\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g,
    (match, object, key) => {
      // Check if key is a simple quoted string that can be converted to dot notation
      const trimmedKey = key.trim();
      // Match quoted strings that contain only valid identifier characters
      const simpleQuotedString = trimmedKey.match(/^['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]$/);
      
      if (simpleQuotedString) {
        // Simple quoted string - use dot notation
        return `delete ${object}.${simpleQuotedString[1]}`;
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmedKey)) {
        // Unquoted simple identifier - use dot notation
        return `delete ${object}.${trimmedKey}`;
      } else {
        // Complex key (template literal, expression, complex string) - use bracket notation
        return `delete ${object}[${key}]`;
      }
    },
  );

  // First, comment out entire lines that contain undefined variables (do this early)
  const lines = transformedBody.split("\n");
  const processedLines = lines.map((line) => {
    const trimmedLine = line.trim();
    // Check if line contains this.someProperty
    const thisPropertyMatch = trimmedLine.match(/this\.(\w+)[\s;\)]/);
    if (thisPropertyMatch) {
      const propName = thisPropertyMatch[1];
      // Don't check method names or known properties
      if (
        availableMethods &&
        (availableMethods[propName] ||
          typeof availableMethods[propName] === "object")
      ) {
        return line;
      }

      // Check if variable is defined in component scope
      const isDefinedVariable = isVariableDefined(
        propName,
        dataProperties,
        computedData,
        propsData,
        availableMethods,
        vuexData,
        mixinData,
      );

      if (!isDefinedVariable) {
        // Comment out the entire line and add FIXME
        const indent = line.match(/^(\s*)/)?.[1] || "";
        return `${indent}// FIXME: undefined variable '${propName}'\n${indent}${trimmedLine}`;
      }
    }
    return line;
  });
  transformedBody = processedLines.join("\n");

  // Replace $axios with http and transform property access
  if (hasAxios) {
    transformedBody = transformedBody
      .replace(/this\.\$axios\s*/g, "http") // Replace this.$axios with http
      .replace(/this\.(\w+)\s*=/g, "$1.value ="); // Replace this.prop = with prop.value =
  }

  // Replace $fetch() calls
  transformedBody = transformedBody.replace(/this\.\$fetch/g, "fetch");

  // Replace nextTick usage before generic method transformations
  if (hasNextTick) {
    transformedBody = transformedBody.replace(/this\.\$nextTick/g, "nextTick");
  }

  // Replace this.methodName calls with appropriate transformations FIRST (before property transformations)
  if (options?.vuex) {
    transformedBody = transformStoreUsageInMethods(
      transformedBody,
      vuexData,
      options,
    );
  }

  // Replace this.methodName calls with just methodName for non-Vuex scenarios
  transformedBody = transformedBody.replace(
    /this\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g,
    "$1(",
  );

  // Replace Nuxt event bus usage
  if (hasEventBus) {
    transformedBody = transformedBody
      .replace(/this\.\$nuxt\.\$on/g, "eventBus.on") // Replace this.$nuxt.$on with eventBus.on
      .replace(/this\.\$nuxt\.\$off/g, "eventBus.off") // Replace this.$nuxt.$off with eventBus.off
      .replace(/this\.\$nuxt\.\$emit/g, "eventBus.emit"); // Replace this.$nuxt.$emit with eventBus.emit
  }

  // Replace Nuxt compatibility function usage
  if (hasNuxtCompat) {
    transformedBody = transformedBody
      .replace(/this\.\$nuxt\.refresh/g, "refresh") // Replace this.$nuxt.refresh with refresh
      .replace(/this\.\$nuxt\.context\.redirect/g, "redirect"); // Replace this.$nuxt.context.redirect with redirect
  }

  // Replace spread operator with this references
  transformedBody = transformedBody.replace(
    /\.\.\.(this\.(\w+))/g,
    "...$2.value",
  );

  // Replace other this.property references using tree-sitter for better accuracy
  transformedBody = transformThisReferencesWithTreeSitter(
    transformedBody,
    availableMethods,
    dataProperties,
    computedData,
    propsData,
    vuexData,
    mixinData,
  );

  // Replace $refs usage
  if (refsData && refsData.hasRefs) {
    transformedBody = transformedBody
      .replace(/this\.\$refs\?\.(\w+)/g, (match, refName) => {
        // Handle optional chaining: this.$refs?.refName
        const varName = refName.endsWith("Ref") ? refName : `${refName}Ref`;
        return `${varName}.value`;
      })
      .replace(/this\.\$refs\.(\w+)/g, (match, refName) => {
        // Handle regular access: this.$refs.refName
        const varName = refName.endsWith("Ref") ? refName : `${refName}Ref`;
        return `${varName}.value`;
      })
      .replace(/this\.\$refs\['([^']+)'\]/g, (match, refName) => {
        // Handle bracket notation: this.$refs['ref-name']
        const normalizedName = refName.replace(/-([a-z])/g, (match, letter) =>
          letter.toUpperCase(),
        );
        const varName = normalizedName.endsWith("Ref")
          ? normalizedName
          : `${normalizedName}Ref`;
        return `${varName}.value`;
      });
  }

  // Replace $config usage
  if (hasConfig) {
    transformedBody = transformedBody.replace(/this\.\$config/g, "config");
  }

  // Replace nextTick usage
  if (hasNextTick) {
    transformedBody = transformedBody.replace(/this\.\$nextTick/g, "nextTick");
  }

  // Replace router usage
  if (routerData && routerData.hasRouterUsage) {
    if (routerData.hasRoute) {
      transformedBody = transformedBody.replace(/this\.\$route/g, "route");
    }
    if (routerData.hasRouter) {
      transformedBody = transformedBody.replace(/this\.\$router/g, "router");
    }
  }

  // Replace direct store usage (commit/dispatch)
  if (options?.vuex) {
    transformedBody = transformStoreCommitDispatch(transformedBody, options);
  }

  // Transform require() statements to ESM imports using new URL()
  // Handle template literals (dynamic paths)
  transformedBody = transformedBody.replace(
    /require\(\s*`([^`]+)`\s*\)/g,
    "new URL(`$1`, import.meta.url).href",
  );

  // Handle regular string literals (static paths)
  transformedBody = transformedBody.replace(
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    "new URL('$1', import.meta.url).href",
  );

  return transformedBody;
}

function transformThisReferencesToRefs(content) {
  // Transform this.$i18n.locale and this.$i18n.localeProperties first
  let transformed = content
    .replace(/this\.\$([tnd])\(/g, "$1(") // Replace this.$t( with t(
    .replace(/this\.\$i18n\.localeProperties/g, "localeProperties")
    .replace(/this\.\$i18n\.locale/g, "locale.value");

  // Transform this.property to property.value
  return transformed.replace(/this\.(\w+)/g, "$1.value");
}

function transformStoreUsageInMethods(methodBody, vuexData, options) {
  let transformedBody = methodBody;
  if (options?.vuex && vuexData) {
    Object.entries(options.vuex).forEach(([namespace, config]) => {
      const instanceName = getStoreInstanceName(config);

      // Transform this.$store.state.namespace.property to property.value
      const stateRegex = new RegExp(
        `this\\.\\$store\\.state\\.${namespace}\\.(\\w+)`,
        "g",
      );
      transformedBody = transformedBody.replace(
        stateRegex,
        `${instanceName}.$1`,
      );
    });

    // Transform method calls (actions/mutations) - done separately to handle cross-namespace mappings
    const methodRegex = new RegExp(`this\\.(\\w+)\\(`, "g");
    transformedBody = transformedBody.replace(
      methodRegex,
      (match, methodName) => {
        // Check if this method is actually a Vuex action or mutation
        for (const mapData of vuexData?.methodProps || []) {
          if (Object.keys(mapData.mappings).includes(methodName)) {
            // Found a mapping for this method, get the correct store instance
            const methodNamespace = mapData.namespace;
            const storeConfig = options.vuex[methodNamespace];
            if (storeConfig) {
              const instanceName = getStoreInstanceName(storeConfig);
              return `${instanceName}.${methodName}(`;
            }
          }
        }

        // Not a Vuex method, leave it unchanged
        return match;
      },
    );
  }

  return transformedBody;
}

function transformStoreUsageWithTreeSitter(content, options) {
  if (!options?.vuex) {
    return content;
  }

  const parser = new Parser();
  parser.setLanguage(javascript);
  const tree = parser.parse(content);

  const replacements = [];

  function findRootStoreExpression(node) {
    // Walk up the member expression chain to find the root this.$store expression
    let current = node;
    while (current.parent && current.parent.type === "member_expression") {
      current = current.parent;
    }
    return current;
  }

  function traverse(node) {
    if (node.type === "member_expression") {
      const text = node.text;

      // Check if this is a this.$store pattern
      if (text.startsWith("this.$store.state.")) {
        // Find the root member expression to avoid nested replacements
        const rootExpression = findRootStoreExpression(node);
        const fullText = rootExpression.text;

        // Skip if we've already processed this expression
        if (replacements.some((r) => r.start === rootExpression.startIndex)) {
          return;
        }

        Object.entries(options.vuex).forEach(([namespace, config]) => {
          const instanceName = getStoreInstanceName(config);

          // Match this.$store.state.namespace patterns
          const statePattern = `this.$store.state.${namespace}`;
          if (fullText.startsWith(statePattern)) {
            let replacement;
            if (fullText === statePattern) {
              // Exact match: this.$store.state.namespace
              replacement = instanceName;
            } else if (fullText.startsWith(statePattern + ".")) {
              // Property access: this.$store.state.namespace.property...
              const propertyPart = fullText.substring(statePattern.length + 1);
              replacement = `${instanceName}.${propertyPart}`;
            } else {
              return; // No match
            }

            replacements.push({
              start: rootExpression.startIndex,
              end: rootExpression.endIndex,
              replacement: replacement,
            });
          }
        });
      }
    }

    // Traverse child nodes
    for (const child of node.namedChildren) {
      traverse(child);
    }
  }

  traverse(tree.rootNode);

  // Apply replacements from end to start to maintain correct indices
  replacements.sort((a, b) => b.start - a.start);

  let result = content;
  for (const { start, end, replacement } of replacements) {
    result = result.substring(0, start) + replacement + result.substring(end);
  }

  return result;
}

function transformStoreCommitDispatch(methodBody, options) {
  let transformedBody = methodBody;

  if (options?.vuex) {
    // Transform this.$store.commit('namespace/action', payload) to storeInstance.action(payload)
    transformedBody = transformedBody.replace(
      /this\.\$store\.commit\s*\(\s*['"]([^'"]+)['"]\s*,?\s*([^)]*)\)/g,
      (match, actionPath, payload) => {
        const [namespace, actionName] = actionPath.split("/");
        const storeConfig = options.vuex[namespace];
        if (storeConfig) {
          const instanceName = getStoreInstanceName(storeConfig);
          const cleanPayload = payload.trim();
          return cleanPayload
            ? `${instanceName}.${actionName}(${cleanPayload})`
            : `${instanceName}.${actionName}()`;
        }
        return match;
      },
    );

    // Transform this.$store.dispatch('namespace/action', payload) to storeInstance.action(payload)
    transformedBody = transformedBody.replace(
      /this\.\$store\.dispatch\s*\(\s*['"]([^'"]+)['"]\s*,?\s*([^)]*)\)/g,
      (match, actionPath, payload) => {
        const [namespace, actionName] = actionPath.split("/");
        const storeConfig = options.vuex[namespace];
        if (storeConfig) {
          const instanceName = getStoreInstanceName(storeConfig);
          const cleanPayload = payload.trim();
          return cleanPayload
            ? `${instanceName}.${actionName}(${cleanPayload})`
            : `${instanceName}.${actionName}()`;
        }
        return match;
      },
    );
  }

  return transformedBody;
}

function transformThisReferencesWithTreeSitter(
  content,
  availableMethods = {},
  dataProperties = {},
  computedData = {},
  propsData = null,
  vuexData = null,
  mixinData = null,
) {
  const parser = new Parser();
  parser.setLanguage(javascript);

  try {
    const tree = parser.parse(content);
    let transformedContent = content;
    const transformations = [];

    function traverse(node) {
      // Look for member expressions that are this.property
      if (node.type === "member_expression") {
        const objectNode = node.namedChildren[0];
        const propertyNode = node.namedChildren[1];

        if (
          objectNode &&
          objectNode.text === "this" &&
          propertyNode &&
          propertyNode.type === "property_identifier"
        ) {
          const propName = propertyNode.text;

          // Skip special properties that are handled elsewhere
          if (propName.startsWith("$")) {
            return;
          }

          // Check if this property is a method (regardless of whether it's being called or referenced)
          if (
            availableMethods &&
            (availableMethods[propName] ||
              typeof availableMethods[propName] === "object")
          ) {
            // For methods, just remove 'this.' - don't add .value
            const replacement = propName;
            transformations.push({
              start: node.startIndex,
              end: node.endIndex,
              replacement: replacement,
            });
            return;
          }

          // Determine the transformation for non-method properties
          let replacement;
          const isProp = isPropProperty(propName, propsData);

          if (isProp) {
            replacement = `props.${propName}`;
          } else {
            replacement = `${propName}.value`;
          }

          // Store transformation to apply later (in reverse order to maintain positions)
          transformations.push({
            start: node.startIndex,
            end: node.endIndex,
            replacement: replacement,
          });
        }
      }

      // Recursively traverse children
      node.namedChildren.forEach((child) => traverse(child));
    }

    traverse(tree.rootNode);

    // Apply transformations in reverse order to maintain string positions
    transformations.sort((a, b) => b.start - a.start);

    for (const transformation of transformations) {
      transformedContent =
        transformedContent.slice(0, transformation.start) +
        transformation.replacement +
        transformedContent.slice(transformation.end);
    }

    return transformedContent;
  } catch (error) {
    // If tree-sitter parsing fails, fall back to the original content
    console.warn("Tree-sitter parsing failed, using original content:", error);
    return content;
  }
}

function getStoreInstanceName(storeConfig) {
  // Convert useUserStore to userStore
  return storeConfig.importName.replace(
    /^use(\w+)Store$/,
    (match, name) => name.charAt(0).toLowerCase() + name.slice(1) + "Store",
  );
}

function isVariableDefined(
  varName,
  dataProperties,
  computedData,
  propsData,
  availableMethods,
  vuexData,
  mixinData,
) {
  // Check if it's a data property
  if (dataProperties && dataProperties[varName]) {
    return true;
  }

  // Check if it's a computed property
  if (computedData && computedData[varName]) {
    return true;
  }

  // Check if it's a Vuex computed property
  if (vuexData && vuexData.computedProps) {
    for (const mapData of vuexData.computedProps) {
      if (mapData.mappings && mapData.mappings[varName]) {
        return true;
      }
    }
  }

  // Check if it's a prop (we need to parse props if it's an object)
  if (propsData) {
    try {
      // Try to check if it's in props (could be array or object format)
      if (typeof propsData === "string") {
        const propsObj = eval(`(${propsData})`);
        if (
          propsObj &&
          (Array.isArray(propsObj)
            ? propsObj.includes(varName)
            : propsObj[varName])
        ) {
          return true;
        }
      }
    } catch (e) {
      // If parsing fails, assume it might be defined
    }
  }

  // Check if it's a method
  if (
    availableMethods &&
    (availableMethods[varName] || typeof availableMethods[varName] === "object")
  ) {
    return true;
  }

  // Check if it's a mixin method/property
  if (mixinData && mixinData.usedMixins) {
    for (const mixin of mixinData.usedMixins) {
      if (
        mixin.config &&
        mixin.config.imports &&
        mixin.config.imports.includes(varName)
      ) {
        return true;
      }
    }
  }

  return false;
}

export {
  transformToCompositionAPI,
  transformStoreUsageInTemplate,
  transformComponentUsageInTemplate,
};
