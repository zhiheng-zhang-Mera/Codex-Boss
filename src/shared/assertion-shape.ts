/**
 * Deterministic reading of a test file's assertion shapes.
 *
 * ## Why this reads source instead of asking a model
 *
 * `Update-Plan/Platform-Foundation/Phase-07-Semantic-Acceptance.md` §5 requires deterministic-first: the evidence that decides acceptance must be structured and
 * auditable, not a model's impression. The specific question this answers — *does this test exercise
 * anything that could fail?* — is answerable by reading the assertion sites, so it is answered by reading
 * them. The output is a list of `AssertionShape`s a reader can check against the file.
 *
 * ## What it is and is not
 *
 * It is a **lexical reader**, not a parser. It finds `expect(...)`-style assertion sites, reduces each
 * receiver to a literal shape, and stops. That is deliberately modest: the failure mode of a clever
 * heuristic here is a confident wrong answer about someone's test, whereas the failure mode of a modest
 * one is `unknown` — which the judgement already treats as non-discriminating, so an unreadable
 * assertion can never be counted as evidence. Fail-closed by construction.
 */

import { assertionDiscriminates, type AssertionShape, type OperandShape } from "./acceptance";

/** Assertion entry points across the test styles this repository uses. */
const ASSERTION_CALL = /\b(expect|assert|expectTypeOf)\s*\(/g;

/** Matcher names that follow a receiver, e.g. `expect(x).toEqual(y)`. */
const MATCHER_AFTER_RECEIVER = /^\s*(?:\.\s*(?:not|resolves|rejects)\s*)?\.\s*([A-Za-z_$][\w$]*)\s*\(/;

/**
 * Reduce a source expression to the shape that decides whether it can discriminate.
 *
 * `empty-literal` is the shape that matters: `[]`, `{}`, `""`, `new Map()`, `0` exercise a case that
 * cannot vary, so an assertion over only those cannot establish a property of the general input.
 */
/**
 * Reduce a source expression to the shape that decides whether it can discriminate.
 *
 * `empty-literal` is the shape that matters: `[]`, `{}`, `""`, `new Map()`, `0` exercise a case that
 * cannot vary, so an assertion over only those cannot establish a property of the general input.
 *
 * When `bindings` is supplied, a bare identifier is resolved through the file's own simple assignments
 * first. That matters because the vacuity usually hides one step away:
 * `const interventions = []; ... encode(interventions)` — without resolving the binding, the argument
 * reads as a `variable` and the emptiness is invisible.
 */
export function operandShapeOf(expression: string, bindings?: ReadonlyMap<string, string>): OperandShape {
  const value = expression.trim();
  if (!value) return "unknown";
  // A directly empty literal or its common constructors.
  if (/^(?:\[\s*\]|\{\s*\}|""|''|``|new\s+(?:Map|Set|Array)\s*\(\s*\))$/.test(value)) return "empty-literal";
  if (/^(?:\[\s*\]|\{\s*\}|""|''|``)\s+as\s+const$/.test(value)) return "empty-literal";
  if (value === "0") return "empty-literal";

  // A collection literal whose contents are all empty. Nothing in it varies, so an assertion over only
  // these cannot fail for the reason a claim about non-empty values cares about — but a mixed literal
  // carrying a real value can, which is why this is a separate shape rather than a stricter regex.
  const arrayBody = /^\[([\s\S]*)\]$/.exec(value);
  if (arrayBody) return arrayBody[1]!.trim() === "" ? "empty-literal" : "non-empty-literal";
  const objectBody = /^\{([\s\S]*)\}$/.exec(value);
  if (objectBody) {
    const body = objectBody[1]!.trim();
    if (!body) return "empty-literal";
    // Split the top-level entries and see whether anything carries a value that is not itself empty.
    const entries = splitArguments(body);
    const allEmpty = entries.every((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 0) return false; // A shorthand property: unreadable here, so treat as carrying a value.
      const inner = operandShapeOf(entry.slice(separator + 1), bindings);
      return inner === "empty-literal" || inner === "empty-collection";
    });
    return allEmpty ? "empty-collection" : "non-empty-literal";
  }

  if (/^["'`][\s\S]+["'`]$/.test(value)) return "non-empty-literal";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return "non-empty-literal";

  // A CALL is classified by what it is given, not by the fact that it is a call: `encode([])` exercises an
  // empty case, and a wrapper must not launder that into "variable".
  const call = /^[A-Za-z_$][\w$.]*\s*\(([\s\S]*)\)$/.exec(value);
  if (call) {
    const args = splitArguments(call[1]!);
    // A call with no arguments is a bare function reference: it could be anything, so it stays a variable.
    if (!args.length) return "variable";
    const shapes = args.map((argument) => operandShapeOf(argument, bindings));
    // Empty when every argument is empty — the call cannot vary.
    if (shapes.every((shape) => shape === "empty-literal" || shape === "empty-collection")) return "empty-collection";
    if (shapes.some((shape) => shape === "non-empty-literal" || shape === "variable")) return "variable";
    return "unknown";
  }

  // A bare identifier: resolve it through the file's assignments when we have them.
  if (/^[A-Za-z_$][\w$]*$/.test(value)) {
    const bound = bindings?.get(value);
    if (bound !== undefined && bound.trim() !== value) {
      const resolved = operandShapeOf(bound, bindings);
      // Only a resolution that CHANGES the answer is worth making. An unresolvable binding is a variable.
      if (resolved !== "unknown") return resolved;
    }
    return "variable";
  }

  if (/^[A-Za-z_$][\w$.]*$/.test(value)) return "variable";
  return "unknown";
}

/**
 * The file's simple local assignments: `const name = <expression>`.
 *
 * One lexical pass, deliberately shallow — it reads the literal a fixture is bound to so that
 * `const interventions = []; … document(interventions)` is recognised as exercising an empty case. It
 * does not follow reassignment, scope or mutation, and anything it cannot resolve stays a `variable`,
 * which the judgement already refuses to treat as strong on its own when combined with empty operands.
 */
function readBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const ASSIGNMENT = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = ASSIGNMENT.exec(source)) !== null) {
    const name = match[1]!;
    const start = match.index + match[0].length;
    // Read to the end of the statement, respecting nesting and quotes.
    let depth = 0;
    let quote: string | null = null;
    let end = start;
    for (; end < source.length; end++) {
      const char = source[end]!;
      if (quote) { if (char === quote && source[end - 1] !== "\\") quote = null; continue; }
      if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
      if ("([{".includes(char)) depth += 1;
      else if (")]}".includes(char)) depth -= 1;
      else if ((char === ";" || char === "\n") && depth === 0) break;
    }
    const expression = source.slice(start, end).trim();
    if (expression) bindings.set(name, expression);
  }
  return bindings;
}


