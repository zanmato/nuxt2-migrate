import compiler from "vue-template-compiler";
import Parser from "tree-sitter";
import javascript from "tree-sitter-javascript";
import { HTMLRewriter } from "html-rewriter-wasm";
import prettier from "prettier";

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
      .replace(/\$([tnd])\(/g, "$1(");

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

  // Detect Nuxt event bus usage
  const hasEventBus = detectEventBusUsage(parsed.script.content);

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

function extractVariablesFromExpression(expr, variables) {
  // Transform $i18n.locale to locale before extracting variables
  let transformedExpr = expr.replace(/\$i18n\.locale/g, "locale");

  // Simple regex to extract variable names (this could be more sophisticated)
  const matches = transformedExpr.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g);
  if (matches) {
    matches.forEach((match) => {
      // Filter out common keywords and methods
      if (
        ![
          "true",
          "false",
          "null",
          "undefined",
          "this",
          "console",
          "window",
          "document",
        ].includes(match)
      ) {
        variables.add(match);
      }
    });
  }
}

function extractI18nUsage(expr, i18nMethods) {
  // Extract i18n method calls: $t(), $n(), $d() and also t(), n(), d() (after transformation)
  const dollarMatches = expr.match(/\$([tnd])\(/g);
  if (dollarMatches) {
    dollarMatches.forEach((match) => {
      const method = match.replace(/\$|\(/g, ""); // Remove $ and (
      i18nMethods.add(method);
    });
  }

  // Also extract t(), n(), d() (transformed versions)
  const transformedMatches = expr.match(/\b([tnd])\(/g);
  if (transformedMatches) {
    transformedMatches.forEach((match) => {
      const method = match.replace(/\(/g, ""); // Remove (
      if (["t", "n", "d"].includes(method)) {
        i18nMethods.add(method);
      }
    });
  }

  // Extract $i18n.locale usage
  if (expr.includes("$i18n.locale")) {
    i18nMethods.add("locale");
  }

  // Extract $i18n.localeProperties usage
  if (expr.includes("$i18n.localeProperties")) {
    i18nMethods.add("localeProperties");
  }

  // Extract localePath usage
  if (expr.includes("localePath")) {
    i18nMethods.add("localePath");
  }
}

function detectAxiosUsage(content) {
  return content.includes("$axios");
}

function detectEventBusUsage(content) {
  return (
    content.includes("$nuxt.$on") ||
    content.includes("$nuxt.$off") ||
    content.includes("$nuxt.$emit")
  );
}

function extractRefsUsage(scriptContent, templateContent) {
  // Extract refs from template
  const templateRefs = new Set();
  const refMatches = templateContent.match(/ref="([^"]+)"/g);
  if (refMatches) {
    refMatches.forEach((match) => {
      const refName = match.match(/ref="([^"]+)"/)?.[1];
      if (refName) {
        templateRefs.add(refName);
      }
    });
  }

  // Extract $refs usage from script
  const scriptRefs = new Set();
  const scriptRefMatches = scriptContent.match(/\$refs\.(\w+)/g);
  if (scriptRefMatches) {
    scriptRefMatches.forEach((match) => {
      const refName = match.replace("$refs.", "");
      scriptRefs.add(refName);
    });
  }

  // Also handle bracket notation $refs['refName']
  const bracketRefMatches = scriptContent.match(/\$refs\['([^']+)'\]/g);
  if (bracketRefMatches) {
    bracketRefMatches.forEach((match) => {
      const refName = match.match(/\$refs\['([^']+)'\]/)?.[1];
      if (refName) {
        scriptRefs.add(refName);
      }
    });
  }

  return {
    templateRefs: Array.from(templateRefs),
    scriptRefs: Array.from(scriptRefs),
    hasRefs: templateRefs.size > 0 || scriptRefs.size > 0,
  };
}

function detectConfigUsage(content) {
  return content.includes("$config");
}

function detectNextTickUsage(content) {
  return content.includes("$nextTick");
}

function detectRouterUsage(content) {
  const hasRoute = content.includes("$route");
  const hasRouter = content.includes("$router");
  return {
    hasRoute,
    hasRouter,
    hasRouterUsage: hasRoute || hasRouter,
  };
}

function detectDirectStoreUsage(content) {
  return (
    content.includes("$store.commit") || content.includes("$store.dispatch")
  );
}

function extractMixinData(tree, content, options) {
  const mixinImports = {};
  const usedMixins = [];

  function traverse(node) {
    // Find import statements for mixins
    if (node.type === "import_statement") {
      const sourceNode = node.namedChildren.find(
        (child) => child.type === "string",
      );
      if (sourceNode) {
        const importPath = sourceNode.text.replace(/['"]/g, "");
        const mixinName = extractMixinNameFromPath(importPath);

        if (mixinName && options.mixins && options.mixins[mixinName]) {
          const defaultImportNode = node.namedChildren.find(
            (child) => child.type === "import_clause",
          );
          if (defaultImportNode) {
            const importNameNode = defaultImportNode.namedChildren.find(
              (child) => child.type === "identifier",
            );
            if (importNameNode) {
              mixinImports[importNameNode.text] = {
                path: importPath,
                mixinName: mixinName,
                config: options.mixins[mixinName],
              };
            }
          }
        }
      }
    }

    // Find mixins array in the component
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "mixins" &&
        valueNode &&
        valueNode.type === "array"
      ) {
        valueNode.namedChildren.forEach((child) => {
          if (child.type === "identifier" && mixinImports[child.text]) {
            usedMixins.push(mixinImports[child.text]);
          }
        });
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);

  return { mixinImports, usedMixins };
}

function extractMixinNameFromPath(path) {
  // Extract mixin name from path like '@/mixins/price' -> 'price'
  const match = path.match(/\/mixins\/(\w+)$/);
  return match ? match[1] : null;
}

function extractNuxtI18nData(tree, content) {
  let nuxtI18nData = null;

  function traverse(node) {
    // Look for pair nodes where the key is "nuxtI18n"
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "nuxtI18n" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        // Look for paths property within nuxtI18n
        valueNode.namedChildren.forEach((prop) => {
          if (prop.type === "pair") {
            const propKey = prop.namedChildren[0];
            const propValue = prop.namedChildren[1];

            if (
              propKey &&
              propKey.text === "paths" &&
              propValue &&
              propValue.type === "object"
            ) {
              // Extract the paths object content
              const pathsContent = content.slice(
                propValue.startIndex,
                propValue.endIndex,
              );
              nuxtI18nData = { paths: pathsContent };
            }
          }
        });
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return nuxtI18nData;
}

function extractVuexData(tree, content, options) {
  const vuexData = {
    hasVuexImports: false,
    computedProps: [],
    methodProps: [],
    lifecycleMethods: [],
    usedStores: new Set(),
  };

  function traverse(node) {
    // Find Vuex imports
    if (node.type === "import_statement") {
      const sourceNode = node.namedChildren.find(
        (child) => child.type === "string",
      );
      if (sourceNode && sourceNode.text.includes("vuex")) {
        vuexData.hasVuexImports = true;
      }
    }

    // Find computed properties with map functions
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "computed" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        parseComputedProperties(valueNode, content, vuexData, options);
      }

      // Find methods with map functions
      if (
        keyNode &&
        keyNode.text === "methods" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        parseMethodProperties(valueNode, content, vuexData, options);
      }
    }

    // Find lifecycle methods
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      if (nameNode && isLifecycleMethod(nameNode.text)) {
        const bodyNode = node.namedChildren.find(
          (child) => child.type === "statement_block",
        );
        if (bodyNode) {
          const methodContent = content.slice(
            bodyNode.startIndex,
            bodyNode.endIndex,
          );
          vuexData.lifecycleMethods.push({
            name: nameNode.text,
            content: methodContent,
          });
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return vuexData;
}

function parseComputedProperties(computedNode, content, vuexData, options) {
  computedNode.namedChildren.forEach((prop) => {
    if (prop.type === "spread_element") {
      // Handle spread syntax like ...mapState, ...mapGetters
      const argumentNode = prop.namedChildren[0];
      if (argumentNode && argumentNode.type === "call_expression") {
        const funcNode = argumentNode.namedChildren.find(
          (child) => child.type === "identifier",
        );
        if (funcNode) {
          const mapFunction = funcNode.text;
          // Get the arguments node and extract its children
          const argsNode = argumentNode.namedChildren.find(
            (child) => child.type === "arguments",
          );
          const args = argsNode ? argsNode.namedChildren : [];
          parseMapFunction(
            mapFunction,
            args,
            content,
            vuexData,
            options,
            "computed",
          );
        }
      }
    }
  });
}

function parseMethodProperties(methodsNode, content, vuexData, options) {
  methodsNode.namedChildren.forEach((prop) => {
    if (prop.type === "spread_element") {
      // Handle spread syntax like ...mapActions, ...mapMutations
      const argumentNode = prop.namedChildren[0];
      if (argumentNode && argumentNode.type === "call_expression") {
        const funcNode = argumentNode.namedChildren.find(
          (child) => child.type === "identifier",
        );
        if (funcNode) {
          const mapFunction = funcNode.text;
          // Get the arguments node and extract its children
          const argsNode = argumentNode.namedChildren.find(
            (child) => child.type === "arguments",
          );
          const args = argsNode ? argsNode.namedChildren : [];
          parseMapFunction(
            mapFunction,
            args,
            content,
            vuexData,
            options,
            "methods",
          );
        }
      }
    }
  });
}

function parseMapFunction(mapFunction, args, content, vuexData, options, type) {
  if (
    !["mapState", "mapGetters", "mapActions", "mapMutations"].includes(
      mapFunction,
    )
  ) {
    return;
  }

  let namespace = null;
  let mappings = {};

  // Parse arguments - can be (namespace, object) or just (object)
  if (args.length === 2) {
    // Has namespace
    const namespaceNode = args[0];
    const mappingsNode = args[1];

    if (namespaceNode.type === "string") {
      namespace = namespaceNode.text.replace(/['"]/g, "");
    }

    if (mappingsNode.type === "object") {
      mappings = parseObjectMappings(mappingsNode, content);
    } else if (mappingsNode.type === "array") {
      mappings = parseArrayMappings(mappingsNode, content, mapFunction);
    }
  } else if (args.length === 1) {
    // No namespace
    const mappingsNode = args[0];
    if (mappingsNode.type === "object") {
      mappings = parseObjectMappings(mappingsNode, content);

      // Extract namespace from values if not explicitly provided
      if (!namespace) {
        Object.values(mappings).forEach((value) => {
          if (typeof value === "string" && value.includes("/")) {
            const extractedNamespace = value.split("/")[0];
            if (options.vuex && options.vuex[extractedNamespace]) {
              namespace = extractedNamespace;
            }
          }
        });
      }
    } else if (mappingsNode.type === "array") {
      mappings = parseArrayMappings(mappingsNode, content, mapFunction);
    }
  }

  // Store the mapping information
  const mapData = {
    type: mapFunction,
    namespace,
    mappings,
    category: type,
  };

  if (type === "computed") {
    vuexData.computedProps.push(mapData);
  } else {
    vuexData.methodProps.push(mapData);
  }

  // Track used stores
  if (namespace && options.vuex && options.vuex[namespace]) {
    vuexData.usedStores.add(namespace);
  }
}

function parseObjectMappings(objectNode, content) {
  const mappings = {};

  objectNode.namedChildren.forEach((pair) => {
    if (pair.type === "pair") {
      const keyNode = pair.namedChildren[0];
      const valueNode = pair.namedChildren[1];

      if (keyNode && valueNode) {
        const key = keyNode.text.replace(/['"]/g, "");
        const value = valueNode.text
          ? valueNode.text.replace(/['"]/g, "")
          : content.slice(valueNode.startIndex, valueNode.endIndex);
        mappings[key] = value;
      }
    }
  });

  return mappings;
}

function parseArrayMappings(arrayNode, content, mapFunction) {
  const mappings = {};

  arrayNode.namedChildren.forEach((element) => {
    if (element.type === "string") {
      const propName = element.text.replace(/['"]/g, "");

      if (mapFunction === "mapGetters" && propName.startsWith("get")) {
        // For mapGetters with array syntax, convert 'getUser' to 'user'
        const localName = propName.charAt(3).toLowerCase() + propName.slice(4);
        mappings[localName] = propName;
      } else {
        // For array syntax, the key and value are the same (e.g., ['userID'] maps userID -> userID)
        mappings[propName] = propName;
      }
    }
  });

  return mappings;
}

function isLifecycleMethod(methodName) {
  return [
    "mounted",
    "created",
    "beforeMount",
    "beforeCreate",
    "updated",
    "beforeUpdate",
    "destroyed",
    "beforeDestroy",
    "beforeUnmount",
    "unmounted",
    "activated",
    "deactivated",
    "beforeUpdate",
  ].includes(methodName);
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

function getStoreInstanceName(storeConfig) {
  // Convert useUserStore to userStore
  return storeConfig.importName.replace(
    /^use(\w+)Store$/,
    (match, name) => name.charAt(0).toLowerCase() + name.slice(1) + "Store",
  );
}

function extractImportRewriteData(tree, content, options) {
  const importData = {
    existingImports: {},
    usedComponents: new Set(),
    rewriteRules: options.importsRewrite || {},
    additionalImports: options.additionalImports || {},
    keeplistImports: {},
    keeplistDeclarations: {},
    importKeeplist: options.importKeeplist || [],
  };

  function traverse(node) {
    // Find import statements
    if (node.type === "import_statement") {
      const sourceNode = node.namedChildren.find(
        (child) => child.type === "string",
      );
      if (sourceNode) {
        const importPath = sourceNode.text.replace(/['"]/g, "");
        const importClause = node.namedChildren.find(
          (child) => child.type === "import_clause",
        );

        // Check if this import should be kept
        const shouldKeep = importData.importKeeplist.some((pattern) => {
          if (pattern instanceof RegExp) {
            return pattern.test(importPath);
          }
          return pattern === importPath;
        });

        if (shouldKeep) {
          // Extract the full import statement and normalize ~ to @
          let fullImport = content.slice(node.startIndex, node.endIndex);
          fullImport = fullImport.replace(/['"]~\//g, "'@/");
          importData.keeplistImports[importPath] = fullImport;
        }

        if (importClause) {
          const namedImports = importClause.namedChildren.find(
            (child) => child.type === "named_imports",
          );
          if (namedImports) {
            const components = [];
            namedImports.namedChildren.forEach((spec) => {
              if (spec.type === "import_specifier") {
                const nameNode = spec.namedChildren.find(
                  (child) => child.type === "identifier",
                );
                if (nameNode) {
                  components.push(nameNode.text);
                }
              }
            });
            importData.existingImports[importPath] = components;
          }
        }
      }
    }

    // Find variable declarations with dynamic imports
    if (
      node.type === "variable_declaration" ||
      node.type === "lexical_declaration"
    ) {
      node.namedChildren.forEach((declarator) => {
        if (declarator.type === "variable_declarator") {
          const nameNode = declarator.namedChildren.find(
            (child) => child.type === "identifier",
          );
          const valueNode = declarator.namedChildren.find(
            (child) => child.type === "arrow_function",
          );

          if (nameNode && valueNode) {
            // Check if the arrow function contains a dynamic import
            const functionContent = content.slice(
              valueNode.startIndex,
              valueNode.endIndex,
            );
            const importMatch = functionContent.match(
              /import\(['"]([^'"]+)['"]\)/,
            );

            if (importMatch) {
              const importPath = importMatch[1];

              // Check if this import path should be kept
              const shouldKeep = importData.importKeeplist.some((pattern) => {
                if (pattern instanceof RegExp) {
                  return pattern.test(importPath);
                }
                return pattern === importPath;
              });

              if (shouldKeep) {
                // Extract the full variable declaration and normalize ~ to @
                let fullDeclaration = content.slice(
                  node.startIndex,
                  node.endIndex,
                );
                fullDeclaration = fullDeclaration.replace(
                  /import\(['"]~\//g,
                  "import('@/",
                );
                importData.keeplistDeclarations[nameNode.text] =
                  fullDeclaration;
              }
            }
          }
        }
      });
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return importData;
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

function extractHeadMethod(tree, content) {
  let headMethod = null;

  function traverse(node) {
    // Look for method_definition nodes where the name is "head"
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      const bodyNode = node.namedChildren.find(
        (child) => child.type === "statement_block",
      );

      if (nameNode && nameNode.text === "head" && bodyNode) {
        const methodContent = content.slice(
          bodyNode.startIndex,
          bodyNode.endIndex,
        );

        // Check if this is a simple return statement or more complex
        const returnStatement = findReturnStatement(bodyNode);
        if (returnStatement && returnStatement.namedChildren.length > 0) {
          const returnValue = returnStatement.namedChildren[0];
          if (returnValue && returnValue.type === "object") {
            // Simple return { ... } case
            const objectContent = content.slice(
              returnValue.startIndex,
              returnValue.endIndex,
            );
            headMethod = { type: "simple", content: objectContent };
          } else {
            // Complex case with variables, etc.
            headMethod = { type: "complex", content: methodContent };
          }
        } else {
          // Complex case
          headMethod = { type: "complex", content: methodContent };
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return headMethod;
}

function extractAsyncDataMethod(tree, content) {
  let asyncDataMethod = null;

  function traverse(node) {
    // Look for method_definition nodes where the name is "asyncData"
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      const parametersNode = node.namedChildren.find(
        (child) => child.type === "formal_parameters",
      );
      const bodyNode = node.namedChildren.find(
        (child) => child.type === "statement_block",
      );

      if (
        nameNode &&
        nameNode.text === "asyncData" &&
        parametersNode &&
        bodyNode
      ) {
        const parametersContent = content.slice(
          parametersNode.startIndex,
          parametersNode.endIndex,
        );
        const methodContent = content.slice(
          bodyNode.startIndex,
          bodyNode.endIndex,
        );
        const fullMethodContent = content.slice(node.startIndex, node.endIndex);

        // Analyze the return statement to extract what properties will be returned
        const returnProperties = extractReturnProperties(bodyNode, content);

        asyncDataMethod = {
          parameters: parametersContent,
          content: methodContent,
          fullMethodContent: fullMethodContent,
          returnProperties: returnProperties,
        };
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return asyncDataMethod;
}

function extractReturnProperties(bodyNode, content) {
  const returnProperties = [];

  function findReturn(node) {
    if (node.type === "return_statement" && node.namedChildren.length > 0) {
      const returnValue = node.namedChildren[0];
      if (returnValue && returnValue.type === "object") {
        // Extract property names from the return object
        returnValue.namedChildren.forEach((prop) => {
          if (prop.type === "pair") {
            const keyNode = prop.namedChildren[0];
            if (keyNode) {
              const key = keyNode.text.replace(/["']/g, "");
              returnProperties.push(key);
            }
          }
        });
      }
    }

    // Recursively search children
    node.namedChildren.forEach((child) => findReturn(child));
  }

  findReturn(bodyNode);
  return returnProperties;
}

function extractLifecycleMethods(tree, content) {
  const lifecycleMethods = {};

  function traverse(node) {
    // Look for method_definition nodes where the name is a lifecycle method
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      const bodyNode = node.namedChildren.find(
        (child) => child.type === "statement_block",
      );

      if (nameNode && bodyNode && isLifecycleMethod(nameNode.text)) {
        const methodName = nameNode.text;
        const methodContent = content.slice(
          bodyNode.startIndex,
          bodyNode.endIndex,
        );
        lifecycleMethods[methodName] = methodContent;
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return lifecycleMethods;
}

function extractWatchers(tree, content) {
  const watchers = {};

  function traverse(node) {
    // Look for pair nodes where the key is "watch"
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "watch" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        // Parse each watcher
        valueNode.namedChildren.forEach((prop) => {
          if (prop.type === "method_definition") {
            const propKey = prop.namedChildren[0];
            // For method_definition, the function content is the entire node
            const propValue = prop;

            if (propKey && propValue) {
              const watchName = propKey.text.replace(/[\"']/g, "");

              // For method_definition watchers like: count(newVal, oldVal) { ... }
              const watcherContent = content.slice(
                propValue.startIndex,
                propValue.endIndex,
              );
              watchers[watchName] = {
                type: "function",
                content: watcherContent,
              };
            }
          } else if (prop.type === "pair") {
            // Handle watchers defined as key-value pairs
            const propKey = prop.namedChildren[0];
            const propValue = prop.namedChildren[1];

            if (propKey && propValue) {
              const watchName = propKey.text.replace(/[\"']/g, "");

              if (
                propValue.type === "function_expression" ||
                propValue.type === "arrow_function"
              ) {
                // Simple watcher function
                const watcherContent = content.slice(
                  propValue.startIndex,
                  propValue.endIndex,
                );
                watchers[watchName] = {
                  type: "function",
                  content: watcherContent,
                };
              } else if (propValue.type === "object") {
                // Complex watcher with options
                const watcherContent = content.slice(
                  propValue.startIndex,
                  propValue.endIndex,
                );
                watchers[watchName] = {
                  type: "object",
                  content: watcherContent,
                };
              }
            }
          }
        });
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return watchers;
}

function extractProps(tree, content) {
  let propsData = null;

  function traverse(node) {
    // Look for pair nodes where the key is "props"
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (keyNode && keyNode.text === "props" && valueNode) {
        if (valueNode.type === "object") {
          // Extract the entire props object
          propsData = content.slice(valueNode.startIndex, valueNode.endIndex);
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return propsData;
}

function extractComputedProperties(tree, content) {
  const computedProperties = {};

  function traverse(node) {
    // Look for pair nodes where the key is "computed"
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "computed" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        // Parse each computed property
        valueNode.namedChildren.forEach((prop) => {
          if (prop.type === "pair") {
            const propKey = prop.namedChildren[0];
            const propValue = prop.namedChildren[1];

            if (propKey && propValue) {
              const key = propKey.text.replace(/["']/g, "");

              if (propValue.type === "object") {
                // Handle getter/setter syntax
                const getterSetter = {};
                propValue.namedChildren.forEach((method) => {
                  if (method.type === "method_definition") {
                    const methodName = method.namedChildren.find(
                      (child) => child.type === "property_identifier",
                    );
                    const methodBody = method.namedChildren.find(
                      (child) => child.type === "statement_block",
                    );

                    if (methodName && methodBody) {
                      const methodContent = content.slice(
                        methodBody.startIndex,
                        methodBody.endIndex,
                      );
                      getterSetter[methodName.text] = methodContent;
                    }
                  }
                });
                computedProperties[key] = {
                  type: "getterSetter",
                  value: getterSetter,
                };
              } else {
                // Handle simple computed property (function)
                const value = content.slice(
                  propValue.startIndex,
                  propValue.endIndex,
                );
                computedProperties[key] = { type: "function", value };
              }
            }
          }
        });
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return computedProperties;
}

function extractDataProperties(tree, content) {
  const dataProperties = {};

  function traverse(node) {
    // Look for method_definition nodes where the name is "data"
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      const bodyNode = node.namedChildren.find(
        (child) => child.type === "statement_block",
      );

      if (nameNode && nameNode.text === "data" && bodyNode) {
        // Find the return statement in the data method
        const returnStatement = findReturnStatement(bodyNode);
        if (returnStatement && returnStatement.namedChildren.length > 0) {
          const returnValue = returnStatement.namedChildren[0]; // The argument to return
          if (returnValue && returnValue.type === "object") {
            // Extract properties from the return object
            returnValue.namedChildren.forEach((prop) => {
              if (prop.type === "pair") {
                const propKey = prop.namedChildren[0];
                const propValue = prop.namedChildren[1];
                if (propKey && propValue) {
                  const key = propKey.text.replace(/["']/g, ""); // Remove quotes if present
                  const value = content.slice(
                    propValue.startIndex,
                    propValue.endIndex,
                  );
                  dataProperties[key] = value;
                }
              }
            });
          }
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return dataProperties;
}

function extractMethodsAndFetch(tree, content) {
  const regularMethods = {};
  let fetchMethod = null;

  // Find computed property method names to exclude
  const computedMethodNames = new Set();
  const watchMethodNames = new Set();

  function findComputedMethods(node) {
    if (node.type === "pair") {
      const keyNode = node.namedChildren[0];
      const valueNode = node.namedChildren[1];

      if (
        keyNode &&
        keyNode.text === "computed" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        valueNode.namedChildren.forEach((prop) => {
          if (prop.type === "pair") {
            const propValue = prop.namedChildren[1];
            if (propValue && propValue.type === "object") {
              // This is a getter/setter computed property, collect method names
              propValue.namedChildren.forEach((method) => {
                if (method.type === "method_definition") {
                  const methodName = method.namedChildren.find(
                    (child) => child.type === "property_identifier",
                  );
                  if (methodName) {
                    computedMethodNames.add(methodName.text);
                  }
                }
              });
            }
          }
        });
      }

      // Also exclude watch methods
      if (
        keyNode &&
        keyNode.text === "watch" &&
        valueNode &&
        valueNode.type === "object"
      ) {
        valueNode.namedChildren.forEach((prop) => {
          if (prop.type === "pair") {
            const propKey = prop.namedChildren[0];
            if (propKey) {
              const watchName = propKey.text.replace(/[\"']/g, "");
              watchMethodNames.add(watchName);
            }
          } else if (prop.type === "method_definition") {
            const propKey = prop.namedChildren[0];
            if (propKey) {
              const watchName = propKey.text.replace(/[\"']/g, "");
              watchMethodNames.add(watchName);
            }
          }
        });
      }
    }
    node.namedChildren.forEach((child) => findComputedMethods(child));
  }

  findComputedMethods(tree.rootNode);

  function traverse(node) {
    // Look for method_definition nodes
    if (node.type === "method_definition") {
      const nameNode = node.namedChildren.find(
        (child) => child.type === "property_identifier",
      );
      const bodyNode = node.namedChildren.find(
        (child) => child.type === "statement_block",
      );

      if (
        nameNode &&
        bodyNode &&
        nameNode.text !== "data" &&
        nameNode.text !== "head" &&
        nameNode.text !== "asyncData" &&
        !isLifecycleMethod(nameNode.text) &&
        !computedMethodNames.has(nameNode.text) &&
        !watchMethodNames.has(nameNode.text)
      ) {
        const methodName = nameNode.text;
        const methodContent = content.slice(
          bodyNode.startIndex,
          bodyNode.endIndex,
        );

        // Check if method is async by looking at the full method definition
        const fullMethodDef = content.slice(node.startIndex, node.endIndex);
        const isAsync = fullMethodDef.includes("async ");

        // Special handling for Nuxt fetch method
        if (methodName === "fetch") {
          fetchMethod = methodContent;
        } else {
          regularMethods[methodName] = {
            content: methodContent,
            isAsync: isAsync,
          };
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return { regularMethods, fetchMethod };
}

function findReturnStatement(functionNode) {
  function search(node) {
    if (node.type === "return_statement") {
      return node;
    }
    for (const child of node.namedChildren) {
      const result = search(child);
      if (result) return result;
    }
    return null;
  }

  return search(functionNode);
}

function transformToCompositionAPI(
  dataProperties,
  regularMethods,
  fetchMethod,
  i18nMethods,
  hasAxios,
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
  refsData,
  hasConfig,
  hasNextTick,
  routerData,
  nuxtI18nData,
  hasDirectStoreUsage,
  options,
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
  const customI18nMethods = new Set(["localeProperties", "localePath"]);

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

  // Add store imports for direct store usage
  if (hasDirectStoreUsage && options?.vuex) {
    Object.entries(options.vuex).forEach(([namespace, storeConfig]) => {
      // Only add if not already added by vuexData
      if (!vuexData?.usedStores.has(namespace)) {
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

  // Add i18n destructuring if needed (before data properties)
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

  // Add computed properties from Vuex mappers
  if (vuexData && vuexData.computedProps.length > 0) {
    vuexData.computedProps.forEach((mapData) => {
      Object.entries(mapData.mappings).forEach(([localName, storePath]) => {
        const storeConfig = options?.vuex?.[mapData.namespace];
        if (storeConfig) {
          const instanceName = getStoreInstanceName(storeConfig);
          if (mapData.type === "mapState") {
            result += `\nconst ${localName} = computed(() => ${instanceName}.${storePath});`;
          } else if (mapData.type === "mapGetters") {
            // For getters, remove the namespace prefix from the path
            const getterName = storePath.replace(`${mapData.namespace}/`, "");
            result += `\nconst ${localName} = computed(() => ${instanceName}.${getterName}());`;
          }
        }
      });
    });
  }

  // Add props definition
  if (propsData) {
    result += `\nconst props = defineProps(${propsData});`;
  }

  // Add emits definition
  if (emitsData && emitsData.length > 0) {
    const emitsArray = emitsData.map((emit) => `'${emit}'`).join(", ");
    result += `\nconst emit = defineEmits([${emitsArray}]);`;
  }

  // Add config composable before data properties that might use it
  if (hasConfig) {
    result += `\nconst config = useRuntimeConfig();`;
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
        .replace(/this\.\$i18n\.localeProperties/g, "localeProperties")
        .replace(/this\.\$i18n\.locale/g, "locale.value")
        .replace(/this\.\$config/g, "config");
      result += `\nconst ${key} = ref(${transformedValue});`;
    }
  });

  // Add watchers after data properties
  if (watchData && Object.keys(watchData).length > 0) {
    Object.entries(watchData).forEach(([watchName, watchConfig]) => {
      if (watchConfig.type === "function") {
        // Extract parameters and body from function
        let functionContent = watchConfig.content;
        const paramsMatch = functionContent.match(/\(([^)]*)\)/);
        const params = paramsMatch ? paramsMatch[1] : "newVal, oldVal";

        // Extract function body
        const bodyMatch = functionContent.match(/\{([\s\S]*)\}$/);
        let body = bodyMatch ? bodyMatch[1].trim() : "";

        // Transform this references in watcher body
        body = transformMethodBody(
          body,
          hasAxios,
          hasEventBus,
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

        result += `\nwatch(${watchName}, (${params}) => {\n  ${body}\n});`;
      }
    });
  }

  // Add store instances for direct store usage (after data properties)
  if (hasDirectStoreUsage && options?.vuex) {
    Object.entries(options.vuex).forEach(([namespace, storeConfig]) => {
      // Only add if not already added by vuexData
      if (!vuexData?.usedStores.has(namespace)) {
        const instanceName = getStoreInstanceName(storeConfig);
        result += `\nconst ${instanceName} = ${storeConfig.importName}();`;
      }
    });
  }

  // Add computed properties
  if (computedData && Object.keys(computedData).length > 0) {
    Object.entries(computedData).forEach(([key, propData]) => {
      if (propData.type === "getterSetter") {
        let getterContent = propData.value.get || "{}";
        let setterContent = propData.value.set || "{}";

        // Transform this references in getter/setter using the same logic as methods
        // But preserve the braces since computed properties expect full function bodies
        getterContent = transformComputedFunction(
          getterContent,
          hasAxios,
          hasEventBus,
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
        setterContent = transformComputedFunction(
          setterContent,
          hasAxios,
          hasEventBus,
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

        result += `\nconst ${key} = computed({\n  get() ${getterContent},\n  set(v) ${setterContent}\n});`;
      } else if (propData.type === "function") {
        // Handle simple computed properties (not implemented in current test)
        let computedContent = propData.value;
        computedContent = transformComputedFunction(
          computedContent,
          hasAxios,
          hasEventBus,
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
        result += `\nconst ${key} = computed(${computedContent});`;
      }
    });
  }

  // Add asyncData transformation
  if (asyncDataMethod) {
    // Transform asyncData to useAsyncData call
    let asyncContent = asyncDataMethod.content;
    // Remove the opening and closing braces
    asyncContent = asyncContent.replace(/^\s*{\s*/, "").replace(/\s*}\s*$/, "");

    result += `\nconst data = await useAsyncData(async ${asyncDataMethod.parameters} => {\n${asyncContent}\n});`;

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
      result += `\nuseHead(${headContent});`;
    } else {
      // Complex case: useHead(() => { ... })
      let headContent = headMethod.content;
      headContent = transformThisReferencesToRefs(headContent);
      // Remove the opening and closing braces
      headContent = headContent.replace(/^\s*{\s*/, "").replace(/\s*}\s*$/, "");
      result += `\nuseHead(() => {\n${headContent}\n});`;
    }
  }

  // Add mixin destructuring (only for used imports)
  if (mixinData && mixinData.usedMixins.length > 0) {
    mixinData.usedMixins.forEach((mixin) => {
      // Filter imports to only include those used in template
      const usedImports = mixin.config.imports.filter((importName) =>
        templateVariables.has(importName),
      );

      if (usedImports.length > 0) {
        const imports = usedImports.join(", ");
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

  // Add router composables
  if (routerData && routerData.hasRouterUsage) {
    if (routerData.hasRoute) {
      result += `\nconst route = useRoute();`;
    }
    if (routerData.hasRouter) {
      result += `\nconst router = useRouter();`;
    }
  }

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

  // Add regular methods as arrow functions (before lifecycle methods)
  Object.entries(regularMethods).forEach(([methodName, methodData]) => {
    const methodBody =
      typeof methodData === "string" ? methodData : methodData.content;
    const isAsync = typeof methodData === "object" ? methodData.isAsync : false;

    let transformedBody = transformMethodBody(
      methodBody,
      hasAxios,
      hasEventBus,
      refsData,
      hasConfig,
      hasNextTick,
      routerData,
      null,
      regularMethods,
      dataProperties,
      computedData,
      propsData,
      vuexData,
      mixinData,
    );

    const asyncKeyword = isAsync ? "async " : "";

    // For event bus methods with parameters, use function declaration
    if (hasEventBus && methodBody.includes("data)")) {
      result += `\n${asyncKeyword}function ${methodName}(data) {\n${transformedBody}\n}`;
    } else {
      result += `\n\nconst ${methodName} = ${asyncKeyword}() => {\n${transformedBody}\n};`;
    }
  });

  // Add fetch method as arrow function if it exists
  if (fetchMethod) {
    let transformedFetchBody = transformMethodBody(
      fetchMethod,
      hasAxios,
      hasEventBus,
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
    result += `\nconst fetch = async () => {\n${transformedFetchBody}\n};`;
  }

  // Add lifecycle methods
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
      let transformedContent = transformMethodBody(
        lifecycleMethods.created,
        hasAxios,
        hasEventBus,
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
        transformedContent = transformStoreUsageInMethods(
          transformedContent,
          options,
        );
      }
      result += `\n\n${transformedContent}`;
    }

    // Handle other lifecycle methods
    Object.entries(lifecycleMethods).forEach(
      ([lifecycleName, methodContent]) => {
        if (lifecycleName === "created") return; // Already handled above

        const vueHookName = lifecycleMapping[lifecycleName];
        if (vueHookName) {
          let transformedContent = transformMethodBody(
            methodContent,
            hasAxios,
            hasEventBus,
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
            transformedContent = transformStoreUsageInMethods(
              transformedContent,
              options,
            );
          }

          // Special case for beforeDestroy -> merge with beforeUnmount
          if (lifecycleName === "beforeDestroy") {
            // Check if we already have onBeforeUnmount, if so merge content
            if (lifecycleMethods.beforeUnmount) {
              // Content will be merged when we process beforeUnmount
              return;
            } else {
              result += `\n\n${vueHookName}(() => {\n${transformedContent}\n});`;
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
                options,
              );
            }
            result += `\n\n${vueHookName}(() => {\n${transformedContent}\n});`;
          } else if (lifecycleName === "destroyed") {
            // Check if we already have unmounted, if so merge content
            if (lifecycleMethods.unmounted) {
              // Content will be merged when we process unmounted
              return;
            } else {
              result += `\n\n${vueHookName}(() => {\n${transformedContent}\n});`;
            }
          } else if (lifecycleName === "unmounted") {
            // Check if we have beforeDestroy to merge
            if (lifecycleMethods.beforeDestroy) {
              let beforeDestroyContent = transformMethodBody(
                lifecycleMethods.beforeDestroy,
                hasAxios,
                hasEventBus,
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
                  options,
                );
              }
              result += `\n\n${vueHookName}(() => {\n${transformedContent}\n\n${beforeDestroyContent}\n});`;
            } else {
              result += `\n\n${vueHookName}(() => {\n${transformedContent}\n});`;
            }
          } else {
            result += `\n\n${vueHookName}(() => {\n${transformedContent}\n});`;
          }
        }
      },
    );
  }

  // Execute fetch method if it exists
  if (fetchMethod) {
    result += `\n\nfetch();`;
  }

  return result;
}

function transformComputedFunction(
  functionContent,
  hasAxios,
  hasEventBus = false,
  refsData = null,
  hasConfig = false,
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
    refsData,
    hasConfig,
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

function transformMethodBody(
  methodBody,
  hasAxios,
  hasEventBus = false,
  refsData = null,
  hasConfig = false,
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
    .replace(/this\.\$i18n\.locale/g, "locale.value") // Replace this.$i18n.locale with locale.value
    .replace(/this\.\$i18n\.localeProperties/g, "localeProperties") // Replace this.$i18n.localeProperties with localeProperties
    .replace(/^\s*{\s*/, "") // Remove opening brace and whitespace
    .replace(/\s*}\s*$/, ""); // Remove closing brace and whitespace

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
        return `${indent}// FIXME: undefined variable '${propName}'\n${indent}// ${trimmedLine}`;
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
  transformedBody = transformedBody.replace(/this\.\$fetch\(\)/g, "fetch()");

  // Replace nextTick usage before generic method transformations
  if (hasNextTick) {
    transformedBody = transformedBody.replace(/this\.\$nextTick/g, "nextTick");
  }

  // Replace this.methodName calls with appropriate transformations FIRST (before property transformations)
  if (options?.vuex) {
    // For Vuex scenarios, check if method might be a store method
    Object.entries(options.vuex).forEach(([namespace, config]) => {
      const instanceName = getStoreInstanceName(config);
      // Transform specific known store methods
      transformedBody = transformedBody.replace(
        new RegExp(`this\\.(\\w+)\\(`, "g"),
        (match, methodName) => {
          // For now, assume store methods for Vuex components
          return `${instanceName}.${methodName}(`;
        },
      );
    });
  } else {
    // Replace this.methodName calls with just methodName for non-Vuex scenarios
    transformedBody = transformedBody.replace(
      /this\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g,
      "$1(",
    );
  }

  // Replace Nuxt event bus usage
  if (hasEventBus) {
    transformedBody = transformedBody
      .replace(/this\.\$nuxt\.\$on/g, "eventBus.on") // Replace this.$nuxt.$on with eventBus.on
      .replace(/this\.\$nuxt\.\$off/g, "eventBus.off") // Replace this.$nuxt.$off with eventBus.off
      .replace(/this\.\$nuxt\.\$emit/g, "eventBus.emit") // Replace this.$nuxt.$emit with eventBus.emit
      .replace(/this\.(\w+)/g, "$1"); // Replace this.methodName with methodName
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

  return transformedBody;
}

function transformThisReferencesToRefs(content) {
  // Transform this.$i18n.locale and this.$i18n.localeProperties first
  let transformed = content
    .replace(/this\.\$i18n\.locale/g, "locale.value")
    .replace(/this\.\$i18n\.localeProperties/g, "localeProperties");

  // Transform this.property to property.value
  return transformed.replace(/this\.(\w+)/g, "$1.value");
}

function transformStoreUsageInMethods(methodBody, options) {
  let transformedBody = methodBody;

  if (options?.vuex) {
    Object.entries(options.vuex).forEach(([namespace, config]) => {
      const instanceName = getStoreInstanceName(config);

      // Transform this.$store.state.namespace.property to property.value
      const stateRegex = new RegExp(
        `this\\.\\$store\\.state\\.${namespace}\\.(\\w+)`,
        "g",
      );
      transformedBody = transformedBody.replace(stateRegex, "$1.value");

      // Transform method calls (actions/mutations)
      const methodRegex = new RegExp(`this\\.(\\w+)\\(`, "g");
      transformedBody = transformedBody.replace(
        methodRegex,
        `${instanceName}.$1(`,
      );
    });
  }

  return transformedBody;
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

function extractEmits(tree, content) {
  const emits = new Set();

  function traverse(node) {
    // Look for this.$emit calls
    if (node.type === "call_expression") {
      const calleeNode = node.namedChildren[0];
      if (calleeNode && calleeNode.type === "member_expression") {
        const objectNode = calleeNode.namedChildren[0];
        const propertyNode = calleeNode.namedChildren[1];

        if (
          objectNode &&
          objectNode.text === "this" &&
          propertyNode &&
          propertyNode.text === "$emit"
        ) {
          // Extract the event name from the first argument
          const argumentsNode = node.namedChildren[1];
          if (argumentsNode && argumentsNode.namedChildren.length > 0) {
            const eventNameNode = argumentsNode.namedChildren[0];
            if (eventNameNode && eventNameNode.type === "string") {
              let eventName = eventNameNode.text.replace(/['"]/g, "");

              // Transform 'input' events to 'update:value' for v-model compatibility
              if (eventName === "input") {
                eventName = "update:value";
              }

              emits.add(eventName);
            }
          }
        }
      }
    }

    // Recursively traverse children
    node.namedChildren.forEach((child) => traverse(child));
  }

  traverse(tree.rootNode);
  return Array.from(emits);
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

// ...existing code...
export { rewriteSFC };
