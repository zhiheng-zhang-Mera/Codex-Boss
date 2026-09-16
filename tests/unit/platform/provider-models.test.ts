import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_MODEL_DEFAULTS, RETIRED_MODEL_IDS, declaredModelIds, modelDrift, observedModelsFrom } from "../../../src/shared/provider-models";
import { DEFAULT_POLICIES, policyFor } from "../../../src/shared/model-policy";
import type { PolicyStage } from "../../../src/shared/model-policy";

/**
 * The declared-vs-observed provider model contract.
 *
 * `electron/api-settings.ts` and `src/shared/model-policy.ts` both declared `deepseek-v4-flash`. A live
 * `GET /v1/models` against the DeepSeek endpoint returned `deepseek-flash` and `deepseek-v4-pro`, and
 * nothing returned `deepseek-v4-flash`. A default naming a model the provider does not serve looks
 * perfectly configured and fails on the first real call, and nothing in the repository could have
 * noticed without making that call.
 *
 * ## What this test can and cannot do
 *
 * It cannot prove the declaration matches the live provider — that needs a network call, and pinning
 * one into the unit tier would make the suite depend on a credential, a network and a provider's
 * uptime. What it does instead:
 *
 *   1. holds every declared id to the vocabulary the provider has been OBSERVED to serve, so a
 *      reintroduced stale id fails by name;
 *   2. checks the drift classifier itself detects a mismatch in both directions, so the mechanism that
 *      would report a live drift is known to work;
 *   3. proves no module can quietly declare a model outside the catalogue, by reading the two files
 *      that used to do exactly that.
 *
 * The live half is a manual step with no test dependency, described in the Phase 05 status document:
 * `GET /v1/models` and compare against `declaredModelIds()`.
 */

/** The ids the DeepSeek endpoint was observed to serve, recorded from a live check. */
const OBSERVED_DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

describe("Phase 05 — declared provider models match what the provider serves", () => {
  it("declares exactly the models the DeepSeek endpoint was observed to offer", () => {
    expect(PROVIDER_MODEL_DEFAULTS.deepseek.model).toBe("deepseek-flash");
    const drift = modelDrift([PROVIDER_MODEL_DEFAULTS.deepseek.model], { observed: OBSERVED_DEEPSEEK_MODELS, observedAt: "live-check" });
    expect(drift.checked).toBe(true);
    expect(drift.missing, "a declared model the provider does not serve").toEqual([]);
    expect(drift.matches).toBe(true);
  });

  it("declares no model on the retired list, and says why each was retired", () => {
    const declared = declaredModelIds();
    for (const [model, reason] of Object.entries(RETIRED_MODEL_IDS)) {
      expect(declared, `${model} was retired: ${reason}`).not.toContain(model);
      // The reason has to name what replaced it, or the entry is just a deletion.
      expect(reason.length).toBeGreaterThan(30);
    }
    // The specific regression, by name: this is the id that was wrong.
    expect(RETIRED_MODEL_IDS["deepseek-v4-flash"]).toContain("deepseek-flash");
  });

  it("every model the policy layer can select is a declared model", () => {
    // A policy that names a model outside the catalogue would bypass the contract entirely, which is
    // how the stale id survived in the first place.
    const declared = new Set(declaredModelIds());
    const stages = Object.keys(DEFAULT_POLICIES) as PolicyStage[];
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      const { policy, reason } = policyFor(stage);
      expect(declared, `${stage} selects ${policy.model}, which is not declared`).toContain(policy.model);
      // Model choice must stay explainable, and the explanation must name the model actually chosen.
      expect(reason).toContain(policy.model);
    }
  });

  it("keeps the per-stage vocabulary wider than the single default, on purpose", () => {
    // Boss picks a cheaper model to classify and a stronger one to adjudicate, so a catalogue that
    // carried only the default would report a legitimate per-stage choice as an undeclared model.
    const deepseek = PROVIDER_MODEL_DEFAULTS.deepseek;
    expect(deepseek.models).toContain(deepseek.model);
    expect(deepseek.models).toEqual(expect.arrayContaining(["deepseek-flash", "deepseek-v4-pro"]));
  });

  it("no source file declares a model outside the catalogue", () => {    // The two files that carried the stale declaration, read as text: a literal `deepseek-v4-flash`
    // anywhere in them is the exact regression, and it must fail with its name in the message.
    const files = ["electron/api-settings.ts", "src/shared/model-policy.ts", "src/shared/provider-models.ts"];
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      // The provider-models file is allowed to name it inside RETIRED_MODEL_IDS, where the deny-list
      // documents it. Everywhere else the id must be absent.
      const withoutDenyList = file.endsWith("provider-models.ts")
        ? source.replace(/"deepseek-v4-flash":\s*"[^"]*"/, "")
        : source;
      // Comments may NAME the retired id to explain the history; a quoted literal may not appear.
      const quotedLiterals = withoutDenyList.match(/"(deepseek[a-z0-9-]*)"/g) ?? [];
      for (const literal of quotedLiterals) {
        const model = literal.slice(1, -1);
        if (!model.startsWith("deepseek-")) continue;
        expect(declaredModelIds(), `${file} declares ${model}, which is not in the catalogue`).toContain(model);
      }
    }
  });
});