/**
 * Whether the case feeds a NON-EMPTY value into the behaviour it exercises.
 *
 * ## Why this is a source scan rather than a call-graph walk
 *
 * The precise question — "is the value reaching the function under test non-empty?" — requires knowing
 * which call IS the function under test and which bindings are inputs rather than results. Four attempts
 * at that classification each produced a confident wrong answer (an internal `JSON.stringify` counted as
 * the input; the result binding counted as an input; an assertion's expected value counted as an input;
 * a named-import call mistaken for a method call). A lexical reader cannot answer it, and a wrong answer
 * here is worse than a coarse one, because it would let the vacuous case through.
 *
 * So it answers the question it CAN answer reliably, and it answers it conservatively:
 *
 *   **does the file supply any non-empty literal that is not part of an assertion's expectation?**
 *
 * A file containing only `[]`, `{}` and `""` outside its assertions exercises nothing representative — that
 * is the Phase 06 dogfood shape, and it is refused. A file containing a populated fixture is not purely
 * vacuous, and is allowed to proceed to the assertion-level judgement.
 *
 * Assertion bodies are excluded first, so `expect(result).toEqual([1, 2, 3])` — an expectation, not an
 * input — cannot be mistaken for test data.
 */
function exercisesNonEmptyInput(source: string): boolean {
  // Only the CASE BODIES are scanned. A suite's description (`it("round-trips a representative …")`) is a
  // string literal that says what the author intended, not what the test supplies — reading it as input is
  // how a test that only ever fed `[]` was classified as exercising something.
  const body = stripAssertions(testBodies(source));
  if (!body.trim()) return false;
  if (/\[[^\]]*[^\s,\[\]]/.test(body)) return true;
  if (/\{[^}]*[^\s,{}:]\s*:/.test(body)) return true;
  if (/["'`][^"'`\n]+["'`]/.test(body)) return true;
  return false;
}

/**
 * The bodies of every test case in the source.
 *
 * `it(name, () => { … })` — everything after the arrow's brace. A file with no recognisable case yields an
 * empty string, which the caller treats as "nothing representative was found" — the fail-closed direction.
 */
function testBodies(source: string): string {
  const bodies: string[] = [];
  const CASE = /\b(?:it|test)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = CASE.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) continue;
    const call = source.slice(open + 1, close);
    // The body is whatever follows the first `{` that opens an arrow or function body.
    const brace = call.indexOf("{");
    if (brace >= 0) bodies.push(call.slice(brace + 1));
    CASE.lastIndex = close + 1;
  }
  return bodies.join("\n");
}

/**
 * Remove every assertion site from the source, using the same paren matcher the reader uses.
 *
 * An assertion's arguments are EXPECTATIONS, not inputs: `expect(result).toEqual([1, 2, 3])` must not be
 * read as "the case supplies a populated array". A regex over the whole call is not reliable here — an
 * assertion spanning several lines has nested parentheses — so this walks the text and consumes each
 * `expect(...)` plus whatever matcher chain follows it.
 */
function stripAssertions(source: string): string {
  let result = "";
  const ASSERTION = /\b(expect|assert|expectTypeOf)\s*\(/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSERTION.exec(source)) !== null) {
    if (match.index < cursor) continue;
    const open = match.index + match[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) break;
    result += source.slice(cursor, match.index);
    cursor = close + 1;
    // Consume the matcher chain that follows, so its arguments go too.
    for (;;) {
      const chain = /^\s*(?:\.\s*(?:not|resolves|rejects)\s*)?\.\s*\w+\s*\(/.exec(source.slice(cursor));
      if (!chain) break;
      const chainOpen = cursor + chain[0].length - 1;
      const chainClose = matchParen(source, chainOpen);
      if (chainClose < 0) break;
      cursor = chainClose + 1;
    }
  }
  result += source.slice(cursor);
  return result;
}



/** Split a call's argument list, respecting nesting and quoted strings. */
export function splitArguments(source: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; current += char; continue; }
    if ("([{".includes(char)) { depth += 1; current += char; continue; }
    if (")]}".includes(char)) { depth -= 1; current += char; continue; }
    if (char === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Find the matching close paren for an open paren at `openIndex`. */
function matchParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]!;
    if (quote) { if (char === quote && source[index - 1] !== "\\") quote = null; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

/** The 1-based line number of an offset, for a citation a reader can follow. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index++) if (source[index] === "\n") line += 1;
  return line;
}

/**
 * Every call argument in the source, reduced to a shape.
 *
 * This is how the INPUT a case exercises is read. The assertion's own operands describe the comparison;
 * these describe what the behaviour was actually fed. A test that asserts richly about the result of
 * `parse(encode([]))` is still vacuous about non-empty values, and only this side shows it.
 *
 * Calls whose name is an assertion entry point are excluded — their arguments are already the assertion's
 * operands, and counting them twice would let an assertion about an empty fixture look like an input.
 */
function readCallArgumentShapes(source: string): { expressions: string[]; shapes: OperandShape[] } {
  const expressions: string[] = [];
  const shapes: OperandShape[] = [];
  const bindings = readBindings(source);
  const CALL = /\b([A-Za-z_$][\w$.]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = CALL.exec(source)) !== null) {
    const name = match[1]!;
    if (/(^|\.)(expect|assert|expectTypeOf|describe|it|test)$/.test(name)) continue;
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = matchParen(source, openIndex);
    if (closeIndex < 0) continue;
    for (const argument of splitArguments(source.slice(openIndex + 1, closeIndex))) {
      if (!argument.trim()) continue;
      expressions.push(argument.trim());
      shapes.push(operandShapeOf(argument, bindings));
    }
    CALL.lastIndex = closeIndex + 1;
  }
  return { expressions, shapes };
}

/**
 * Read every assertion site in a test file.
 *
 * A site's operands are the receiver argument plus each matcher argument, plus the arguments of every
 * call in the surrounding case — because either side can carry the varying case, and the INPUT is as
 * decisive as the comparison.
 */
export function readAssertionShapes(source: string, file: string): AssertionShape[] {
  const shapes: AssertionShape[] = [];
  const bindings = readBindings(source);
  ASSERTION_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSERTION_CALL.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = matchParen(source, openIndex);
    if (closeIndex < 0) continue; // Unbalanced: unreadable, so contribute nothing.
    const receivers = splitArguments(source.slice(openIndex + 1, closeIndex));
    const after = source.slice(closeIndex + 1);
    const matcher = MATCHER_AFTER_RECEIVER.exec(after);
    const at = `${file}:${lineAt(source, match.index)}`;
    const operandShapes: OperandShape[] = receivers.map((receiver) => operandShapeOf(receiver, bindings));

    if (matcher) {
      const matcherOpen = closeIndex + 1 + matcher[0].length - 1;
      const matcherClose = matchParen(source, matcherOpen);
      const matcherOperands = matcherClose > 0 ? splitArguments(source.slice(matcherOpen + 1, matcherClose)) : [];
      for (const argument of matcherOperands) operandShapes.push(operandShapeOf(argument, bindings));
      const negation = /\.\s*not\s*\./.test(matcher[0]) ? "not." : "";
      // The assertion's OWN nested calls are attached, so a refusal can name the input. File-level calls
      // are deliberately NOT merged in here: an unrelated `JSON.stringify(...)` appearing in the operand
      // list would mask the emptiness the assertion is actually about. The input side is measured
      // separately by `summarizeAssertionStrength`, where it is reported as its own signal.
      const nested = [...receivers, ...matcherOperands].flatMap((expression) => readCallArgumentShapes(expression).expressions);
      // Whether the assertion checks the behaviour ECHOES a varying value, which is the shape that can
      // actually fail: `expect(result).toEqual(input)` is refuted by any implementation that drops or
      // mangles the input. `expect(result).toEqual({ status: "ok" })` is refuted by nothing except a wrong
      // status string, so it cannot carry a claim about round-tripping.
      const echoes = receivers.some((receiver) => matcherOperands.some((operand) => operand.trim() === receiver.trim() && /^[A-Za-z_$][\w$.]*$/.test(receiver.trim())));
      // Whether the comparison references the INPUT as well as the result. `expect(result.count).toBe(3)`
      // compares a result-derived value against a literal and is satisfied by any constant result;
      // `expect(result.count).toBe(input.length)` involves the input, so mishandling the input refutes it.
      const referencesInput = matcherOperands.some((operand) => {
        const trimmed = operand.trim();
        if (receivers.some((receiver) => receiver.trim() === trimmed)) return false; // An echo, handled above.
        return [...bindings.keys()].some((name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, "\\$")}(\\b|\\.|\\[)`).test(trimmed));
      });
      shapes.push({ at, operandShapes, assertion: `${negation}${matcher[1]}`, echoOfInput: echoes, referencesInput, exercisesNonEmptyInput: exercisesNonEmptyInput(source), ...(nested.length ? { callArguments: nested } : {}) });
      ASSERTION_CALL.lastIndex = closeIndex + 1;
      continue;
    }

    // A bare `assert(cond)` / `assert.equal(a, b)` style site: the name is the assertion, and its
    // arguments are the operands.
    const name = match[1] === "assert" ? "assert" : match[1]!;
    shapes.push({ at, operandShapes, assertion: name });
    ASSERTION_CALL.lastIndex = closeIndex + 1;
  }
  return shapes;
}

