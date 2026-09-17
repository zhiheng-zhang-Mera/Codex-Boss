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
  const raw = expression.trim();
  if (!raw) return "unknown";

  // STRIP A TYPE ASSERTION BEFORE SHAPING, and keep the expression only when the suffix really is a type.
  // This is not cosmetic: the real generated test that exposed it bound its fixture with
  // `] as unknown as HumanInterventionRequest[]`, and reading that as part of the VALUE made a populated
  // two-element fixture come back `unknown` — i.e. non-discriminating. That is a false negative, and a
  // reader that refuses genuine evidence is as wrong as one that accepts vacuous evidence: it would fail
  // the real work instead of the fake version of it.
  const assertion = splitTypeAssertion(raw);
  const value = assertion.stripped ? assertion.expression : raw;
  if (!value.trim()) return "unknown"; // A pure type name is not a value: fail closed rather than guess.
  // A directly empty literal or its common constructors. Checked before `as const` so an empty value
  // stays empty whichever way it is annotated.
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
 * Split a value expression from a TypeScript type assertion suffixed to it.
 *
 * `[{ … }] as unknown as HumanInterventionRequest[]` is a populated literal with a type written on the
 * end. The type is not part of the value, so the shape must be taken from what precedes it — and the
 * suffix is only accepted when it actually reads like a type (`A`, `A[]`, `A<B>`, `A.B`, `readonly A[]`),
 * so an expression that merely contains the word `as` is left alone. Fail-closed: an unreadable suffix
 * returns the text unchanged, and the caller then reads the whole thing as it did before.
 *
 * A trailing `as const` is the one suffix that carries meaning for shaping — it distinguishes an array
 * literal from a tuple — so it is reported and removed rather than treated as an opaque type.
 */
function splitTypeAssertion(expression: string): { expression: string; stripped: boolean } {
  const value = expression.trim();
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote) { if (char === quote && value[index - 1] !== "\\") quote = null; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if ("([{".includes(char)) { depth += 1; continue; }
    if (")]}".includes(char)) { depth -= 1; continue; }
    if (depth !== 0) continue;
    // Only a TOP-LEVEL `<space>as<space>`. Inside a literal it is a property name or a string, and the
    // spaces on both sides are what make it the keyword. (Anchoring on the SPACE rather than the `a` also
    // lets the loop step straight over `as` inside an identifier like `has`.)
    if (value.slice(index, index + 4) !== " as ") continue;
    // What precedes the keyword decides whether it IS the keyword. It must be a type annotation, whose
    // left side is a name or a closing bracket — `value as T`, `arr.map(…) as T` — so `has as`, `was as`
    // and `as as` are refused. Testing the character immediately before instead was wrong twice over: it
    // read the space as a word character's successor (`cases as` → `s`), and it cannot tell a variable
    // from an identifier ending in the letters `as`.
    const before = value.slice(0, index).trimEnd();
    const left = before[before.length - 1];
    if (left === undefined || !/[\w$)\]}"'`]/.test(left)) continue;
    const after = value.slice(index + 4).trim();
    if (!after) continue;
    const constAssertion = /^const$/.test(after);
    if (!constAssertion && !isTypeName(after)) continue;
    return { expression: before, stripped: true };
  }
  return { expression: value, stripped: false };
}

/**
 * Whether a suffix reads like a type annotation rather than another expression.
 *
 * Deliberately strict. A suffix that is itself a value expression must NOT be stripped: `expect(x).toBe(a
 * as b)` would otherwise have its right-hand side deleted before shaping, and the reader would report a
 * constant where there was a comparison.
 */