describe("Phase 05 — the drift classifier reports a mismatch in both directions", () => {
  it("catches a declared model the provider does not serve", () => {
    // The historical bug, replayed: this must be reported, not smoothed over.
    //
    // Checked against the full DeepSeek vocabulary rather than one id, so the only difference between
    // declared and observed is the stale model itself — which is what makes `missing` the finding and
    // `undeclared` empty.
    const declared = PROVIDER_MODEL_DEFAULTS.deepseek.models;
    const drift = modelDrift(declared, { observed: OBSERVED_DEEPSEEK_MODELS, observedAt: "live-check" });
    expect(drift.matches, "the current declaration agrees with the provider").toBe(true);

    const before = modelDrift(["deepseek-v4-flash", "deepseek-v4-pro"], { observed: OBSERVED_DEEPSEEK_MODELS, observedAt: "live-check" });
    expect(before.matches).toBe(false);
    expect(before.missing).toEqual(["deepseek-v4-flash"]);
    // The replacement id is served but was not declared at the time, which is the other half of the
    // same drift: the catalogue named a model that does not exist and omitted the one that does.
    expect(before.undeclared).toEqual(["deepseek-flash"]);  });

  it("reports a model the provider serves but Boss does not offer", () => {
    // Not a failure, but it is how a rename becomes visible before it becomes an outage.
    const drift = modelDrift(["deepseek-flash"], { observed: ["deepseek-flash", "deepseek-v5-pro"], observedAt: "live-check" });
    expect(drift.matches, "an undeclared model is not a declared-model failure").toBe(true);
    expect(drift.undeclared).toEqual(["deepseek-v5-pro"]);
  });

  it("distinguishes 'nobody checked' from 'checked and clean'", () => {
    // The distinction that stops an absent refresh from reading as agreement.
    const unchecked = modelDrift(["anything-at-all"]);
    expect(unchecked.checked).toBe(false);
    expect(unchecked.missing).toEqual([]);
    const checked = modelDrift(["anything-at-all"], { observed: [], observedAt: "live-check" });
    expect(checked.checked).toBe(true);
    expect(checked.missing).toEqual(["anything-at-all"]);
  });

  it("reads a /models response, and reports an unusable one as empty rather than guessed", () => {
    expect(observedModelsFrom({ data: [{ id: "a" }, { id: " b " }, { notAnId: true }] })).toEqual(["a", "b"]);
    // An unrecognised shape is an absence, never agreement.
    expect(observedModelsFrom({ models: ["a"] })).toEqual([]);
    expect(observedModelsFrom(null)).toEqual([]);
    expect(observedModelsFrom("nope")).toEqual([]);
  });

  it("keeps the refresh optional: no module reads a provider capability at import time", () => {
    // The design constraint, checked structurally. A live call at module scope would make boot depend
    // on a provider's uptime, so the declared list must be a literal and the refresh must be a
    // function a caller invokes.
    const source = fs.readFileSync(path.join(process.cwd(), "src", "shared", "provider-models.ts"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/await\s+/);
    expect(source).toContain("export function observedModelsFrom");
    // And the settings store derives its defaults from the catalogue rather than restating them.
    const settings = fs.readFileSync(path.join(process.cwd(), "electron", "api-settings.ts"), "utf8");
    expect(settings).toContain("PROVIDER_MODEL_DEFAULTS");
  });
});
