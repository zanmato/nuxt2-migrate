#!/usr/bin/env node

import { readFile, writeFile } from "fs/promises";
import { resolve, extname } from "path";
import { rewriteSFC } from "./src/index.js";

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
Usage: node cli.js <input-file> [options]

Transform Vue 2 SFC to Vue 3 Composition API

Arguments:
  input-file    Path to the Vue SFC file to transform

Options:
  -o, --output <file>    Output file path (default: overwrites input file)
  -h, --help            Show this help message

Examples:
  node cli.js components/MyComponent.vue
  node cli.js components/MyComponent.vue -o components/MyComponent.new.vue
`);
}

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      showHelp();
      process.exit(0);
    } else if (arg === "-o" || arg === "--output") {
      if (i + 1 >= args.length) {
        console.error("Error: Output option requires a file path");
        process.exit(1);
      }
      options.output = args[++i];
    } else if (!options.input && !arg.startsWith("-")) {
      options.input = arg;
    } else {
      console.error(`Error: Unknown option or extra argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!options.input) {
    console.error("Error: Input file is required");
    showHelp();
    process.exit(1);
  }

  // If no output specified, overwrite the input file
  if (!options.output) {
    options.output = options.input;
  }

  return options;
}

async function transformFile(inputPath, outputPath) {
  try {
    // Resolve absolute paths
    const resolvedInput = resolve(inputPath);
    const resolvedOutput = resolve(outputPath);

    // Check if input file has .vue extension
    if (extname(resolvedInput) !== ".vue") {
      console.warn("Warning: Input file does not have a .vue extension");
    }

    console.log(`Reading file: ${resolvedInput}`);

    // Read the input file
    const content = await readFile(resolvedInput, "utf8");

    console.log("Transforming Vue component...");

    // Transform the content using rewriteSFC
    const transformed = await rewriteSFC(content);

    console.log(`Writing transformed content to: ${resolvedOutput}`);

    // Write the transformed content
    await writeFile(resolvedOutput, transformed, "utf8");

    if (resolvedInput === resolvedOutput) {
      console.log(
        "✅ File transformed successfully (original file overwritten)"
      );
    } else {
      console.log("✅ File transformed successfully");
    }
  } catch (error) {
    console.error("❌ Error transforming file:", error.message);

    if (error.code === "ENOENT") {
      console.error("File not found. Please check the input path.");
    } else if (error.code === "EACCES") {
      console.error("Permission denied. Please check file permissions.");
    }

    process.exit(1);
  }
}

async function main() {
  try {
    const options = parseArgs(args);
    await transformFile(options.input, options.output);
  } catch (error) {
    console.error("❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