/**
 * Whether a test file contains a case that could fail, and what INPUT it exercises.
 *
 * Two signals, reported separately because they answer different questions and conflating them made both
 * wrong:
 *
 *  - `discriminating` — an assertion whose operands can vary, i.e. the comparison could have failed;
 *  - `inputs` — what the file's calls are actually given. A case that asserts richly about the result of
 *    `parse(encode([]))` is vacuous about non-empty values even though its assertion looks substantial,
 *    and the emptiness lives here.
 *
 * A caller deciding acceptance needs both. The Phase 06 dogfood run is the case in point: its assertion
 * read as discriminating (it compared a real object) while its only input was an empty array.
 */
export function summarizeAssertionStrength(source: string, file: string): {
  total: number;
  discriminating: number;
  weak: Array<{ at: string; assertion: string; reason: string }>;
  inputs: { total: number; nonEmpty: number; empty: number; expressions: string[] };
} {
  const shapes = readAssertionShapes(source, file);
  const weak: Array<{ at: string; assertion: string; reason: string }> = [];
  let discriminating = 0;
  for (const shape of shapes) {
    const judgement = assertionDiscriminates(shape);
    if (judgement.discriminating) discriminating += 1;
    else weak.push({ at: shape.at, assertion: shape.assertion, reason: judgement.reason });
  }
  const callShapes = readCallArgumentShapes(source);
  const nonEmpty = callShapes.shapes.filter((shape) => shape === "non-empty-literal" || shape === "variable").length;
  const empty = callShapes.shapes.filter((shape) => shape === "empty-literal" || shape === "empty-collection").length;
  return {
    total: shapes.length,
    discriminating,
    weak,
    inputs: { total: callShapes.shapes.length, nonEmpty, empty, expressions: callShapes.expressions }
  };
}
