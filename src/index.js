import compiler from "vue-template-compiler";
import Parser from "tree-sitter";
import javascript from "tree-sitter-javascript";
import { HTMLRewriter } from "html-rewriter-wasm";
import prettier from "prettier";
import {
  extractDataProperties,
  extractMethodsAndFetch,
  extractProps,
  extractComputedProperties,
  extractHeadMethod,
  extractAsyncDataMethod,
  extractLifecycleMethods,
  extractWatchers,
  extractEmits,
  extractMixinData,
  extractVuexData,
  extractVariablesFromExpression,
  extractI18nUsage,
  extractNuxtI18nData,
  extractRefsUsage,
  extractImportRewriteData,
  detectDirectStoreUsage,
  detectAxiosUsage,
  detectFiltersUsage,
  detectEventBusUsage,
  detectNuxtCompatUsage,
  detectConfigUsage,
  detectNextTickUsage,
  detectRouterUsage,
} from "./extractors.js";
import {
  transformToCompositionAPI,
  transformStoreUsageInTemplate,
  transformComponentUsageInTemplate,
} from "./transformers.js";

// This function takes a Vue SFC (Single File Component) and rewrites it to use the Composition API.
// returning it compiled as a string.
async function rewriteSFC(sfc, options = {}) {
  const parsed = compiler.parseComponent(sfc, {
    pad: "line",
    whitespace: "condense",
    comments: true,
  });

  // Extract variables used in template and i18n usage
  const templateVariables = new Set();
  const i18nMethods = new Set();

  let output = "";
  if (parsed.template) {
    // Transform template content before processing with HTMLRewriter
    let templateContent = parsed.template.content;

    // Transform component usage in template first
    if (options.importsRewrite || options.additionalImports) {
      templateContent = transformComponentUsageInTemplate(
        templateContent,
        options,
      );
    }

    // Default transformations for common components
    templateContent = transformComponentUsageInTemplate(templateContent, {
      additionalImports: {
        NuxtLink: {
          rewriteTo: "router-link",
        },
      },
    });

    // Apply global template transformations before HTMLRewriter
    templateContent = templateContent
      .replace(/\$i18n\.locale/g, "locale")
      .replace(/\$([tnd])\(/g, "$1(")
      .replace(/\$config/g, "config");

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let decoded = "";

    const rewriter = new HTMLRewriter((chunk) => {
      decoded = decoder.decode(chunk);
      output += decoded;
    });

    // Handle all elements to extract Vue directives and variable usage
    rewriter.on("*", {
      element(element) {
        // Extract component names as template variables
        templateVariables.add(element.tagName);

        // Extract variables from v-if, v-for, v-show, etc.
        for (const [name, value] of element.attributes) {
          if (
            name.startsWith("v-") ||
            name.startsWith(":") ||
            name.startsWith("@")
          ) {
            extractVariablesFromExpression(value, templateVariables);
            extractI18nUsage(value, i18nMethods);

            // Also track directive names for import detection
            if (name.startsWith("v-")) {
              templateVariables.add(name);
            }
          } else if (
            name === "src" &&
            element.tagName === "img" &&
            value.startsWith("~")
          ) {
            // Handle image src paths
            element.setAttribute("src", value.replace(/^~\//, "@/")); // Normalize ~ to @
          }
        }
      },
      text(text) {
        // Extract variables from mustache syntax {{ variable }}
        let content = text.text;
        const mustacheMatches = content.match(/\{\{\s*([^}]+)\s*\}\}/g);
        if (mustacheMatches) {
          mustacheMatches.forEach((match) => {
            const expr = match.replace(/\{\{\s*|\s*\}\}/g, "");
            extractVariablesFromExpression(expr, templateVariables);
            extractI18nUsage(expr, i18nMethods);
          });
        }

        // Transform i18n method calls in the template
        content = content.replace(/\$([tnd])\(/g, "$1(");

        // Transform $i18n.locale to locale
        content = content.replace(/\$i18n\.locale/g, "locale");

        // Transform $config to config
        content = content.replace(/\$config/g, "config");

        // Transform $store usage in template
        if (options.vuex) {
          content = transformStoreUsageInTemplate(content, options.vuex);
        }

        text.replace(content);
      },
    });

    // Process the transformed template content with HTMLRewriter
    try {
      await rewriter.write(encoder.encode(templateContent));
      await rewriter.end();
    } finally {
      rewriter.free();
    }
  }

  // Parse script section with tree-sitter
  if (!parsed.script || !parsed.script.content) {
    return sfc; // Return original if no script
  }

  const jsParser = new Parser();
  jsParser.setLanguage(javascript);
  const jsTree = jsParser.parse(parsed.script.content);

  // Extract data properties and methods from the script
  const dataProperties = extractDataProperties(jsTree, parsed.script.content);
  const { regularMethods, fetchMethod } = extractMethodsAndFetch(
    jsTree,
    parsed.script.content,
  );

  // Extract props and computed properties
  const propsData = extractProps(jsTree, parsed.script.content);
  const computedData = extractComputedProperties(jsTree, parsed.script.content);

  // Extract head method
  const headMethod = extractHeadMethod(jsTree, parsed.script.content);

  // Extract asyncData method
  const asyncDataMethod = extractAsyncDataMethod(jsTree, parsed.script.content);

  // Extract lifecycle methods
  const lifecycleMethods = extractLifecycleMethods(
    jsTree,
    parsed.script.content,
  );

  // Extract watchers
  const watchData = extractWatchers(jsTree, parsed.script.content);

  // Extract emits
  const emitsData = extractEmits(jsTree, parsed.script.content);

  // Extract mixin information
  const mixinData = extractMixinData(jsTree, parsed.script.content, options);

  // Extract Vuex information
  const vuexData = extractVuexData(jsTree, parsed.script.content, options);

  // Detect direct $store usage (commit/dispatch)
  const hasDirectStoreUsage = detectDirectStoreUsage(parsed.script.content);

  // Extract namespaces from direct store usage
  if (hasDirectStoreUsage) {
    if (!options.vuex) {
      options.vuex = {};
    }

    parsed.script.content
      .matchAll(/\$store\.(commit|dispatch)\(['"]([^'"]+)['"]/g)
      .forEach((match) => {
        const namespace = match[2].split("/")[0];
        if (namespace && !options.vuex[namespace]) {
          // Create a default store configuration if it doesn't exist
          options.vuex[namespace] = {
            name: namespace,
            importName: `use${namespace.charAt(0).toUpperCase() + namespace.slice(1)}Store`,
          };
        }
      });
  }

  // Extract import rewrite information
  const importRewriteData = extractImportRewriteData(
    jsTree,
    parsed.script.content,
    options,
  );

  // Extract nuxtI18n information
  const nuxtI18nData = extractNuxtI18nData(jsTree, parsed.script.content);

  // Detect $axios usage in all methods (excluding asyncData)
  let scriptContentWithoutAsync = parsed.script.content;
  if (asyncDataMethod) {
    // Remove asyncData method content from axios detection
    scriptContentWithoutAsync = scriptContentWithoutAsync.replace(
      asyncDataMethod.fullMethodContent,
      "",
    );
  }
  const hasAxios = detectAxiosUsage(scriptContentWithoutAsync);

  // Detect filters usage
  const hasFilters = detectFiltersUsage(parsed.script.content);

  // Detect Nuxt event bus usage
  const hasEventBus = detectEventBusUsage(parsed.script.content);

  // Detect Nuxt compatibility functions usage
  const hasNuxtCompat = detectNuxtCompatUsage(parsed.script.content);

  // Detect $refs usage
  const refsData = extractRefsUsage(
    parsed.script.content,
    parsed.template?.content || "",
  );

  // Detect $config usage
  const hasConfig = detectConfigUsage(parsed.script.content);

  // Detect nextTick usage
  const hasNextTick = detectNextTickUsage(parsed.script.content);

  // Detect $route/$router usage
  const routerData = detectRouterUsage(parsed.script.content);

  // Extract i18n usage from methods
  Object.values(regularMethods).forEach((methodData) => {
    const methodContent =
      typeof methodData === "string" ? methodData : methodData.content;
    extractI18nUsage(methodContent, i18nMethods);
  });

  if (fetchMethod) {
    extractI18nUsage(fetchMethod, i18nMethods);
  }

  // Extract i18n usage from data properties
  Object.values(dataProperties).forEach((value) => {
    extractI18nUsage(value, i18nMethods);
  });

  // Extract i18n usage from entire script content for lifecycle methods
  extractI18nUsage(parsed.script.content, i18nMethods);

  // Transform to composition API
  const scriptSetupContent = transformToCompositionAPI(
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
  );

  // Rebuild the SFC
  let result = "";

  if (parsed.template) {
    result += `<template>${output}</template>\n`;
  }

  if (scriptSetupContent.trim()) {
    result += `<script setup>\n${scriptSetupContent}\n</script>`;
  } else {
    result += `<script setup></script>`;
  }

  // Add nuxtI18n script tag if needed
  if (nuxtI18nData && nuxtI18nData.paths) {
    result += `\n<script>\nexport const i18n = ${nuxtI18nData.paths};\n</script>`;
  }

  if (parsed.styles && parsed.styles.length > 0) {
    parsed.styles.forEach((style) => {
      result += `\n<style${style.scoped ? " scoped" : ""}${
        style.lang ? ` lang="${style.lang}"` : ""
      }>${style.content}</style>`;
    });
  }

  // Format the result with Prettier
  try {
    const formattedResult = await prettier.format(result, {
      parser: "vue",
      singleQuote: true,
      semi: true,
      tabWidth: 2,
      printWidth: 120,
      bracketSameLine: true,
    });
    return formattedResult;
  } catch (error) {
    // If formatting fails, return the unformatted result
    console.warn("Prettier formatting failed:", error.message);
    return result;
  }
}

// ...existing code...
export { rewriteSFC };
