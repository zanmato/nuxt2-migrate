import { parseComputedProperties, parseMethodProperties } from "./parsers.js";

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

function extractRefsUsage(scriptContent, templateContent) {
  // Extract refs from template
  const templateRefs = new Set();
  const refMatches = templateContent.match(/\sref="([^"]+)"/g);
  if (refMatches) {
    refMatches.forEach((match) => {
      const refName = match.match(/\sref="([^"]+)"/)?.[1];
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
        // Replace ~ with @ in import path
        const importPath = sourceNode.text
          .replace(/['"]/g, "")
          .replace(/^~\//g, "@/");
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
          } else if (prop.type === "method_definition") {
            // Handle computed properties defined with method syntax: thumbURL() { ... }
            const methodName = prop.namedChildren.find(
              (child) => child.type === "property_identifier",
            );
            const methodBody = prop.namedChildren.find(
              (child) => child.type === "statement_block",
            );

            if (methodName && methodBody) {
              const key = methodName.text;
              const value = content.slice(
                methodBody.startIndex,
                methodBody.endIndex,
              );
              computedProperties[key] = { type: "function", value };
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
            const propKey = prop.namedChildren[0];
            const propValue = prop.namedChildren[1];

            if (propKey && propValue) {
              const key = propKey.text.replace(/["']/g, "");

              if (propValue.type === "object") {
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
              } else {
                // This is a simple computed property function
                computedMethodNames.add(key);
              }
            }
          } else if (prop.type === "method_definition") {
            // Handle computed properties defined with method syntax: thumbURL() { ... }
            const methodName = prop.namedChildren.find(
              (child) => child.type === "property_identifier",
            );
            if (methodName) {
              computedMethodNames.add(methodName.text);
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
      const paramsNode = node.namedChildren.find(
        (child) => child.type === "formal_parameters",
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

        // Extract parameters if they exist
        const parameters = paramsNode
          ? content.slice(paramsNode.startIndex, paramsNode.endIndex)
          : "()";

        // Check if method is async by looking at the full method definition
        const fullMethodDef = content.slice(node.startIndex, node.endIndex);
        const isAsync = fullMethodDef.includes("async ");

        // Special handling for Nuxt fetch method
        if (methodName === "fetch") {
          fetchMethod = methodContent;
        } else {
          regularMethods[methodName] = {
            content: methodContent,
            parameters: parameters,
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

function detectAxiosUsage(content) {
  return content.includes("$axios");
}

function detectFiltersUsage(content) {
  return content.includes("$options.filters");
}

function detectEventBusUsage(content) {
  return (
    content.includes("$nuxt.$on") ||
    content.includes("$nuxt.$off") ||
    content.includes("$nuxt.$emit")
  );
}

function detectNuxtCompatUsage(content) {
  return (
    content.includes("$nuxt.refresh") ||
    content.includes("$nuxt.context.redirect")
  );
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

export {
  extractRefsUsage,
  extractMixinData,
  extractNuxtI18nData,
  extractVuexData,
  extractImportRewriteData,
  extractHeadMethod,
  extractAsyncDataMethod,
  extractReturnProperties,
  extractLifecycleMethods,
  extractWatchers,
  extractProps,
  extractComputedProperties,
  extractDataProperties,
  extractMethodsAndFetch,
  extractEmits,
  extractVariablesFromExpression,
  extractI18nUsage,
  detectAxiosUsage,
  detectFiltersUsage,
  detectEventBusUsage,
  detectNuxtCompatUsage,
  detectConfigUsage,
  detectNextTickUsage,
  detectRouterUsage,
  detectDirectStoreUsage,
};
