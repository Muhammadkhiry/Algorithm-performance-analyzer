require("dotenv").config();
const express = require("express");
const cors = require("cors");
const acorn = require("acorn");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/**
 * Creates a shallow copy of an array.
 * @param {Array} arr - The array to clone.
 * @returns {Array} A new array containing the same elements.
 */
function clone(arr) {
  return arr.slice();
}

/**
 * Measures the execution time of a function in milliseconds.
 * @param {Function} fn - The function to measure.
 * @param {Array} arr - The input array to pass to the function.
 * @returns {number|null} The execution time in milliseconds, or null if an error occurs.
 */
function measure(fn, arr) {
  try {
    const start = process.hrtime.bigint();
    fn(arr);
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e6;
  } catch {
    return null;
  }
}

const BASE_SIZES = [600, 1200, 1800, 2400, 3000, 10000];
const RECURSIVE_DIVIDE_SIZES = [1200, 2400, 4800, 9600, 19200];

/**
 * Benchmarks the provided code snippet against arrays of varying sizes.
 * Collects execution times for sorted, reversed, and random array inputs.
 * @param {string} code - The JavaScript code string to benchmark.
 * @param {Object|null} ast - The AST analysis result.
 * @returns {Object} Benchmark data or a compileError flag.
 */
function benchmark(code, ast = null) {
  let userFn;
  try {
    userFn = new Function("arr", `"use strict"; return (${code})(arr);`);
  } catch {
    return {
      sortedData: [],
      reversedData: [],
      randomData: [],
      compileError: true,
    };
  }

  try {
    userFn([5, 3, 1, 4, 2]);
  } catch { }

  const sortedData = [];
  const reversedData = [];
  const randomData = [];
  const sizes =
    ast && ast.recursion && ast.divide ? RECURSIVE_DIVIDE_SIZES : BASE_SIZES;

  for (const n of sizes) {
    const sorted = Array.from({ length: n }, (_, i) => i);
    const reversed = Array.from({ length: n }, (_, i) => n - i);
    const random = [...sorted].sort(() => Math.random() - 0.5);

    const measureCase = (arr) => {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t = measure(userFn, clone(arr));
        if (t !== null && Number.isFinite(t)) {
          samples.push(t);
        }
      }
      if (!samples.length) return null;
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)];
    };

    const tSorted = measureCase(sorted);
    if (tSorted !== null) sortedData.push({ n, t: tSorted });

    const tReversed = measureCase(reversed);
    if (tReversed !== null) reversedData.push({ n, t: tReversed });

    const tRandom = measureCase(random);
    if (tRandom !== null) randomData.push({ n, t: tRandom });
  }

  return { sortedData, reversedData, randomData, compileError: false };
}

/**
 * Executes the provided algorithm against a caller-provided input array.
 * Used by manual mode where the client controls the exact input.
 * @param {string} code - The JavaScript code string to execute.
 * @param {Array} inputArray - The input array provided by the client.
 * @returns {Object} Execution result metadata.
 */
function runManual(code, inputArray) {
  let userFn;
  try {
    userFn = new Function("arr", `"use strict"; return (${code})(arr);`);
  } catch {
    return { compileError: true };
  }

  const safeInput = clone(inputArray);
  let output;
  try {
    output = userFn(clone(safeInput));
  } catch {
    return { compileError: false, runtimeError: true };
  }

  const t = measure(userFn, clone(safeInput));
  return {
    compileError: false,
    runtimeError: false,
    output,
    executionTimeMs: t,
    inputLength: safeInput.length,
  };
}

/**
 * Analyzes the Abstract Syntax Tree (AST) of the provided code to extract structural metrics.
 * @param {string} code - The JavaScript code string to analyze.
 * @returns {Object} An object containing the extracted AST metrics.
 */