function isTypeName(suffix: string): boolean {
  if (!/^(?:readonly\s+)?[A-Za-z_$]/.test(suffix)) return false;
  let depth = 0;
  for (let index = 0; index < suffix.length; index++) {
    const char = suffix[index]!;
    if ("([{<".includes(char)) { depth += 1; continue; }
    if (")]}>".includes(char)) { depth -= 1; continue; }
    if (depth < 0 || depth > 2) return false; // Unbalanced or nested deeper than any type written here.
    if (depth === 0 && /[=+\-*/%&|!?;,'"`]/.test(char)) return false; // An operator means an expression.
    if (depth === 0 && char === "." && !/[A-Za-z_$][\w$]*$/.test(suffix.slice(0, index))) return false;
    if (!/[\w$.[\]<>,\s]/.test(char)) return false;
  }
  return depth === 0;
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
  // A TYPE ANNOTATION is part of the declaration, not of the value:
  // `const interventions: HumanInterventionRequest[] = [...]`. Without this the pattern above failed to
  // match the declaration AT ALL — `name` was followed by `:`, not `=` — so the fixture was never bound
  // and every reference to it read as an opaque variable. That is how a real, meaningful test came back
  // `INSUFFICIENT_EVIDENCE`.
  //
  // The annotation is spelled out as the characters a TYPE can contain rather than `[^=]*`, because the
  // loose version would happily jump the first `=` of an object literal and bind the wrong expression.
  const ASSIGNMENT = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w$[\].<>,|\s{}()]*?)?=\s*/g;
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
      if ("([{".includes(char)) { depth += 1; continue; }
      if (")]}".includes(char)) { depth -= 1; continue; }
      if (char === ";" && depth === 0) break;
      // A NEWLINE ends the statement only when the expression is COMPLETE. Breaking on the first newline
      // truncated a multi-line fixture at its opening bracket — `const interventions = [` — so a populated
      // array read as `unknown` and a genuinely meaningful test was refused. A representative fixture is
      // usually written across several lines, which made that the common case rather than an edge one.
      if (char === "\n" && depth === 0 && isCompleteExpression(source.slice(start, end))) break;
    }
    const expression = source.slice(start, end).trim();
    if (expression) bindings.set(name, expression);
  }
  return bindings;
}

/** Whether a fragment is a finished expression rather than a line of one. */
function isCompleteExpression(fragment: string): boolean {
  const text = fragment.trim();
  if (!text) return false;
  // Unbalanced brackets mean the expression continues on the next line.
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) { if (char === quote && text[index - 1] !== "\\") quote = null; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
  }
  if (depth !== 0 || quote) return false;
  // A trailing operator, comma or dot means more is coming.
  return !/[=+\-*/%&|?:,.<(]$/.test(text);
}


