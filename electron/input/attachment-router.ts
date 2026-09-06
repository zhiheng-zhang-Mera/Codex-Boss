/**
 * Attachment / input router (plan 9-7 §6/§8). Deterministically decides which
 * open providers receive which input objects and whether a task needs Work
 * escalation — no user choice, no model call.
 *
 * Inputs: typed input objects + provider capability/availability metadata.
 * Output: ResolutionPlan with per-object assignments or an escalation reason
 * (switch provider → deterministic conversion → Work).
 */

import type { ProviderId } from "../../src/shared/contracts";
import { canHandleObject, capabilityNeedsForKind, withinUploadLimit, type ProviderCapabilities } from "../../src/shared/provider-capabilities";
import type { InputObjectRef } from "../../src/shared/input-object";

export interface ProviderRouteState {
  providerId: ProviderId;
  transport: "web" | "api" | "codex" | "local";
  capabilities: ProviderCapabilities;
  available: boolean;
  /** Lower rank = preferred (open-order in the UI today). */
  preferenceRank: number;
}

export interface InputAssignment {
  inputObjectId: string;
  originalName?: string;
  kind: string;
  /** Provider chosen for this object, or none when unroutable. */
  providerId?: ProviderId;
  routed: boolean;
  reason: string;
}

export interface ResolutionPlan {
  mode: "CHAT" | "WORK";
  assignments: InputAssignment[];
  requiredCapabilities: string[];
  /** Provider receives every routed object (all-or-nothing on one page). */
  providerIds: ProviderId[];
  escalationReason?: string;
}

export interface RouteRequest {
  objects: InputObjectRef[];
  providers: ProviderRouteState[];
  /** Text-only tasks still route to the cheapest available provider. */
  taskRequiresFile?: boolean;
}

/** Deduplicated capability vocabulary required by the given objects. */
export function requiredCapabilitiesFor(objects: InputObjectRef[]): string[] {
  const set = new Set<string>();
  for (const object of objects) {
    for (const need of capabilityNeedsForKind(object.kind)) set.add(need);
  }
  return [...set];
}

/**
 * Routes every input object to one provider group. A provider that cannot
 * receive a file type is never assigned it; if none can, the object escalates.
 * Uses the preference order of available providers; when two objects need
 * different capabilities the group is the intersection of providers that can
 * take all objects (one visible page receives the whole turn).
 */
export function routeInputObjects(request: RouteRequest): ResolutionPlan {
  const requiredCapabilities = requiredCapabilitiesFor(request.objects);
  const available = [...request.providers]
    .filter((provider) => provider.available)
    .sort((a, b) => a.preferenceRank - b.preferenceRank);

  const allFileKinds = request.objects.map((object) => object.kind);
  const candidates = available.filter((provider) => allFileKinds.every((kind) => canHandleObject(provider.capabilities, kind)));
  // Multiple distinct files on one page require multipleFiles support.
  const sizeCapable = (provider: ProviderRouteState) => request.objects.every((object) => object.size === undefined || withinUploadLimit(provider.capabilities, object.size));
  const chosen = candidates.filter(sizeCapable);

  if (request.objects.length > 1) {
    const multiFileProviders = chosen.filter((provider) => provider.capabilities.multipleFiles);
    if (multiFileProviders.length) {
      return planTo(request.objects, multiFileProviders, requiredCapabilities, "provider accepts every file type and multiple files");
    }
  }
  if (chosen.length) {
    return planTo(request.objects, chosen, requiredCapabilities, "provider accepts every file type");
  }

  const assignments = request.objects.map((object) => {
    const fitted = available.filter((provider) => canHandleObject(provider.capabilities, object.kind) && (object.size === undefined || withinUploadLimit(provider.capabilities, object.size)));
    if (fitted.length) {
      return { inputObjectId: object.id, originalName: object.originalName, kind: object.kind, providerId: fitted[0].providerId, routed: true, reason: "single-object capability match; group cannot carry every object" };
    }
    return { inputObjectId: object.id, originalName: object.originalName, kind: object.kind, routed: false, reason: "no available provider advertises this file capability" };
  });
  const escalationReason = assignments.some((assignment) => !assignment.routed)
    ? "无法由当前打开的 AI 直接读取附件；需要换 Provider 或确定性转换"
    : "打开的多 AI 不能同时接收全部附件；需要 Work 多路执行";
  return { mode: "WORK", assignments, requiredCapabilities, providerIds: [], escalationReason };
}

function planTo(objects: InputObjectRef[], providers: ProviderRouteState[], requiredCapabilities: string[], reason: string): ResolutionPlan {
  const assignments: InputAssignment[] = objects.map((object) => ({
    inputObjectId: object.id,
    originalName: object.originalName,
    kind: object.kind,
    providerId: providers[0].providerId,
    routed: true,
    reason
  }));
  return { mode: "CHAT", assignments, requiredCapabilities, providerIds: [providers[0].providerId], escalationReason: undefined };
}

/** Text-only routing: cheapest/available provider that can read text. */
export function routeTextOnly(providers: ProviderRouteState[], preferredIds: ProviderId[] = []): ProviderRouteState | undefined {
  const ordered = [...providers].sort((a, b) => {
    const aPref = preferredIds.indexOf(a.providerId);
    const bPref = preferredIds.indexOf(b.providerId);
    if (aPref !== bPref) return (aPref < 0 ? 999 : aPref) - (bPref < 0 ? 999 : bPref);
    return a.preferenceRank - b.preferenceRank;
  });
  return ordered.find((provider) => provider.available && canHandleObject(provider.capabilities, "TEXT"));
}