function analyzeAST(code) {
  const empty = {
    loops: 0,
    maxLoopDepth: 0,
    forLoops: 0,
    whileLoops: 0,
    doWhileLoops: 0,
    logarithmicLoops: 0,
    constantBoundedLoops: 0,
    higherOrderLoops: 0,
    nestedHigherOrderLoops: 0,
    hasInfiniteLoop: false,
    recursion: false,
    recursiveCalls: 0,
    divide: false,
    hasBinarySearch: false,
    hasBreak: false,
    hasPivotTrap: false,
    hasPivotTrapLast: false,
  };

  let tree;
  try {
    tree = acorn.parse(`(${code})`, { ecmaVersion: 2020 });
  } catch {
    return empty;
  }

  let loops = 0;
  let maxLoopDepth = 0;
  let forLoops = 0;
  let whileLoops = 0;
  let doWhileLoops = 0;
  let logarithmicLoops = 0;
  let constantBoundedLoops = 0;
  let higherOrderLoops = 0;
  let nestedHigherOrderLoops = 0;
  let hasInfiniteLoop = false;
  let recursion = false;
  let recursiveCalls = 0;
  let divide = false;
  let hasBinarySearch = false;
  let hasBreak = false;
  let hasPivotTrap = false;
  let hasPivotTrapLast = false;

  const higherOrderNames = [
    "map",
    "filter",
    "reduce",
    "forEach",
    "find",
    "some",
    "every",
  ];

  // Simple string-based heuristics for pivot traps in quicksort
  const compactCode = code.replace(/\s+/g, "");
  if (
    /\bpivot\b/i.test(code) &&
    (compactCode.includes("arr[0]") || compactCode.includes("slice(1)"))
  ) {
    hasPivotTrap = true;
  }
  if (
    /\bpivot\b/i.test(code) &&
    (compactCode.includes("arr[arr.length-1]") ||
      compactCode.includes("arr[arr.length - 1]") ||
      compactCode.includes("arr.length-1"))
  ) {
    hasPivotTrapLast = true;
  }

  const rootExpr = tree.body?.[0]?.expression || null;
  const rootFn =
    rootExpr &&
      [
        "FunctionExpression",
        "FunctionDeclaration",
        "ArrowFunctionExpression",
      ].includes(rootExpr.type)
      ? rootExpr
      : null;
  const rootFunctionName = rootFn?.id?.name || null;

  /**
   * Checks if an AST node represents a statically truthy expression (e.g., 'true', '1', '!false').
   * Used to detect potential infinite loops like `while (true)`.
   */
  function isStaticTruthyExpression(node) {
    if (!node) return false;

    if (node.type === "Literal") {
      return Boolean(node.value);
    }

    if (node.type === "UnaryExpression") {
      if (node.operator === "!")
        return !isStaticTruthyExpression(node.argument);
      if (node.operator === "+") return isStaticTruthyExpression(node.argument);
      if (node.operator === "-") return isStaticTruthyExpression(node.argument);
      return false;
    }

    if (node.type === "LogicalExpression") {
      if (node.operator === "&&") {
        return (
          isStaticTruthyExpression(node.left) &&
          isStaticTruthyExpression(node.right)
        );
      }
      if (node.operator === "||") {
        return (
          isStaticTruthyExpression(node.left) ||
          isStaticTruthyExpression(node.right)
        );
      }
      return false;
    }

    if (node.type === "BinaryExpression") {
      const leftIsLiteral = node.left?.type === "Literal";
      const rightIsLiteral = node.right?.type === "Literal";
      if (!leftIsLiteral || !rightIsLiteral) return false;

      switch (node.operator) {
        case "==":
        case "===":
          return node.left.value === node.right.value;
        case "!=":
        case "!==":
          return node.left.value !== node.right.value;
        case ">":
          return node.left.value > node.right.value;
        case ">=":
          return node.left.value >= node.right.value;
        case "<":
          return node.left.value < node.right.value;
        case "<=":
          return node.left.value <= node.right.value;
        default:
          return false;
      }
    }

    return false;
  }

  /**
   * Retrieves the index variable name from a ForStatement node.
   * @param {Object} node - The AST node to inspect.
   * @returns {string|null} The name of the index variable, or null if not found.
   */
  function getForLoopIndexName(node) {
    if (!node || node.type !== "ForStatement") return null;

    if (node.init?.type === "VariableDeclaration") {
      const decl = node.init.declarations?.[0];
      if (decl?.id?.type === "Identifier") return decl.id.name;
    }

    if (
      node.init?.type === "AssignmentExpression" &&
      node.init.left?.type === "Identifier"
    ) {
      return node.init.left.name;
    }

    return null;
  }

  function isLiteralGreaterThanOne(node) {
    return (
      node?.type === "Literal" &&
      typeof node.value === "number" &&
      node.value > 1
    );
  }

  function isConstantBoundedForLoop(node, indexName) {
    if (!node || node.type !== "ForStatement") return false;
    if (!indexName) return false;

    const test = node.test;
    if (!test || test.type !== "BinaryExpression") return false;
    if (test.left?.type !== "Identifier" || test.left.name !== indexName)
      return false;

    const right = test.right;
    if (!right) return false;

    if (isLiteralGreaterThanOne(right)) {
      return true;
    }

    if (right.type === "BinaryExpression") {
      if (
        isLiteralGreaterThanOne(right.left) ||
        isLiteralGreaterThanOne(right.right)
      ) {
        return true;
      }
    }

    return false;
  }

  function isLogarithmicForLoop(node, indexName) {
    if (!node || node.type !== "ForStatement") return false;
    if (!indexName) return false;

    const update = node.update;
    if (!update || update.type !== "AssignmentExpression") return false;
    if (update.left?.type !== "Identifier" || update.left.name !== indexName) {
      return false;
    }

    if (["*=", "/=", "<<=", ">>="].includes(update.operator)) {
      return isLiteralGreaterThanOne(update.right);
    }

    if (update.operator !== "=") return false;

    const expression = update.right;
    if (!expression || expression.type !== "BinaryExpression") return false;
    if (
      expression.left?.type !== "Identifier" ||
      expression.left.name !== indexName
    ) {
      return false;
    }

    return (
      ["*", "/", "<<", ">>"].includes(expression.operator) &&
      isLiteralGreaterThanOne(expression.right)
    );
  }

  function isHigherOrderCall(node) {
    return (
      node?.type === "CallExpression" &&
      higherOrderNames.includes(node.callee?.property?.name)
    );
  }

  /**
   * Recursively walks the AST to gather metrics on loops, recursion, and specific operations.
   */
  function walk(
    node,
    inRoot = false,
    currentFnName = null,
    loopDepth = 0,
    hofDepth = 0,
  ) {
    if (!node || typeof node !== "object") return;

    const isFunctionNode =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";

    if (isFunctionNode) {
      inRoot = true;
      currentFnName = node.id?.name || currentFnName;
    }

    // Track loop counts and depth
    if (node.type === "ForStatement") {
      loops++;
      forLoops++;
      loopDepth += 1;
      if (loopDepth > maxLoopDepth) {
        maxLoopDepth = loopDepth;
      }

      const indexName = getForLoopIndexName(node);
      if (isConstantBoundedForLoop(node, indexName)) {
        constantBoundedLoops++;
      }
      if (isLogarithmicForLoop(node, indexName)) {
        logarithmicLoops++;
      }
    }

    if (node.type === "WhileStatement") {
      loops++;
      whileLoops++;
      loopDepth += 1;
      if (loopDepth > maxLoopDepth) {
        maxLoopDepth = loopDepth;
      }

      if (isStaticTruthyExpression(node.test)) {
        hasInfiniteLoop = true;
      }
    }

    if (node.type === "DoWhileStatement") {
      loops++;
      doWhileLoops++;
      loopDepth += 1;
      if (loopDepth > maxLoopDepth) {
        maxLoopDepth = loopDepth;
      }

      if (isStaticTruthyExpression(node.test)) {
        hasInfiniteLoop = true;
      }
    }

    if (
      node.type === "WhileStatement" &&
      node.test &&
      node.test.type === "Literal" &&
      (node.test.value === true || node.test.value === 1)
    ) {
      hasInfiniteLoop = true;
    }

    if (
      node.type === "ForStatement" &&
      node.init === null &&
      node.test === null &&
      node.update === null
    ) {
      hasInfiniteLoop = true;
    }

    if (
      node.type === "DoWhileStatement" &&
      node.test &&
      node.test.type === "Literal" &&
      (node.test.value === true || node.test.value === 1)
    ) {
      hasInfiniteLoop = true;
    }

    if (node.type === "BreakStatement") {
      hasBreak = true;
    }

    if (node.type === "CallExpression") {
      const funcName = node.callee?.property?.name;

      if (
        inRoot &&
        currentFnName &&
        node.callee?.type === "Identifier" &&
        node.callee.name === currentFnName
      ) {
        recursion = true;
        recursiveCalls++;
      }

      if (funcName === "slice") {
        divide = true;
      }

      if (higherOrderNames.includes(funcName)) {
        loops++;
        higherOrderLoops++;
        if (hofDepth > 0) {
          nestedHigherOrderLoops++;
        }
      }
    }

    if (["BinaryExpression", "AssignmentExpression"].includes(node.type)) {
      if (["/", "/=", ">>", ">>="].includes(node.operator)) {
        hasBinarySearch = true;
      }
    }

    const higherOrderCall = isHigherOrderCall(node);
    for (const k in node) {
      const child = node[k];
      if (Array.isArray(child)) {
        child.forEach((c) => {
          const childHofDepth =
            higherOrderCall &&
              k === "arguments" &&
              (c?.type === "ArrowFunctionExpression" ||
                c?.type === "FunctionExpression")
              ? hofDepth + 1
              : hofDepth;
          walk(c, inRoot, currentFnName, loopDepth, childHofDepth);
        });
      } else {
        walk(child, inRoot, currentFnName, loopDepth, hofDepth);
      }
    }
  }

  if (rootFn) {
    walk(rootFn, true, rootFunctionName);
  } else {
    walk(tree, false, null);
  }

  return {
    loops,
    maxLoopDepth,
    forLoops,
    whileLoops,
    doWhileLoops,
    logarithmicLoops,
    constantBoundedLoops,
    higherOrderLoops,
    nestedHigherOrderLoops,
    hasInfiniteLoop,
    recursion,
    recursiveCalls,
    divide,
    hasBinarySearch,
    hasBreak,
    hasPivotTrap,
    hasPivotTrapLast,
  };
}