function testBodies(source: string): Array<{ body: string; start: number }> {
  const bodies: Array<{ body: string; start: number }> = [];
  const CASE = /\b(?:it|test)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = CASE.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(source, open);
    if (close < 0) continue;
    const call = source.slice(open + 1, close);
    // The body is whatever follows the first `{` that opens an arrow or function body.
    const brace = call.indexOf("{");
    if (brace >= 0) bodies.push({ body: call.slice(brace + 1), start: open + 1 + brace + 1 });
    CASE.lastIndex = close + 1;
  }
  return bodies;
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
 * A citation relative to the WHOLE file, not to the fragment being read.
 *
 * The summary reads each test CASE in isolation, so a line number computed inside one is relative to that
 * body — and a refusal that cites `file:4` for an assertion on line 40 is a citation a reader cannot follow.
 * `offset` is where the fragment starts in the file, so the count is anchored there.
 *
 * `chunk` is searched for from that offset first, which keeps the number correct for the case body (whose
 * first character is the enclosing brace, not the line's start) while staying exact for a whole-file read.
 */
function atLine(file: string, source: string, index: number, offset: number): string {
  const chunk = source.slice(index, index + 24);
  const found = offset > 0 ? source.indexOf(chunk, offset) : index;
  const anchor = found >= 0 ? found : offset + index;
  return `${file}:${lineAt(source, anchor)}`;
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
 *
 * The whole assertion is removed before this walk, matcher chain included. Excluding only the `expect` name
 * left the MATCHER's arguments behind, so `toEqual([])` was read as a supplied value and a file whose only
 * input was `[]` reported a non-empty call argument.
 *
 * The test SCAFFOLDING is excluded for the same reason: `describe("intervention-file", …)` and
 * `it("round-trips", …)` are labels, not values fed to the behaviour.
 */
function readCallArgumentShapes(source: string): { expressions: string[]; shapes: OperandShape[] } {
  const expressions: string[] = [];
  const shapes: OperandShape[] = [];
  const withoutAssertions = stripAssertions(source);
  const bindings = readBindings(source);
  const CALL = /\b([A-Za-z_$][\w$.]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = CALL.exec(withoutAssertions)) !== null) {
    const name = match[1]!;
    if (/(^|\.)(expect|assert|expectTypeOf|describe|it|test)$/.test(name)) continue;
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = matchParen(withoutAssertions, openIndex);
    if (closeIndex < 0) continue;
    for (const argument of splitArguments(withoutAssertions.slice(openIndex + 1, closeIndex))) {
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
export function readAssertionShapes(source: string, file: string, offset = 0, outer?: ReadonlyMap<string, string>): AssertionShape[] {
  const shapes: AssertionShape[] = [];
  // The case body's own bindings, then the FILE's. A module-scope fixture has to be visible HERE, because
  // this is where `referencesInput` and `echoOfInput` are decided: passing the wider scope only to
  // `nonEmptyOperandIn` meant the summary asked "did a non-empty value reach the assertion?" of a shape
  // whose `referencesInput` had already been computed as `false` for want of the very binding in question.
  // The second false negative was exactly that — a real provider put its fixture at module scope.
  const bindings = new Map(outer ?? []);
  for (const [name, bound] of readBindings(source)) bindings.set(name, bound);
  ASSERTION_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSERTION_CALL.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = matchParen(source, openIndex);
    if (closeIndex < 0) continue; // Unbalanced: unreadable, so contribute nothing.
    const receivers = splitArguments(source.slice(openIndex + 1, closeIndex));
    const after = source.slice(closeIndex + 1);
    const matcher = MATCHER_AFTER_RECEIVER.exec(after);
    const at = atLine(file, source, match.index, offset);
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
      shapes.push({ at, operandShapes, operandNames: [...receivers, ...matcherOperands], assertion: `${negation}${matcher[1]}`, echoOfInput: echoes, referencesInput, ...(nested.length ? { callArguments: nested } : {}) });
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
  /**
   * What the file's CALLS are given, at file grain.
   *
   * Reported separately from `inputs`, which counts only what reaches an ASSERTION. This one answers a
   * different question — *did anything in this file exercise a non-empty value at all?* — and it is what a
   * reader wants when a change is refused: the two answers differ, and conflating them made the refusal
   * message name a count it had never measured.
   */
  callInputs: { total: number; nonEmpty: number };
} {
  const cases = testCases(source);
  // The FILE-scope bindings, which are the ones a module-level fixture lives in. A real provider run put
  // its `const interventions: HumanInterventionRequest[] = […]` at module scope and referenced it from
  // inside every case — and because only the case body's own bindings were consulted, a genuinely
  // meaningful file was refused for the third time. Somewhere in the file is a weaker claim than "in this
  // case", so it is a fallback that must still be NAMED by the assertion, never a licence to search.
  const fileBindings = readBindings(source);
  const shapes: AssertionShape[] = [];
  const weak: Array<{ at: string; assertion: string; reason: string }> = [];
  let discriminating = 0;
  let nonEmptyInputs = 0;
  let emptyInputs = 0;
  const expressions: string[] = [];

  for (const { body, start } of cases) {
    // ATTRIBUTED PER CASE, which is the correction that matters. Judging a file as a whole let one case's
    // non-empty fixture vouch for another case's empty one — and that is exactly how a real generated test
    // shipped a round-trip over `[]` alongside an error case over a populated object and was accepted.
    // A case is discriminating only when BOTH hold within that same case: an assertion that could fail,
    // and a non-empty value supplied to it.
    const caseShapes = readAssertionShapes(body, file, start, fileBindings);
    const caseBindings = readBindings(body);
    let caseDiscriminating = false;
    for (const shape of caseShapes) {
      shapes.push(shape);
      const judgement = assertionDiscriminates(shape);
      // The value must reach the ASSERTION, not merely appear in the case. A string literal in an expected
      // object (`{ status: "ok" }`) is not an input, and counting it made a vacuous case look representative.
      const supplied = nonEmptyOperandIn(shape, [caseBindings, fileBindings]);
      if (judgement.discriminating && supplied.found) {
        discriminating += 1;
        nonEmptyInputs += 1;
        caseDiscriminating = true;
        expressions.push(...supplied.expressions);
      } else if (judgement.discriminating) {
        weak.push({ at: shape.at, assertion: shape.assertion, reason: `${shape.at} ties the result to its input, but no non-empty value reaches the assertion` });
      } else {
        weak.push({ at: shape.at, assertion: shape.assertion, reason: judgement.reason });
      }
    }
    // `empty` counts cases that exercised no non-empty value — which is what the field is read as meaning,
    // and what it did NOT mean before: incrementing it only for cases with no assertion site at all made
    // it a count of assertion-less cases wearing the name of a count of empty ones.
    if (!caseDiscriminating) emptyInputs += 1;
  }

  const fileCallArguments = readCallArgumentShapes(source);
  return {
    total: shapes.length,
    discriminating,
    weak,
    inputs: { total: cases.length, nonEmpty: nonEmptyInputs, empty: emptyInputs, expressions },
    callInputs: {
      total: fileCallArguments.shapes.length,
      nonEmpty: fileCallArguments.shapes.filter((shape) => shape === "non-empty-literal").length
    }
  };
}

/** The bodies of every test case in the source, each with where it starts, or the whole source when no case is recognisable. */
function testCases(source: string): Array<{ body: string; start: number }> {
  const bodies = testBodies(source);
  return bodies.length ? bodies : [{ body: source, start: 0 }];
}
/**
 * Whether a non-empty value REACHES this assertion, and which.
 *
 * The assertion's own operands, resolved one step through the case's bindings. This is the narrowest and
 * most reliable place to ask the question: an operand resolving to a populated collection is a value the
 * assertion is actually about, whereas scanning the whole case for literals picks up an expected object's
 * `"ok"` and calls it input.
 *
 * A bare identifier resolving to a populated literal counts — that is `expect(result).toEqual(input)` with
 * `const input = [{…}]`. A binding that is itself a CALL result does not: that is the behaviour's output,
 * and counting it would be circular.
 */
function nonEmptyOperandIn(shape: AssertionShape, scopes: ReadonlyArray<ReadonlyMap<string, string>>): { found: boolean; expressions: string[] } {
  const expressions: string[] = [];
  const names = shape.operandNames ?? [];
  // The binding's name is looked for ANYWHERE in the assertion's operand text, because a representative
  // fixture is usually nested inside the expected value: `toEqual({ status: "ok", interventions: input })`.
  // A word-boundary test, so `input` does not match `inputLength`.
  const referenced = (name: string): boolean => names.some((operand) => new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(operand));

  // The CASE's bindings first, then the FILE's. A fixture declared at module scope is still a value the
  // case supplied, and it has to be NAMED either way — so the wider scope is a fallback, not a licence to
  // scan the file for any populated literal and call it evidence.
  for (const bindings of scopes) {
    for (const [name, bound] of bindings) {
      const expression = bound.trim();
      // A binding that is a call result is the behaviour's OUTPUT, not an input. Circular guard.
      if (/^[A-Za-z_$][\w$.]*\s*\(/.test(expression)) continue;
      if (operandShapeOf(expression, bindings) !== "non-empty-literal") continue;
      if (referenced(name)) expressions.push(`${name} = ${expression.slice(0, 60)}`);
    }
  }
  // Only BINDINGS count, and only when the assertion names them. A literal written directly in an operand
  // is the assertion's EXPECTATION, not something the case supplied — counting it would make every
  // assertion with a populated expected value look like it exercised representative input.
  return { found: expressions.length > 0, expressions: [...new Set(expressions)].slice(0, 4) };
}
