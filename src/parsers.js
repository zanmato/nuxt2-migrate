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

  // For mapGetters, analyze the original code to see if each getter is called as a function
  const functionUsage = {};
  if (mapFunction === "mapGetters") {
    Object.entries(mappings).forEach(([localName, storePath]) => {
      // Extract the actual getter name from the path
      let getterName = storePath;
      if (typeof storePath === "string" && storePath.includes("/")) {
        getterName = storePath.split("/")[1];
      }

      // Use naming convention: getters starting with 'get' should be called as functions
      // This is a reliable approach that works well with Vuex/Pinia conventions
      functionUsage[localName] = getterName.startsWith("get");
    });
  }

  // Store the mapping information
  const mapData = {
    type: mapFunction,
    namespace,
    mappings,
    category: type,
    functionUsage, // Add function usage information
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

  // Also track stores from embedded namespaces in mappings
  Object.values(mappings).forEach((value) => {
    if (typeof value === "string" && value.includes("/")) {
      const embeddedNamespace = value.split("/")[0];

      // Always add the store, creating a default configuration if needed
      vuexData.usedStores.add(embeddedNamespace);

      // Create default store configuration if not provided
      if (!options.vuex) {
        options.vuex = {};
      }
      if (!options.vuex[embeddedNamespace]) {
        const capitalizedName =
          embeddedNamespace.charAt(0).toUpperCase() +
          embeddedNamespace.slice(1);
        options.vuex[embeddedNamespace] = {
          name: embeddedNamespace,
          importName: `use${capitalizedName}Store`,
        };
      }
    }
  });
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

export {
  parseComputedProperties,
  parseMethodProperties,
  parseMapFunction,
  parseObjectMappings,
  parseArrayMappings,
};