/**
 * Performs linear regression on logarithmically scaled execution times to estimate the power of n.
 * T(n) = c * n^k  =>  log(T(n)) = log(c) + k * log(n)
 * @param {Array} data - Array of data points with 'n' (input size) and the specified key (time).
 * @param {string} key - The property name in the data points representing execution time.
 * @returns {Object} An object containing the estimated slope 'k' and the R-squared value.
 */
function regression(data, key) {
  if (!Array.isArray(data) || data.length < 2) return { k: 0 };

  const xs = data.map((d) => Math.log(d.n));
  const ys = data.map((d) => Math.log(Math.max(d[key], 1e-9)));
  const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
  const ym = ys.reduce((a, b) => a + b, 0) / ys.length;

  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xm;
    num += dx * (ys[i] - ym);
    den += dx * dx;
  }

  const k = den ? num / den : 0;

  // Calculate R-squared to measure goodness of fit
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < ys.length; i++) {
    const yPred = k * xs[i] + (ym - k * xm);
    ssRes += Math.pow(ys[i] - yPred, 2);
    ssTot += Math.pow(ys[i] - ym, 2);
  }
  const rSquared = ssTot ? 1 - ssRes / ssTot : 0;

  return { k, rSquared };
}

/**
 * Classifies the time complexity of the algorithm based on AST features and the estimated regression slope.
 * @param {Object} ast - The AST analysis result.
 * @param {number} regK - The estimated regression slope (k in O(n^k)).
 * @returns {string} The Big-O time complexity classification.
 */
