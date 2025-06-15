#!/usr/bin/env node

import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { resolve, extname, join, dirname } from "path";
import { rewriteSFC } from "./src/index.js";

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
Usage: node cli.js <input-path> [options]

Transform Vue 2 SFC to Vue 3 Composition API

Arguments:
  input-path    Path to Vue SFC file or directory containing .vue files

Options:
  -c, --config <file>    Configuration JSON file path
  -o, --output <path>    Output file/directory path (default: overwrites input)
  -r, --recursive        Process directories recursively (default: true)
  -h, --help            Show this help message

Examples:
  node cli.js components/MyComponent.vue                    # Transform single file
  node cli.js components/ -c config.json                   # Transform with config
  node cli.js src/ -o dist/ -c migration-config.json       # Transform to different directory with config
`);
}

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    config: null,
    recursive: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      showHelp();
      process.exit(0);
    } else if (arg === "-c" || arg === "--config") {
      if (i + 1 >= args.length) {
        console.error("Error: Config option requires a file path");
        process.exit(1);
      }
      options.config = args[++i];
    } else if (arg === "-o" || arg === "--output") {
      if (i + 1 >= args.length) {
        console.error("Error: Output option requires a path");
        process.exit(1);
      }
      options.output = args[++i];
    } else if (arg === "-r" || arg === "--recursive") {
      options.recursive = true;
    } else if (!options.input && !arg.startsWith("-")) {
      options.input = arg;
    } else {
      console.error(`Error: Unknown option or extra argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!options.input) {
    console.error("Error: Input path is required");
    showHelp();
    process.exit(1);
  }

  // If no output specified, overwrite the input
  if (!options.output) {
    options.output = options.input;
  }

  return options;
}

async function findVueFiles(dirPath, recursive = true) {
  const vueFiles = [];
  
  try {
    const entries = await readdir(dirPath);
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stats = await stat(fullPath);
      
      if (stats.isDirectory() && recursive) {
        // Recursively search subdirectories
        const subFiles = await findVueFiles(fullPath, recursive);
        vueFiles.push(...subFiles);
      } else if (stats.isFile() && extname(entry) === '.vue') {
        vueFiles.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error.message);
  }
  
  return vueFiles;
}

async function loadConfig(configPath) {
  if (!configPath) {
    return null;
  }
  
  try {
    const resolvedConfigPath = resolve(configPath);
    const configContent = await readFile(resolvedConfigPath, "utf8");
    const config = JSON.parse(configContent);
    console.log(`📝 Loaded configuration from: ${resolvedConfigPath}`);
    return config;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: Configuration file not found: ${configPath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in configuration file: ${configPath}`);
      console.error(`JSON Error: ${error.message}`);
    } else {
      console.error(`Error loading configuration file: ${error.message}`);
    }
    process.exit(1);
  }
}

async function transformFile(inputPath, outputPath, config = null) {
  try {
    // Resolve absolute paths
    const resolvedInput = resolve(inputPath);
    const resolvedOutput = resolve(outputPath);

    console.log(`📄 Transforming: ${resolvedInput}`);

    // Read the input file
    const content = await readFile(resolvedInput, "utf8");

    // Transform the content using rewriteSFC
    const transformed = await rewriteSFC(content, config || {});

    // Ensure output directory exists
    const outputDir = dirname(resolvedOutput);
    await mkdir(outputDir, { recursive: true });

    // Write the transformed content
    await writeFile(resolvedOutput, transformed, "utf8");

    if (resolvedInput === resolvedOutput) {
      console.log("   ✅ Overwritten successfully");
    } else {
      console.log(`   ✅ Written to: ${resolvedOutput}`);
    }
    
    return true;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function processPath(inputPath, outputPath, config = null, recursive = true) {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  
  try {
    const inputStats = await stat(resolvedInput);
    
    if (inputStats.isFile()) {
      // Single file processing
      if (extname(resolvedInput) !== ".vue") {
        console.warn("Warning: Input file does not have a .vue extension");
      }
      
      const success = await transformFile(resolvedInput, resolvedOutput, config);
      return success ? 1 : 0;
    } else if (inputStats.isDirectory()) {
      // Directory processing
      console.log(`🔍 Searching for .vue files in: ${resolvedInput}`);
      
      const vueFiles = await findVueFiles(resolvedInput, recursive);
      
      if (vueFiles.length === 0) {
        console.log("No .vue files found in the specified directory.");
        return 0;
      }
      
      console.log(`Found ${vueFiles.length} .vue file(s)`);
      let successCount = 0;
      
      for (const vueFile of vueFiles) {
        // Calculate output path
        let outputFile;
        if (resolvedInput === resolvedOutput) {
          // Overwrite in place
          outputFile = vueFile;
        } else {
          // Map to output directory structure
          const relativePath = vueFile.substring(resolvedInput.length + 1);
          outputFile = join(resolvedOutput, relativePath);
        }
        
        const success = await transformFile(vueFile, outputFile, config);
        if (success) successCount++;
      }
      
      console.log(`\n📊 Summary: ${successCount}/${vueFiles.length} files transformed successfully`);
      return successCount;
    } else {
      console.error("Error: Input path is neither a file nor a directory");
      return 0;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error("Error: Path not found. Please check the input path.");
    } else if (error.code === "EACCES") {
      console.error("Error: Permission denied. Please check file permissions.");
    } else {
      console.error("Error:", error.message);
    }
    return 0;
  }
}

async function main() {
  try {
    const options = parseArgs(args);
    
    // Load configuration if provided
    const config = await loadConfig(options.config);
    
    const successCount = await processPath(options.input, options.output, config, options.recursive);
    
    if (successCount === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