function classify(ast, regK) {
  // O(1) cases
  if (ast.hasBreak && ast.loops === 1 && !ast.recursion) {
    return "O(1)";
  }
  if (ast.loops === 0 && !ast.recursion) {
    return "O(1)";
  }

  // Logarithmic and linear-logarithmic cases
  if (
    !ast.recursion &&
    ast.loops > 0 &&
    ast.forLoops > 0 &&
    ast.constantBoundedLoops === ast.forLoops &&
    ast.whileLoops === 0 &&
    ast.doWhileLoops === 0
  ) {
    return "O(1)";
  }

  if (!ast.recursion && ast.loops === 1 && ast.logarithmicLoops >= 1) {
    return "O(log n)";
  }

  if (ast.hasBinarySearch && !ast.divide && ast.loops <= 1 && regK < 0.9) {
    return "O(log n)";
  }

  if (!ast.recursion && ast.nestedHigherOrderLoops > 0) {
    return "O(n^2)";
  }

  if (
    !ast.recursion &&
    ast.higherOrderLoops > 0 &&
    ast.loops === ast.higherOrderLoops
  ) {
    return "O(n)";
  }

  if (ast.recursion && ast.hasPivotTrap) {
    if (regK >= 0.9) return "O(n^2)";
    return "O(n log n)";
  }

  if (ast.recursion && ast.hasPivotTrapLast) {
    if (regK >= 0.9) return "O(n^2)";
    return "O(n log n)";
  }

  if (ast.recursion && ast.divide) {
    if (regK >= 1.6) return "O(n^2)";
    return "O(n log n)";
  }

  // Polynomial cases based on loop depths
  if (!ast.recursion && ast.maxLoopDepth >= 3) {
    return "O(n^k)";
  }

  if (!ast.recursion && ast.maxLoopDepth >= 2 && ast.hasBreak) {
    return regK < 0.5 ? "O(n)" : "O(n^2)";
  }

  if (!ast.recursion && ast.maxLoopDepth >= 2 && !ast.hasBreak) {
    return regK < 0.5 ? "O(n)" : "O(n^2)";
  }

  if (!ast.recursion && ast.maxLoopDepth >= 2) {
    return "O(n^2)";
  }

  if (!ast.recursion && ast.loops >= 2 && ast.maxLoopDepth === 1) {
    return "O(n)";
  }

  // Linear case
  if (!ast.recursion && ast.loops === 1) {
    if (ast.hasBreak) return "O(1)";
    return "O(n)";
  }

  if (ast.recursion) {
    if (regK >= 1.6) return "O(n^2)";
    return "O(n log n)";
  }

  // Fallback classification based on regression slope
  return regK >= 2.35
    ? "O(n^k)"
    : regK >= 1.6
      ? "O(n^2)"
      : regK >= 0.9
        ? "O(n log n)"
        : regK >= 0.2
          ? "O(n)"
          : "O(1)";
}

// REST API endpoint to analyze code
app.post("/analyze", (req, res) => {
  const { code, mode = "auto", inputArray } = req.body;
  if (!code) return res.json({ error: "No code provided" });

  const normalizedMode = String(mode).toLowerCase();
  if (normalizedMode !== "auto" && normalizedMode !== "manual") {
    return res.json({
      error: "Invalid mode. Use 'auto' or 'manual'",
    });
  }

  if (normalizedMode === "manual" && !Array.isArray(inputArray)) {
    return res.json({
      error: "Manual mode requires inputArray (Array)",
    });
  }

  const ast = analyzeAST(code);

  if (ast.hasInfiniteLoop) {
    return res.json({
      error: "Potential infinite loop detected",
      debug: { ast },
    });
  }

  if (normalizedMode === "manual") {
    const manual = runManual(code, inputArray);

    if (manual.compileError) {
      return res.json({ error: "Invalid function code" });
    }

    if (manual.runtimeError) {
      return res.json({ error: "Runtime error while executing function" });
    }

    const bench = benchmark(code, ast);

    const kSorted = regression(bench.sortedData, "t").k;
    const kReversed = regression(bench.reversedData, "t").k;
    const kRandom = regression(bench.randomData, "t").k;

    const cases = [
      { type: "sorted", k: kSorted },
      { type: "random", k: kRandom },
      { type: "reversed", k: kReversed },
    ];

    cases.sort((a, b) => a.k - b.k);

    const bestCase = classify(ast, cases[0].k);
    const averageCase = classify(ast, cases[1].k);
    const worstCase = classify(ast, cases[2].k);

    return res.json({
      mode: "manual",

      output: manual.output,
      executionTimeMs: manual.executionTimeMs,
      inputLength: manual.inputLength,

      chart: {
        sorted: bench.sortedData,
        reversed: bench.reversedData,
        random: bench.randomData,
      },

      bestCase,
      averageCase,
      worstCase,

      debug: {
        slopes: {
          bestK: kSorted,
          avgK: kRandom,
          worstK: kReversed,
        },
      },
    });
  }

  const bench = benchmark(code, ast);

  if (bench.compileError) {
    return res.json({ error: "Invalid function code" });
  }

  // Calculate regression slope for each array arrangement
  const kSorted = regression(bench.sortedData, "t").k;
  const kReversed = regression(bench.reversedData, "t").k;
  const kRandom = regression(bench.randomData, "t").k;

  // Identify specific sorting algorithm patterns based on heuristics
  const bubblePattern =
    /arr\[j\]\s*>\s*arr\[j\s*\+\s*1\]/.test(code) &&
    /arr\[j\s*\+\s*1\]/.test(code);
  const isBubbleLike =
    !ast.recursion &&
    ast.maxLoopDepth >= 2 &&
    ast.forLoops >= 2 &&
    bubblePattern;
  const isInsertionLike =
    !ast.recursion &&
    ast.maxLoopDepth >= 2 &&
    ast.whileLoops >= 1 &&
    ast.forLoops >= 1;
  const isSelectionLike =
    !ast.recursion &&
    ast.maxLoopDepth >= 2 &&
    ast.forLoops >= 2 &&
    /\bminIdx\b|\bminIndex\b/.test(code);

  // Improved case selection logic
  const allK = [kSorted, kReversed, kRandom];
  const sortedSlopes = [...allK].sort((a, b) => a - b);

  // Check if slopes are very close (uniform complexity)
  const maxDiff = sortedSlopes[2] - sortedSlopes[0];

  let bestK, avgK, worstK;
  if (maxDiff < 0.2) {
    // Uniform complexity - all cases are similar
    const avgSlope = allK.reduce((a, b) => a + b, 0) / 3;
    bestK = avgSlope;
    avgK = avgSlope;
    worstK = avgSlope;
  } else {
    // Variable complexity
    bestK = sortedSlopes[0];
    avgK = sortedSlopes[1];
    worstK = sortedSlopes[2];
  }

  // Adjustments for specific algorithm traits
  if (ast.recursion && ast.hasPivotTrap) {
    bestK = kRandom;
    avgK = sortedSlopes[1];
    worstK = sortedSlopes[2];
  }

  if (ast.recursion && ast.hasPivotTrapLast) {
    bestK = kRandom;
    avgK = sortedSlopes[1];
    worstK = sortedSlopes[2];
  }

  if (isBubbleLike || isInsertionLike || isSelectionLike) {
    bestK = kSorted;
    avgK = kReversed;
    worstK = kRandom;
  }

  let bestCase = classify(ast, bestK);
  let averageCase = classify(ast, avgK);
  let worstCase = classify(ast, worstK);

  // Hardcode complexities for detected sorting algorithms
  if (bubblePattern) {
    if (ast.hasBreak) {
      bestCase = "O(n)";
      averageCase = "O(n^2)";
      worstCase = "O(n^2)";
    } else {
      bestCase = "O(n^2)";
      averageCase = "O(n^2)";
      worstCase = "O(n^2)";
    }
  }

  if (isInsertionLike) {
    bestCase = "O(n)";
    averageCase = "O(n^2)";
    worstCase = "O(n^2)";
  }

  if (isSelectionLike) {
    bestCase = "O(n^2)";
    averageCase = "O(n^2)";
    worstCase = "O(n^2)";
  }

  if (ast.recursion && (ast.hasPivotTrap || ast.hasPivotTrapLast)) {
    bestCase = "O(n log n)";
    averageCase = "O(n log n)";
    worstCase = "O(n^2)";
  }

  res.json({
    mode: "auto",
    bestCase,
    averageCase,
    worstCase,

    chart: {
      sorted: bench.sortedData,
      reversed: bench.reversedData,
      random: bench.randomData,
    },

    debug: {
      ast,
      slopes: { bestK, avgK, worstK },
      dataPoints: {
        sorted: bench.sortedData.length,
        reversed: bench.reversedData.length,
        random: bench.randomData.length,
      },
    },
  });
});

app.listen(5000, () => {
  console.log("PRODUCTION ENGINE STABLE - CRASH PROTECTED");
});
