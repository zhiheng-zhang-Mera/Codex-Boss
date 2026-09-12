import { taskPresentation } from "../shared/task-presentation";
import { timelineForTask } from "../shared/task-timeline";
import { currentFinalResponse, isAnalysisOnlyCompletion } from "../shared/final-response";
import type { ProjectStateSummary } from "../shared/project-tree";
import { HistoryNameDialog, type HistoryDialogState } from "./components/HistoryNameDialog";
import { ConversationContextMenu, type ConversationMenuState } from "./components/ConversationContextMenu";
import { HumanInterventionCard } from "./components/HumanInterventionCard";
import { ResearchProgress } from "./components/ResearchProgress";
import { AttachmentTray } from "./components/AttachmentTray";
import { ManagerPanel } from "./components/ManagerPanel";
import { GoalRunPanel } from "./components/GoalRunPanel";
import { OwnerSummary } from "./components/OwnerSummary";
import { ProviderIntelligence } from "./components/ProviderIntelligence";
import { ThemePanel } from "./components/ThemePanel";
import { applyTheme, applyPreview, clearPreview } from "./theme";
import { EMPTY_THEME_SNAPSHOT, type ThemePreviewView, type ThemeSnapshot } from "../shared/theme";
import type { HumanInterventionRequest } from "../shared/intervention";
import type { RunMode } from "../shared/owner-result";
import type { WorkAgentCount } from "../shared/work-mode";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApiProtocol, AppMode, AppSnapshot, BossTask, FinalizationPolicy, ProviderId, RemoteChannel, RunTransport, TaskMode, ViewBounds } from "../shared/contracts";
import { compileIntent } from "../shared/task-ir";
import { executionLabel, type ReviewMode } from "../shared/execution";
import { isDispatchGroupSize, MAX_ACTIVE_PROVIDERS } from "../shared/provider-policy";
import { emptySnapshot, shortTime, waitingLine } from "./state";
import "./styles.css";

function GoalNodeView({ goal }: { goal: import("../shared/project-tree").GoalView }) {
  return <li><span className={`goal-status goal-${goal.status}`}>{goal.status}</span> {goal.title}{goal.children.length > 0 && <ul>{goal.children.map((child) => <GoalNodeView key={child.id} goal={child} />)}</ul>}</li>;
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  /**
   * checkpoint-1 §10/§21: the active theme is applied to the document through a
   * single dedicated <style> element. The main process owns validation and the
   * activation decision; this state is only the applied result.
   */
  const [theme, setTheme] = useState<ThemeSnapshot>(EMPTY_THEME_SNAPSHOT);
  /** §17: the pending preview renders in its own layer, never as the active theme. */
  const [themePreview, setThemePreview] = useState<ThemePreviewView | undefined>();

  useEffect(() => {
    let cancelled = false;
    void window.boss.themeSnapshot()
      .then((next) => { if (!cancelled) setTheme(next); })
      .catch(() => { /* a theme read failure leaves the shipped appearance in place */ });
    // §47: a preview started before a restart is offered again instead of lost.
    void window.boss.themePreview()
      .then((pending) => { if (!cancelled && pending) setThemePreview(pending); })
      .catch(() => { /* no pending preview */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const result = applyTheme(theme);
    if (!result.applied && result.reason) console.warn("[theme] not applied:", result.reason);
  }, [theme]);

  useEffect(() => {
    if (!themePreview) { clearPreview(); return; }
    const result = applyPreview(themePreview.css, themePreview.id);
    if (!result.applied) console.warn("[theme] preview not applied:", result.reason);
  }, [themePreview]);
  const [workspaceView, setWorkspaceViewUi] = useState<"MERGED" | "DETACHED">("MERGED");
  const [progress, setProgress] = useState<Array<import("../shared/progress").ProgressSummary>>([]);
  const [interventions, setInterventions] = useState<HumanInterventionRequest[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TaskMode>("direct");
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [finalizationPolicy, setFinalizationPolicy] = useState<FinalizationPolicy | "">("");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("BALANCED");
  const [workAgentCount, setWorkAgentCount] = useState<WorkAgentCount>(3);
  const [runMode, setRunMode] = useState<RunMode>("OWNER_RESULT");
  const [workspacePath, setWorkspacePath] = useState("");
  const [transportChoices, setTransportChoices] = useState<Record<ProviderId, RunTransport>>({});
  const [historyDialog, setHistoryDialog] = useState<HistoryDialogState | null>(null);
  const [conversationMenu, setConversationMenu] = useState<ConversationMenuState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [projectState, setProjectState] = useState<ProjectStateSummary | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(() => window.localStorage.getItem("codex-boss:history-collapsed") === "true");
  const [controllerWidth, setControllerWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("codex-boss:controller-width"));
    return Number.isFinite(saved) && saved >= 20 && saved <= 55 ? saved : 30;
  });
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("https://");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"chat" | "work" | "research" | "goal">("chat");
  const [researchGoal, setResearchGoal] = useState("");
  const [researchWorkspace, setResearchWorkspace] = useState("");
  const [researchAutonomy, setResearchAutonomy] = useState<"AUTOPILOT" | "GUIDED">("AUTOPILOT");
  const [researchStatus, setResearchStatus] = useState<{ id: string; state: string; protocolHash?: string } | null>(null);
  const [protocolDraft, setProtocolDraft] = useState({ hypothesis: "", primaryMetric: "accuracy", baseline: "0.5", sampleDefinition: "fixed benchmark tasks × seeds 1..N", evaluationCriterion: "mean accuracy > baseline" });
  const [protocolPreset, setProtocolPreset] = useState("standard");
  const PROTOCOL_PRESETS: Record<string, Partial<typeof protocolDraft> | null> = {
    custom: null,
    standard: { primaryMetric: "accuracy", baseline: "0.5", sampleDefinition: "fixed benchmark tasks × seeds 1..N", evaluationCriterion: "mean accuracy > baseline" },
    "accuracy-0.6": { primaryMetric: "accuracy", baseline: "0.6", sampleDefinition: "fixed benchmark tasks × seeds 1..N", evaluationCriterion: "mean accuracy > 0.6" }
  };
  function applyProtocolPreset(value: string) {
    setProtocolPreset(value);
    const preset = PROTOCOL_PRESETS[value];
    if (preset) setProtocolDraft((draft) => ({ ...draft, ...preset }));
  }
  const [researchRuns, setResearchRuns] = useState<Array<{ id: string; goal: string; state: string; updatedAt: string; protocolHash?: string; pendingStage?: string }>>([]);
  const [compileResult, setCompileResult] = useState<{ id: string; status: string; pdf?: string; tex?: string; cache?: string; message?: string } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const surfaceRefs = useRef<Partial<Record<ProviderId, HTMLDivElement | null>>>({});
  const openProviders = snapshot.providers.filter((provider) => provider.windowOpen);
  const selectedProviders = openProviders.map((provider) => provider.id);
  const openKey = openProviders.map((provider) => provider.id).join(",");
  // Phase 2: provider pane display order (open order → left → right), persisted.
  const [displayOrder, setDisplayOrder] = useState<ProviderId[]>(() => {
    const saved = window.localStorage.getItem("codex-boss:provider-display-order");
    if (saved) { try { const parsed = JSON.parse(saved) as ProviderId[]; if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) return parsed; } catch { /* fall through to default */ } }
    return openProviders.map((provider) => provider.id);
  });
  // U4 §9.2: persisted manual zoom per pane (≈ zoom applied to the visible page).
  const [manualZooms, setManualZooms] = useState<Record<ProviderId, number>>(() => {
    const saved = window.localStorage.getItem("codex-boss:provider-zoom");
    if (saved) { try { const parsed = JSON.parse(saved) as Record<string, number>; if (parsed && typeof parsed === "object") return parsed; } catch { /* fall through */ } }
    return {};
  });
  const displayZoom = (providerId: ProviderId): number | undefined => {
    const zoom = manualZooms[providerId];
    return zoom && Number.isFinite(zoom) && zoom > 0 ? Math.round(zoom * 100) / 100 : undefined;
  };
  useEffect(() => { window.localStorage.setItem("codex-boss:provider-zoom", JSON.stringify(manualZooms)); }, [manualZooms]);
  useEffect(() => { window.localStorage.setItem("codex-boss:provider-display-order", JSON.stringify(displayOrder)); }, [displayOrder]);
  useEffect(() => {
    // Newly opened providers append at the end; closed ones drop out.
    const openIds = new Set(openProviders.map((provider) => provider.id));
    const merged = [...displayOrder.filter((id) => openIds.has(id)), ...openProviders.filter((provider) => !displayOrder.includes(provider.id)).map((provider) => provider.id)];
    if (merged.join(",") !== displayOrder.join(",")) setDisplayOrder(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
  // DETACHED (second-window) mode: main window must give the interaction area
  // the full width and no longer reserve a web-processor module.
  useEffect(() => {
    let live = true;
    window.boss.getWorkspaceView().then((view) => { if (live) setWorkspaceViewUi(view.view); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, openKey]);
  const orderedOpenProviders = [...openProviders].sort((a, b) => displayOrder.indexOf(a.id) - displayOrder.indexOf(b.id));
  function moveDisplayOrder(providerId: ProviderId, direction: -1 | 1) {
    setDisplayOrder((current) => {
      const index = current.indexOf(providerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      next.splice(index, 1);
      next.splice(target, 0, providerId);
      return next;
    });
  }

  useEffect(() => {
    void window.boss.snapshot().then(setSnapshot).catch((reason) => setError(String(reason)));
    void window.boss.projectState().then(setProjectState).catch(() => {});
    const refreshProgress = () => { void window.boss.progress().then(setProgress).catch(() => {}); void window.boss.listInterventions().then((items) => setInterventions(items.filter((item) => !item.resolvedAt))).catch(() => {}); void window.boss.researchList().then(setResearchRuns).catch(() => {}); };
    refreshProgress();
    const timer = window.setInterval(refreshProgress, 1500);
    const unsubscribe = window.boss.onSnapshot((next) => { setSnapshot(next); void window.boss.projectState().then(setProjectState).catch(() => {}); });
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, []);

  useEffect(() => {
    const sendLayout = () => {
      const layout: Partial<Record<ProviderId, ViewBounds>> = {};
      for (const provider of openProviders) {
        const element = surfaceRefs.current[provider.id];
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        layout[provider.id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      void window.boss.layoutViews(layout);
    };
    const frame = requestAnimationFrame(sendLayout);
    const observer = new ResizeObserver(sendLayout);
    for (const provider of openProviders) {
      const element = surfaceRefs.current[provider.id];
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", sendLayout);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sendLayout);
    };
  }, [openKey]);

  useEffect(() => {
    void window.boss.setProviderViewsVisible(!settingsOpen && !managerOpen && !historyDialog);
    return () => { if (settingsOpen || managerOpen || historyDialog) void window.boss.setProviderViewsVisible(true); };
  }, [settingsOpen, managerOpen, historyDialog]);

  useEffect(() => {
    window.localStorage.setItem("codex-boss:history-collapsed", String(historyCollapsed));
  }, [historyCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("codex-boss:controller-width", String(controllerWidth));
  }, [controllerWidth]);

  const activeConversation = snapshot.conversations.find((conversation) => conversation.id === snapshot.activeConversationId);
  // Phase B: chips show conversation inputs not yet consumed by any task of
  // this conversation (uploads ride with the next message until bound).
  const consumedInputIds = useMemo(() => new Set(snapshot.tasks.filter((task) => task.conversationId === snapshot.activeConversationId).flatMap((task) => task.inputObjectIds ?? [])), [snapshot.tasks, snapshot.activeConversationId]);
  const pendingAttachments = useMemo(() => (activeConversation?.inputObjects ?? []).filter((ref) => !consumedInputIds.has(ref.id)), [activeConversation, consumedInputIds]);
  const hasComposerPrimaryInput = Boolean(prompt.trim() || (appMode === "work" && pendingAttachments.length));
  const hasValidDispatchGroup = isDispatchGroupSize(selectedProviders.length)
    || (Boolean(prompt.trim()) && prompt.length <= 100000 && compileIntent(prompt).estimatedComplexity === "L0");
  const composerBlockReason = appMode === "chat" && !prompt.trim() && pendingAttachments.length > 0
    ? "Chat 模式需要任务文字；仅工作书请切换到 Work"
    : !hasComposerPrimaryInput
    ? appMode === "work" ? "请输入任务文字或上传至少一个附件" : "请输入任务文字"
    : !hasValidDispatchGroup
      ? "请选择 1–5 个已打开的 AI；附件-only 任务至少需要 1 个 AI"
      : "";
  const activeTasks = useMemo(() => snapshot.tasks.filter((task) => !task.parentTaskId && task.conversationId === snapshot.activeConversationId).slice(0, 50).reverse(), [snapshot.tasks, snapshot.activeConversationId]);
  useEffect(() => {
    const pane = conversationRef.current;
    if (pane && followLatestRef.current) pane.scrollTop = pane.scrollHeight;
  }, [snapshot.finalResponses, snapshot.activeConversationId, activeTasks.length]);
  useEffect(() => { followLatestRef.current = true; const pane = conversationRef.current; if (pane) pane.scrollTop = pane.scrollHeight; }, [snapshot.activeConversationId]);
  const pendingRemoteCommands = snapshot.remoteCommands.filter((command) => command.status === "pending");
  const activeProgress = progress.filter((item) => snapshot.tasks.some((task) => task.id === item.taskId && !["cancelled", "paused", "completed", "failed"].includes(task.status)));

  async function resolveIntervention(request: HumanInterventionRequest, answer: string) {
    await window.boss.resolveIntervention(request.taskId, request.kind, answer);
    setInterventions((current) => current.filter((item) => item.id !== request.id));
  }

  async function toggleProvider(providerId: ProviderId) {
    setError("");
    try {
      if (prompt.trim()) throw new Error("当前任务已有输入，AI 选择和网页/API 通道已锁定；清空输入后再切换");
      const target = snapshot.providers.find((provider) => provider.id === providerId);
      if (!target) throw new Error(`Unknown provider: ${providerId}`);
      if (!target.windowOpen && openProviders.length >= MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
      setSnapshot(target.windowOpen ? await window.boss.closeProvider(providerId) : await window.boss.openProvider(providerId));
    } catch (reason) { setError(String(reason)); }
  }

  async function addCustomProvider(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const next = await window.boss.addCustomProvider({ name: customName, url: customUrl });
      const added = next.providers.at(-1);
      setSnapshot(next);
      if (added?.isCustom && openProviders.length < MAX_ACTIVE_PROVIDERS) setSnapshot(await window.boss.openProvider(added.id));
      setCustomName("");
      setCustomUrl("https://");
      setCustomOpen(false);
    } catch (reason) { setError(String(reason)); }
  }

  async function removeCustomProvider(providerId: ProviderId) {
    setError("");
    try {
      setSnapshot(await window.boss.removeCustomProvider(providerId));
    } catch (reason) { setError(String(reason)); }
  }

  async function uploadFiles(files: File[]) {
    setError("");
    try {
      const conversationId = snapshot.activeConversationId;
      if (!conversationId) throw new Error("没有活动对话");
      if (!files.length) return;
      for (const file of files) {
        if (file.size > 200 * 1024 * 1024) throw new Error(`附件超过大小上限（200 MB）：${file.name}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        setSnapshot(await window.boss.addAttachmentBytes({ conversationId, originalName: file.name, mime: file.type || undefined, bytes }));
      }
    } catch (reason) { setError(String(reason)); }
  }

  async function removeAttachment(inputObjectId: string) {
    setError("");
    try {
      setSnapshot(await window.boss.removeAttachment(snapshot.activeConversationId, inputObjectId));
    } catch (reason) { setError(String(reason)); }
  }

  async function pickAttachments() {
    setError("");
    try {
      const conversationId = snapshot.activeConversationId;
      if (!conversationId) throw new Error("没有活动对话");
      setSnapshot(await window.boss.pickAttachments(conversationId));
    } catch (reason) { setError(String(reason)); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!hasComposerPrimaryInput) { setError(appMode === "work" ? "无法提交：请输入任务文字或上传至少一个附件" : "无法提交：Chat 模式需要任务文字；仅工作书请切换到 Work"); return; }
    if (!hasValidDispatchGroup) { setError("无法提交：请选择 1–5 个已打开的 AI"); return; }
    setSending(true);
    setError("");
    try {
      const title = prompt.trim() ? prompt.trim().split(/\r?\n/, 1)[0].slice(0, 48) : undefined;
      setSnapshot(await window.boss.dispatchTask({ title, prompt: prompt.trim() || undefined, providerIds: selectedProviders, mode, appMode, workspacePath: workspacePath.trim() || undefined, reviewPolicy: { mode: reviewMode, maxRetries: 2 }, finalizationPolicy: finalizationPolicy || undefined, transportByProvider: appMode === "chat" ? {} : transportChoices, conversationId: snapshot.activeConversationId, inputObjectIds: pendingAttachments.length ? pendingAttachments.map((ref) => ref.id) : undefined, workAgentCount: appMode === "work" ? workAgentCount : undefined, runMode: appMode === "work" ? runMode : undefined }));
      setPrompt("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function startResearch(event: React.FormEvent) {
    event.preventDefault();
    if (!researchGoal.trim() || !researchWorkspace.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      if (!selectedProviders.length) throw new Error("Research 需要至少一个已打开的网页 AI 作为 reviewer");
      // Milestone §1: the human research question is the immutable anchor; the
      // normal path is Start ONCE → the conductor autopilot drives to READY
      // (live semantic stages use the logged-in providers, 1 primary + backup).
      const record = await window.boss.researchStart({
        researchQuestion: researchGoal.trim(),
        workspace: researchWorkspace.trim(),
        reviewers: selectedProviders,
        providerPolicy: researchAutonomy === "GUIDED" ? "FIXED" : "AUTO",
        autonomy: researchAutonomy,
        maxExperiments: 3,
        maxSteps: 200,
        maxProviderCalls: 200
      }) as { ir: { id: string; state: string; protocolHash?: string } };
      setResearchStatus({ id: record.ir.id, state: record.ir.state, protocolHash: record.ir.protocolHash });
      setCompileResult(null);
      setResearchGoal("");
      if (researchAutonomy !== "GUIDED") {
        const result = await window.boss.researchAutopilot(record.ir.id, 400) as { state: string; steps: number } | null;
        const refreshed = await window.boss.researchStatus(record.ir.id) as { ir: { state: string; protocolHash?: string; pendingStage?: string } } | null;
        if (refreshed) setResearchStatus({ id: record.ir.id, state: refreshed.ir.state, protocolHash: refreshed.ir.protocolHash });
        if (result?.state === "READY") setError("研究完成：READY — paper.tex / paper.pdf 已生成（研究缓存根见“编译 PDF”区）");
        else if (result) setError(`研究已自动推进到阻塞点：${result.state}${refreshed?.ir.pendingStage ? `（待办 ${refreshed.ir.pendingStage}）` : ""}`);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function advanceResearch() {
    if (!researchStatus || sending) return;
    setSending(true);
    setError("");
    try {
      const next = await window.boss.researchStep(researchStatus.id) as { state: string } | null;
      const refreshed = await window.boss.researchStatus(researchStatus.id) as { ir: { state: string; protocolHash?: string } } | null;
      setResearchStatus(next ? { id: researchStatus.id, state: next.state, protocolHash: researchStatus.protocolHash } : refreshed ? { id: researchStatus.id, state: refreshed.ir.state, protocolHash: refreshed.ir.protocolHash } : researchStatus);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  async function autopilotResearch() {
    if (!researchStatus || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await window.boss.researchAutopilot(researchStatus.id) as { state: string; steps: number } | null;
      const refreshed = await window.boss.researchStatus(researchStatus.id) as { ir: { state: string; protocolHash?: string } } | null;
      if (refreshed) setResearchStatus({ id: researchStatus.id, state: refreshed.ir.state, protocolHash: refreshed.ir.protocolHash });
      if (result && result.steps === 0) setError("研究已处于阻塞/终态（无需推进）");
    } catch (reason) { setError(String(reason)); }
    finally { setSending(false); }
  }

  async function compileResearchPdf(id: string) {
    setError("");
    setSending(true);
    try {
      const result = await window.boss.researchCompilePdf(id) as { status: "PASS" | "FAIL"; engine: string | null; tex: string; pdf: string | null; logTail: string; researchCache: string };
      setCompileResult({ id, status: result.status, pdf: result.pdf ?? undefined, tex: result.tex, cache: result.researchCache, message: result.logTail.slice(0, 300) });
    } catch (reason) { setError(String(reason)); }
    finally { setSending(false); }
  }

  /** Resumes a run parked at a control state (reviewer gate / guidance wait) to its pending stage. */
  async function resumeResearch() {
    if (!researchStatus || sending) return;
    setSending(true);
    setError("");
    try {
      const resumed = await window.boss.researchResume(researchStatus.id);
      if (!resumed) setError("该研究未处于可恢复的等待状态");
      const refreshed = await window.boss.researchStatus(researchStatus.id) as { ir: { state: string; protocolHash?: string } } | null;
      if (refreshed) setResearchStatus({ id: researchStatus.id, state: refreshed.ir.state, protocolHash: refreshed.ir.protocolHash });
      void window.boss.researchList().then(setResearchRuns).catch(() => {});
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  /** Freezes the research protocol via IPC (round 16 semantics: hash + PROTOCOL_FROZEN). */
  async function freezeProtocol(event: React.FormEvent) {
    event.preventDefault();
    if (!researchStatus || sending) return;
    if (!protocolDraft.hypothesis.trim()) { setError("Protocol 需要 hypothesis"); return; }
    setSending(true);
    setError("");
    try {
      const frozen = await window.boss.researchProtocolFreeze(researchStatus.id, { schemaVersion: 1, hypothesis: protocolDraft.hypothesis.trim(), primaryMetric: protocolDraft.primaryMetric.trim(), baseline: protocolDraft.baseline.trim(), sampleDefinition: protocolDraft.sampleDefinition.trim(), evaluationCriterion: protocolDraft.evaluationCriterion.trim(), createdAt: new Date().toISOString() }) as { hash?: string } | null;
      const refreshed = await window.boss.researchStatus(researchStatus.id) as { ir: { state: string; protocolHash?: string } } | null;
      if (refreshed) setResearchStatus({ id: researchStatus.id, state: refreshed.ir.state, protocolHash: refreshed.ir.protocolHash ?? frozen?.hash });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSending(false);
    }
  }

  function createFolder() { setHistoryDialog({ mode: "create-folder", value: "新文件夹" }); }
  function createConversation(folderId = activeConversation?.folderId ?? snapshot.folders[0]?.id) {
    if (folderId) setHistoryDialog({ mode: "create-conversation", folderId, value: "新对话" });
  }
  function renameFolder(targetId: string, value: string) { setHistoryDialog({ mode: "rename-folder", targetId, value }); }
  function renameConversation(targetId: string, value: string) { setHistoryDialog({ mode: "rename-conversation", targetId, value }); }
  async function saveHistoryName(value: string) {
    if (!historyDialog) return;
    switch (historyDialog.mode) {
      case "create-folder": setSnapshot(await window.boss.createFolder(value)); break;
      case "create-conversation": setSnapshot(await window.boss.createConversation({ folderId: historyDialog.folderId!, title: value })); setPrompt(""); break;
      case "rename-folder": setSnapshot(await window.boss.renameFolder(historyDialog.targetId!, value)); break;
      case "rename-conversation": setSnapshot(await window.boss.renameConversation(historyDialog.targetId!, value)); break;
    }
  }

  const visibleConversations = useMemo(() => snapshot.conversations.filter((conversation) => showArchived || !conversation.archived), [snapshot.conversations, showArchived]);

  async function archiveConversation(conversationId: string) {
    const target = snapshot.conversations.find((item) => item.id === conversationId);
    if (!target) return;
    const next = await window.boss.archiveConversation(conversationId, !target.archived);
    setSnapshot(next);
    if (next.activeConversationId !== conversationId) return;
  }

  async function deleteConversation(conversationId: string) {
    if (!window.confirm("删除后该对话的任务、运行记录、原始证据与最终回答将一并删除（历史文件同步清理），且不可恢复。确认删除？")) return;
    setSnapshot(await window.boss.deleteConversation(conversationId, true));
  }

  function toggleMultiSelect() {
    setMultiSelectMode((value) => { if (value) setSelectedConversationIds([]); return !value; });
  }
  function toggleConversationSelection(conversationId: string) {
    setSelectedConversationIds((current) => current.includes(conversationId) ? current.filter((id) => id !== conversationId) : [...current, conversationId]);
  }
  async function deleteSelectedConversations() {
    if (!selectedConversationIds.length) return;
    if (!window.confirm(`删除所选 ${selectedConversationIds.length} 个对话？其任务/运行/证据/最终回答将一并删除且不可恢复。`)) return;
    try {
      setSnapshot(await window.boss.deleteConversations(selectedConversationIds, true));
      setSelectedConversationIds([]);
      setMultiSelectMode(false);
    } catch (reason) { setError(String(reason)); }
  }

  function openConversationMenu(event: React.MouseEvent, conversationId: string) {
    event.preventDefault();
    event.stopPropagation();
    setConversationMenu({ conversationId, x: event.clientX, y: event.clientY });
  }

  async function duplicateConversation(conversationId: string) {
    const next = await window.boss.duplicateConversation(conversationId);
    setSnapshot(next);
    setPrompt("");
  }

  async function exportConversation(conversationId: string) {
    try { await window.boss.exportConversation(conversationId); }
    catch (reason) { setError(String(reason)); }
  }

  const menuActions = conversationMenu ? {
    rename: (id: string) => { const conversation = snapshot.conversations.find((item) => item.id === id); if (conversation) renameConversation(id, conversation.title); },
    move: (id: string) => { const conversation = snapshot.conversations.find((item) => item.id === id); const current = snapshot.folders.findIndex((item) => item.id === conversation?.folderId); const next = snapshot.folders[(current + 1) % snapshot.folders.length]; if (conversation && next) void window.boss.moveConversation(id, next.id).then(setSnapshot).catch((reason) => setError(String(reason))); },
    duplicate: (id: string) => void duplicateConversation(id),
    export: (id: string) => void exportConversation(id),
    archive: (id: string) => void archiveConversation(id),
    delete: (id: string) => void deleteConversation(id)
  } : null;

  function toggleTransport(providerId: ProviderId) {
    if (prompt.trim()) return;
    setTransportChoices((current) => ({ ...current, [providerId]: current[providerId] === "api" ? "web" : "api" }));
  }

  async function saveApiSetting(event: React.FormEvent<HTMLFormElement>, providerId: ProviderId) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      setSnapshot(await window.boss.updateApiSetting({
        providerId,
        enabled: data.get("enabled") === "on",
        protocol: String(data.get("protocol")) as ApiProtocol,
        baseUrl: String(data.get("baseUrl")),
        model: String(data.get("model")),
        apiKey: String(data.get("apiKey") ?? ""),
        clearApiKey: data.get("clearApiKey") === "on"
      }));
    } catch (reason) { setError(String(reason)); }
  }

  async function saveRemoteChannel(event: React.FormEvent<HTMLFormElement>, channel: RemoteChannel) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      setSnapshot(await window.boss.updateRemoteChannel({ channel, enabled: data.get("enabled") === "on", commandPrefix: String(data.get("commandPrefix") ?? "/boss") }));
    } catch (reason) { setError(String(reason)); }
  }

  async function saveRuntimeControl(event: React.FormEvent<HTMLFormElement>, runtimeId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try { setSnapshot(await window.boss.updateRuntimeControl(runtimeId, data.get("enabled") === "on", Number(data.get("priority") ?? 100))); }
    catch (reason) { setError(String(reason)); }
  }

  async function saveRoleRoute(event: React.FormEvent<HTMLFormElement>, route: AppSnapshot["roleRoutes"][number]) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const primary = String(data.get("primary") ?? "");
    const runtimeIds = [primary, ...route.runtimeIds.filter((runtimeId) => runtimeId !== primary)].filter(Boolean);
    try { setSnapshot(await window.boss.updateRoleRoute(route.role, runtimeIds, data.get("fallback") === "on")); }
    catch (reason) { setError(String(reason)); }
  }

  async function loadRemoteCommand(commandId: string, body: string) {
    setError("");
    try {
      if (prompt.trim()) throw new Error("当前输入框已有任务；请先提交或清空，再载入远程指令");
      setSnapshot(await window.boss.loadRemoteCommand(commandId));
      setPrompt(body);
    } catch (reason) { setError(String(reason)); }
  }

  function resizeController(clientX: number) {
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const historyWidth = historyCollapsed ? 40 : bounds.width * 0.15;
    const percentage = ((clientX - bounds.left - historyWidth) / bounds.width) * 100;
    setControllerWidth(Math.round(Math.max(20, Math.min(55, percentage)) * 10) / 10);
  }

  async function dismissRemoteCommand(commandId: string) {
    try { setSnapshot(await window.boss.dismissRemoteCommand(commandId)); }
    catch (reason) { setError(String(reason)); }
  }

  async function taskAction(taskId: string, action: "dispatch" | "capture" | "advance" | "evidence" | "accept" | "rehydrate" | "codex") {
    setError("");
    setSending(true);
    try {
      const next = action === "dispatch" ? await window.boss.sendTask(taskId)
        : action === "capture" ? await window.boss.captureTask(taskId)
            : action === "advance" ? await window.boss.advanceCouncil(taskId)
              : action === "evidence" ? await window.boss.buildEvidence(taskId)
                : action === "accept" ? await window.boss.acceptEvidence(taskId)
                  : action === "rehydrate" ? await window.boss.rehydrateEvidence(taskId)
                    : await window.boss.runCodexReview(taskId);
      setSnapshot(next);
    } catch (reason) { setError(String(reason)); }
    finally { setSending(false); }
  }

  function latestRuns(task: BossTask) {
    const runs = snapshot.runs.filter((run) => run.taskId === task.id);
    const round = Math.max(0, ...runs.map((run) => run.round));
    return runs.filter((run) => run.round === round);
  }

  return <div ref={shellRef} style={{ "--controller-width": `${controllerWidth}vw` } as React.CSSProperties} className={`desktop-shell ${openProviders.length === 3 ? "layout-three" : ""} ${openProviders.length === 5 ? "layout-five" : ""} ${historyCollapsed ? "history-collapsed" : ""} ${workspaceView === "DETACHED" ? "view-detached" : ""}`}>
    {historyDialog && <HistoryNameDialog state={historyDialog} onSubmit={saveHistoryName} onClose={() => setHistoryDialog(null)} />}
    {conversationMenu && menuActions && <ConversationContextMenu state={conversationMenu} actions={menuActions} onClose={() => setConversationMenu(null)} />}
    <aside className="history-sidebar" aria-label="对话历史">
      <div className="history-toolbar">
        {!historyCollapsed && <div className="app-mode-switch"><button className={appMode === "chat" ? "active" : ""} onClick={() => !prompt.trim() && setAppMode("chat")}>Chat</button><button className={appMode === "work" ? "active" : ""} onClick={() => !prompt.trim() && setAppMode("work")}>Work</button></div>}
        <button className="history-toggle" title={historyCollapsed ? "展开历史记录" : "收起历史记录"} aria-label={historyCollapsed ? "展开历史记录" : "收起历史记录"} aria-expanded={!historyCollapsed} aria-controls="history-content" onClick={() => setHistoryCollapsed((value) => !value)}>{historyCollapsed ? "›" : "‹"}</button>
      </div>
      {!historyCollapsed && <div id="history-content" className="history-content">
        <div className="history-actions"><button onClick={() => void createConversation()}>＋ 新对话</button><button title="新建文件夹" aria-label="新建文件夹" onClick={() => void createFolder()}>▣ 文件夹</button><button title={showArchived ? "隐藏已归档" : "显示已归档"} aria-label={showArchived ? "隐藏已归档" : "显示已归档"} aria-pressed={showArchived} className={showArchived ? "archive-toggle active" : "archive-toggle"} onClick={() => setShowArchived((value) => !value)}>🗄 {showArchived ? "隐藏归档" : "显示归档"}{snapshot.conversations.filter((conversation) => conversation.archived).length > 0 ? `（${snapshot.conversations.filter((conversation) => conversation.archived).length}）` : ""}</button><button title={multiSelectMode ? "退出多选" : "多选删除"} aria-pressed={multiSelectMode} className={multiSelectMode ? "archive-toggle active" : "archive-toggle"} onClick={toggleMultiSelect}>☑ {multiSelectMode ? "退出多选" : "多选"}</button></div>
        <div className="history-folders">{snapshot.folders.map((folder) => <section key={folder.id} className="history-folder"><header><b>{folder.name}</b><button onClick={() => void createConversation(folder.id)}>＋</button><button onClick={() => void renameFolder(folder.id, folder.name)}>···</button></header>{visibleConversations.filter((conversation) => conversation.folderId === folder.id).map((conversation) => <div key={conversation.id} className={`history-conversation ${conversation.archived ? "archived" : ""} ${conversation.id === snapshot.activeConversationId ? "active" : ""}${selectedConversationIds.includes(conversation.id) ? " selected" : ""}`} onContextMenu={(event) => openConversationMenu(event, conversation.id)}>{multiSelectMode && <label className="conversation-check"><input type="checkbox" aria-label={`选择 ${conversation.title}`} checked={selectedConversationIds.includes(conversation.id)} onChange={() => toggleConversationSelection(conversation.id)} /></label>}<button className="conversation-select" onClick={() => void window.boss.selectConversation(conversation.id).then(setSnapshot).catch((reason) => setError(String(reason)))}><span>{conversation.title}</span><small>{conversation.taskIds.length} 条任务{conversation.archived ? " · 已归档" : ""}</small></button><button className="conversation-menu-button" title="对话操作" aria-label={`${conversation.title} 操作`} onClick={(event) => openConversationMenu(event, conversation.id)}>···</button></div>)}</section>)}</div>
        {multiSelectMode && <div className="history-bulk-actions"><span>{selectedConversationIds.length} 个对话已选</span><button type="button" className="menu-danger" disabled={!selectedConversationIds.length} onClick={() => void deleteSelectedConversations()}>删除所选</button><button type="button" disabled={!selectedConversationIds.length} onClick={() => setSelectedConversationIds([])}>清空选择</button></div>}
        <footer>本地：history/{snapshot.folders.find((folder) => folder.id === activeConversation?.folderId)?.storageName ?? ""}/{activeConversation?.storageName ?? ""}</footer>
      </div>}
    </aside>

    <section className="chat-half">
      <header className="chat-header">
        <div className="app-brand"><span>C</span><div><strong>Controller</strong><small>CODEX BOSS · LOCAL COMMANDER</small></div></div>
        <div className="header-status"><button className="settings-button" onClick={() => setIntelOpen((value) => !value)}>智能面板</button><button className="settings-button" onClick={() => setManagerOpen(true)}>管理</button><button className="settings-button" onClick={() => setSettingsOpen(true)}>设置</button><div className="controller-pill"><i className={snapshot.controller.accountMode === "CHATGPT" ? "online" : ""} /> Codex Runtime: {snapshot.controller.accountMode}</div><div className="workspace-pill"><i /> 本地工作区</div></div>
      </header>

      <OwnerSummary />

      {intelOpen && <ProviderIntelligence onClose={() => setIntelOpen(false)} />}

      <div className="conversation" ref={conversationRef} onScroll={() => { const pane = conversationRef.current; if (pane) followLatestRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100; }}>
        {interventions.length > 0 && <div className="intervention-stack">{interventions.slice(0, 3).map((request) => <HumanInterventionCard key={request.id} request={request} onResolve={(kind, answer) => resolveIntervention({ ...request, kind }, answer)} />)}</div>}
        <ResearchProgress summaries={activeProgress} />
        {activeTasks.length === 0 && <div className="welcome-card">
          <div className="welcome-mark">⌘</div>
          <h1>{activeConversation?.title ?? "今天要处理什么？"}</h1>
          <p>在左侧输入一次任务，右侧会按所选网页版 AI 数量自动分屏。每个页面保持独立登录状态，并始终可见。</p>
        </div>

        }
        <details className="runtime-overview">
          <summary><b>Runtime Status</b><span>Main Commander 本地持有任务状态</span></summary>
          <div className="runtime-status-grid">{snapshot.runtimeStatuses.map((runtime) => <form key={runtime.runtimeId} onSubmit={(event) => void saveRuntimeControl(event, runtime.runtimeId)}><span className={`runtime-${runtime.availability.toLowerCase()}`}><i />{runtime.label}<small>{runtime.availability} · {runtime.budget}</small></span><label><input name="enabled" type="checkbox" defaultChecked={runtime.enabled} /> 启用</label><label>优先级 <input name="priority" type="number" min="0" max="999" defaultValue={runtime.priority} /></label><button type="submit">保存</button></form>)}</div>
          <div className="role-route-grid">{snapshot.roleRoutes.map((route) => <form key={route.role} onSubmit={(event) => void saveRoleRoute(event, route)}><b>{route.role}</b><select name="primary" defaultValue={route.runtimeIds[0]}>{snapshot.runtimeStatuses.filter((runtime) => runtime.enabled).map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.label}</option>)}</select><label><input name="fallback" type="checkbox" defaultChecked={route.fallback} /> fallback</label><button type="submit">设为首选</button></form>)}</div>
          {projectState && <div className="goal-tree-panel"><b>目标树</b><span>{projectState.tree}</span>{projectState.goals.length > 0 && <ul>{projectState.goals.map((goal) => <GoalNodeView key={goal.id} goal={goal} />)}</ul>}{projectState.openQuestions.length > 0 && <small>待决问题：{projectState.openQuestions.join("；")}</small>}{projectState.nextActions.length > 0 && <small>下一步：{projectState.nextActions.join("；")}</small>}</div>}
        </details>

        {activeTasks.map((task) => {
          const runs = latestRuns(task);
          const council = snapshot.councils.find((item) => item.taskId === task.id);
          const finalResponse = currentFinalResponse(snapshot, task.id);
          const presentation = taskPresentation(task, runs, finalResponse);
          const timeline = timelineForTask(snapshot.events, task.id);
          const evidence = snapshot.evidenceBundles.find((item) => finalResponse ? item.id === finalResponse.evidenceBundleId : item.taskId === task.id);
          const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === task.id && item.round === (council?.round ?? runs[0]?.round ?? 1));
          const artifactCount = snapshot.artifacts.filter((artifact) => artifact.taskId === task.id).length;
          const workbook = task.workbookDispatch;
          const allComplete = runs.length > 0 && runs.every((run) => run.phase === "completed");
          const canCapture = runs.some((run) => run.phase === "waiting");
          const canRetry = checkpoint?.status === "ROLLED_BACK" && !checkpoint.requiresReconciliation;
          const roundCommitted = checkpoint?.status === "COMMITTED" && !checkpoint.requiresReconciliation;
          return <article className="conversation-turn" key={task.id}>
          <div className="user-message"><span>你</span><p>{task.prompt || (workbook?.documents.length ? `仅工作书：${workbook.documents.map((document) => document.file_name).join("、")}` : "附件任务")}</p></div>
          <div className="boss-message">
            <div className="boss-avatar">B</div>
            <div><strong className="task-state" data-task-state={presentation.state} role="status">{presentation.label}</strong>
              <span className="task-provider-label">{task.plan?.estimatedComplexity === "L0" ? "本地任务" : "已分派到"} {task.providerIds.filter((id) => id !== "native:tools").map((id) => snapshot.providers.find((item) => item.id === id)?.name ?? id).join("、")}</span>
              <details className="task-technical-summary"><summary>任务信息</summary><p>{task.plan?.estimatedComplexity ?? "L1"} · {task.appMode.toUpperCase()} · {task.mode === "council" ? `Council · ${council?.stage ?? "初始化"} · 第 ${council?.round ?? 1} 轮` : "Direct"}，任务状态：{task.executionPhase ? executionLabel(task.executionPhase) : task.status}。</p></details>
              {workbook && <section className={`workbook-status workbook-${workbook.stage.toLowerCase()}`} aria-label="WorkBook 执行状态">
                <header><div><b>{workbook.classification ?? "WORKBOOK INTAKE"}</b>{workbook.confidence !== undefined && <span>置信度 {Math.round(workbook.confidence * 100)}%</span>}</div><strong>{workbook.stage}</strong></header>
                <p>{workbook.analysis_only ? "只分析：已编译，不会执行修改" : workbook.auto_run ? "可执行工作书：已自动进入执行链" : "未自动执行：参考资料、歧义输入或被策略阻止"}</p>
                {workbook.blocked_reason && <p className="workbook-blocked" role="alert">{workbook.blocked_reason}</p>}
                <ol className="workbook-stage-list">{workbook.stageHistory.map((entry, index) => <li key={`${entry.at}-${entry.stage}-${index}`}><b>{entry.stage}</b><span>{entry.detail}</span><time>{shortTime(entry.at)}</time></li>)}</ol>
                {workbook.conflicts.length > 0 && <details className="workbook-conflicts"><summary>冲突与隔离 · {workbook.conflicts.length}</summary>{workbook.conflicts.map((conflict, index) => <p key={`${conflict.kind}-${index}`}><b>{conflict.severity} · {conflict.kind}</b> {conflict.message}</p>)}</details>}
                {workbook.contract && <details className="workbook-contract"><summary>已编译 Task Contract</summary><dl><dt>Goal</dt><dd>{workbook.contract.goal.flatMap((item) => item.items).join("；") || "未声明"}</dd><dt>Scope</dt><dd>{workbook.contract.scope.flatMap((item) => item.items).join("；") || "未声明"}</dd><dt>Deliverables</dt><dd>{workbook.contract.deliverables.flatMap((item) => item.items).join("；") || "未声明"}</dd><dt>Acceptance</dt><dd>{workbook.contract.acceptance_criteria.flatMap((item) => item.items).join("；") || "未声明"}</dd></dl></details>}
              </section>}
              {waitingLine(task) && <p className="wait-readout" role="status">{waitingLine(task)}</p>}
              {task.modeTransition && task.interactionMode === "WORK_PROPOSED" && !task.modeTransition.approvedAt && <section className="mode-escalation-card" role="alert" aria-live="polite">
                <p><b>是否升级到 Work？</b> {task.modeTransition.reason}{task.modeTransition.requiredCapabilities.length > 0 && <small> 需要能力：{task.modeTransition.requiredCapabilities.join("、")}</small>}</p>
                <div><button type="button" className="confirm-send" disabled={sending} onClick={() => { setSending(true); window.boss.resolveModeProposal(task.id, true).then(setSnapshot).catch((reason) => setError(String(reason))).finally(() => setSending(false)); }}>继续到 Work</button><button type="button" disabled={sending} onClick={() => { setSending(true); window.boss.resolveModeProposal(task.id, false).then(setSnapshot).catch((reason) => setError(String(reason))).finally(() => setSending(false)); }}>保持 Chat</button></div>
              </section>}
              {task.finalizationBlocker && !finalResponse && <p><button className="retry-finalization" onClick={() => void window.boss.updateTask(task.id, "running").then(setSnapshot).catch((reason) => setError(String(reason)))}>重试整理答复</button></p>}
              {finalResponse && <section className="final-response" aria-label="最终回答"><pre>{finalResponse.content}</pre></section>}
              {/* WORK_UNIT_3: analysis-only work completes with no provider run and
                  no provider answer; the compiled Task Contract is the deliverable. */}
              {!finalResponse && isAnalysisOnlyCompletion(task) && <section className="final-response analysis-only-deliverable" aria-label="分析交付物"><p>只分析任务已完成：交付物是上方已编译的 Task Contract，未调用任何 AI，也没有 provider 证据。</p></section>}
              <details className="execution-details"><summary>执行与证据详情</summary>
              <div className="run-statuses">{runs.map((run) => <span className={`run-${run.phase}`} key={run.id}>{snapshot.providers.find((item) => item.id === run.providerId)?.name ?? run.providerId} [{run.transport}]: {run.phase}{run.outcome ? ` · ${run.outcome}` : ""}</span>)}</div>
              {timeline.length > 0 && <details className="task-timeline"><summary>任务时间线 · {timeline.length}</summary><ol>{timeline.map((entry, index) => <li key={`${entry.timestamp}-${entry.event}-${index}`}><time>{shortTime(entry.timestamp)}</time><span>{entry.message}</span>{entry.runtimeId && <code>{entry.runtimeId}</code>}{entry.evidenceRef && <code title={entry.evidenceRef}>证据 {entry.evidenceRef.slice(0, 8)}</code>}</li>)}</ol></details>}
              {checkpoint && <div className={`dispatch-checkpoint checkpoint-${checkpoint.status.toLowerCase()}`}><b>{checkpoint.status}</b><span>{checkpoint.successfulProviderIds.length}/{checkpoint.expectedProviderIds.length} 成功 · {checkpoint.message}</span></div>}
              {runs.map((run) => run.message && <small className="run-message" key={`${run.id}-message`}>{run.providerId} — {run.message}</small>)}
              {runs.filter((run) => run.review?.status === "PASS" && run.response).map((run) => <details className="worker-answer" open={!finalResponse && task.mode === "direct"} key={run.id + "-answer"}><summary>{run.providerId === "native:tools" ? "本地执行结果" : (snapshot.providers.find((provider) => provider.id === run.providerId)?.name ?? run.providerId) + " 的回答"}</summary><pre>{run.response!.content}</pre></details>)}
              <div className="task-actions">
                {task.status === "queued" && <button className="confirm-send" onClick={() => void window.boss.updateTask(task.id, "running").then(setSnapshot).catch((reason) => setError(String(reason)))} disabled={sending}>开始</button>}
                {task.status === "running" && <button onClick={() => void window.boss.updateTask(task.id, "paused").then(setSnapshot).catch((reason) => setError(String(reason)))} disabled={sending}>停止</button>}
                {(task.status === "paused" || task.status === "waiting") && <button className="confirm-send" onClick={() => void window.boss.updateTask(task.id, "running").then(setSnapshot).catch((reason) => setError(String(reason)))} disabled={sending}>恢复</button>}
                {task.status === "failed" && <button className="confirm-send" onClick={() => void taskAction(task.id, "dispatch")} disabled={sending}>重试</button>}
                {canRetry && <button className="confirm-send" onClick={() => void taskAction(task.id, "dispatch")} disabled={sending}>重新提交整组</button>}
                {canCapture && <button onClick={() => void taskAction(task.id, "capture")} disabled={sending}>并发采集本轮回答</button>}
                {task.mode === "council" && allComplete && roundCommitted && council && ["proposals", "peer_review", "synthesis"].includes(council.stage) && <button onClick={() => void taskAction(task.id, "advance")} disabled={sending}>提交下一轮到全部 AI</button>}
                {artifactCount > 0 && roundCommitted && <button onClick={() => void taskAction(task.id, "evidence")} disabled={sending}>生成证据包</button>}
                {evidence && <button onClick={() => void taskAction(task.id, "codex")} disabled={sending || evidence.codexReview.status === "RUNNING"}>Codex 账户审查</button>}
                {evidence?.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT") && <button onClick={() => void taskAction(task.id, "rehydrate")} disabled={sending}>选择性回填</button>}
              </div>
              {runs.some((run) => run.review?.status === "HUMAN_REQUIRED") && <button onClick={() => void window.boss.releaseReview(task.id).then(setSnapshot).catch((reason) => setError(String(reason)))}>确认接收回答</button>}
              {council && (council.conflicts.length > 0 || council.minorityOpinions.length > 0) && <div className="council-findings"><b>保留的争议</b><span>{council.conflicts.length} 个冲突 · {council.minorityOpinions.length} 个少数意见</span></div>}
              {evidence && <div className="evidence-card"><div><b>{evidence.decision}</b><code>{evidence.integrityRoot.slice(0, 12)}</code></div><span>{evidence.manifest.length} artifacts · {evidence.claims.length} claims · {evidence.disputes.length} disputes · 缺失 {evidence.missingProviderIds.length}</span><small>Codex review: {evidence.codexReview.status}</small>{evidence.codexReview.content && <p>{evidence.codexReview.content.slice(0, 500)}</p>}{evidence.decision !== "PASS" && <button onClick={() => void taskAction(task.id, "accept")} disabled={sending} title="确认接收当前证据为最终答复（DISPUTED/INSUFFICIENT claims 将由操作者裁决）">确认接收当前证据</button>}</div>}
              </details>
              <small>{shortTime(task.updatedAt)} · {task.plan?.estimatedComplexity === "L0" ? "本地工具" : task.providerIds.length + " 个独立页面"} · {artifactCount} 份原始证据</small>
            </div>
          </div>
        </article>; })}
      </div>

      <div className="composer-zone">
        <div className="top-view-nav"><button className={view === "chat" ? "active" : ""} onClick={() => { if (!prompt.trim()) { setView("chat"); setAppMode("chat"); } }}>Chat</button><button className={view === "work" ? "active" : ""} onClick={() => { if (!prompt.trim()) { setView("work"); setAppMode("work"); } }}>Work</button><button className={view === "research" ? "active" : ""} onClick={() => { if (!prompt.trim()) setView("research"); }}>Research</button><button className={view === "goal" ? "active" : ""} onClick={() => { if (!prompt.trim()) setView("goal"); }} title="自主工程目标（U10）">工程目标</button></div>
        {view === "research" ? <form className="research-launcher" onSubmit={startResearch}>
          <label>Research Goal <textarea aria-label="研究目标" value={researchGoal} maxLength={20000} onChange={(event) => setResearchGoal(event.target.value)} rows={2} placeholder="例如：研究 Codex Boss 的证据化多 AI 决策 vs 多数投票，完成真实实验并写 pre-print" /></label>
          <label>Workspace <input aria-label="研究仓库" value={researchWorkspace} onChange={(event) => setResearchWorkspace(event.target.value)} placeholder="本地仓库目录" /></label>
          <details className="research-advanced"><summary>高级选项（自主度 / Web AI reviewers）</summary><label>Autonomy <select aria-label="自主度" value={researchAutonomy} onChange={(event) => setResearchAutonomy(event.target.value as "AUTOPILOT" | "GUIDED")}><option value="AUTOPILOT">Autopilot</option><option value="GUIDED">Guided</option></select></label>
          <div className="research-reviewers">Web AI reviewers：{openProviders.length ? openProviders.map((provider) => provider.name).join("、") : "未打开任何网页 AI"}</div>
          </details>
          <button type="submit" disabled={!researchGoal.trim() || !researchWorkspace.trim() || sending || !openProviders.length}>启动 Research（证据 &gt; 投票）</button>
          {researchStatus && !researchStatus.protocolHash && <form className="research-status research-status-freeze" onSubmit={(event) => void freezeProtocol(event)}><b>冻结协议（实验前必填；冻结后不可静默修改）</b><label className="protocol-preset">协议模板（下拉或自定义）<select aria-label="协议模板" value={protocolPreset} onChange={(event) => applyProtocolPreset(event.target.value)}><option value="standard">标准：accuracy vs 0.5</option><option value="accuracy-0.6">accuracy vs 0.6</option><option value="custom">自定义（下方手填）</option></select></label><label>Hypothesis <input aria-label="协议假设" value={protocolDraft.hypothesis} maxLength={2000} onChange={(event) => setProtocolDraft((draft) => ({ ...draft, hypothesis: event.target.value }))} placeholder="H: 可证伪假设" /></label><label>Primary metric <input aria-label="主指标" value={protocolDraft.primaryMetric} onChange={(event) => setProtocolDraft((draft) => ({ ...draft, primaryMetric: event.target.value }))} /></label><label>Baseline <input aria-label="基线" value={protocolDraft.baseline} onChange={(event) => setProtocolDraft((draft) => ({ ...draft, baseline: event.target.value }))} /></label><label>Sample definition <input aria-label="样本定义" value={protocolDraft.sampleDefinition} onChange={(event) => setProtocolDraft((draft) => ({ ...draft, sampleDefinition: event.target.value }))} /></label><label>Evaluation criterion <input aria-label="评估标准" value={protocolDraft.evaluationCriterion} onChange={(event) => setProtocolDraft((draft) => ({ ...draft, evaluationCriterion: event.target.value }))} /></label><button type="submit" disabled={sending || !protocolDraft.hypothesis.trim()}>冻结协议</button></form>}
          {researchStatus && researchStatus.protocolHash && <div className="research-status" role="status"><span>研究 {researchStatus.id} · 当前阶段 {researchStatus.state}{researchStatus.protocolHash ? ` · 协议已冻结 ${researchStatus.protocolHash.slice(0, 8)}` : ""}</span>{["WAITING_FOR_PROVIDER", "WAITING_FOR_USER", "RECOVERING"].includes(researchStatus.state) ? <button type="button" disabled={sending} onClick={() => void resumeResearch()}>恢复研究（回到待办阶段）</button> : <button type="button" disabled={sending} onClick={() => void advanceResearch()}>推进下一阶段</button>}<button type="button" disabled={sending} title="自动推进到 READY/FAILED 或第一个真实阻塞点" onClick={() => void autopilotResearch()}>自动推进</button><button type="button" disabled={sending} title="编译 manuscript/paper.tex → paper.pdf" onClick={() => void compileResearchPdf(researchStatus.id)}>编译 PDF</button></div>}
          {compileResult && <div className={`research-status compile-result compile-${compileResult.status.toLowerCase()}`} role="status"><b>LaTeX {compileResult.status === "PASS" ? "编译成功" : "编译失败"}</b>{compileResult.pdf && <span>PDF: {compileResult.pdf}</span>}{compileResult.tex && <span>TEX: {compileResult.tex}</span>}{compileResult.cache && <span>Research cache: {compileResult.cache}</span>}{compileResult.message && <small>{compileResult.message}</small>}</div>}
          {researchRuns.length > 0 && <details className="research-runs"><summary><b>已有研究（{researchRuns.length}）</b><span className="research-runs-hint">已完成的成果已自动导出到 工作区 Research/主题/ 下；旧研究不参与新研究，展开后可单独查看/编译/处理</span></summary><div className="research-run-list">{researchRuns.map((run) => <div className="research-run-row" key={run.id}><span>{run.goal.slice(0, 80)}</span><small>{run.state} · {run.updatedAt.slice(0, 16).replace("T", " ")}{run.protocolHash ? " · 已冻结" : ""}{run.pendingStage ? ` · 待办 ${run.pendingStage}` : ""}</small><button type="button" onClick={() => void window.boss.researchStatus(run.id).then((record) => setResearchStatus({ id: run.id, state: (record as { ir: { state: string; protocolHash?: string } }).ir.state, protocolHash: (record as { ir: { state: string; protocolHash?: string } }).ir.protocolHash })).catch(() => {})}>查看</button><button type="button" onClick={() => void compileResearchPdf(run.id)}>编译 PDF</button></div>)}</div></details>}
        </form> : view === "goal" ? <GoalRunPanel busy={sending} onBusyChange={setSending} onError={(message) => setError(message)} /> : <>
        <div className="execution-options"><label>审查策略 <select aria-label="审查策略" value={reviewMode} onChange={(event) => setReviewMode(event.target.value as ReviewMode)}><option value="STRICT">严格</option><option value="BALANCED">平衡</option><option value="AUTONOMOUS">自主</option></select></label><label>最终答复 <select aria-label="最终答复策略" value={finalizationPolicy} onChange={(event) => setFinalizationPolicy(event.target.value as FinalizationPolicy | "")}><option value="">自动</option><option value="DIRECT">直接交付</option><option value="CODEX_IF_AVAILABLE">尝试 Codex 整理</option><option value="CODEX_REQUIRED">等待 Codex 整理</option></select></label>{appMode === "work" && <><label>AI 数量 <select aria-label="Work AI 数量" value={workAgentCount} onChange={(event) => setWorkAgentCount(Number(event.target.value) as WorkAgentCount)}><option value={1}>1</option><option value={3}>3</option><option value={5}>5</option></select></label><label>执行模式 <select aria-label="Work 执行模式" value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)}><option value="OWNER_RESULT">Owner-Result</option><option value="AUTONOMOUS">自主</option><option value="ASSISTED">协助</option></select></label><label>工作区 <input aria-label="工作区路径" value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="本地项目目录" /></label></>}</div></>}
        <div className="mode-switch"><button className={mode === "direct" ? "active" : ""} onClick={() => setMode("direct")}>Direct</button><button className={mode === "council" ? "active" : ""} onClick={() => setMode("council")}>Council</button><span>{mode === "council" ? "独立提案 → 匿名评审 → 冲突保留 → 综合" : "一次任务分派到所选页面"}</span></div>
        <div className="provider-picker">
          <div className="picker-label"><span>调用页面</span><b>{selectedProviders.length} / {MAX_ACTIVE_PROVIDERS}</b></div>
          <div className="provider-options">{snapshot.providers.map((provider) => <div className={`provider-choice ${provider.windowOpen ? "selected" : ""}`} key={provider.id}>
            <button type="button" className="provider-toggle" disabled={Boolean(prompt.trim())} title={prompt.trim() ? "任务已有输入，AI 选择已锁定" : "打开或关闭该 AI"} onClick={() => void toggleProvider(provider.id)}><i style={{ background: provider.accent }} />{provider.name}</button>
            {appMode === "work" && provider.windowOpen && <button type="button" className={`transport-toggle transport-${transportChoices[provider.id] ?? "web"}`} disabled={Boolean(prompt.trim())} title={prompt.trim() ? "任务已有输入，通道已锁定" : "切换网页/API"} onClick={() => toggleTransport(provider.id)}>{transportChoices[provider.id] ?? "web"}</button>}
            {provider.isCustom && <button type="button" className="provider-remove" aria-label={`移除 ${provider.name}`} onClick={() => void removeCustomProvider(provider.id)}>×</button>}
          </div>)}</div>
          <button type="button" className="add-provider" disabled={Boolean(prompt.trim())} onClick={() => setCustomOpen((value) => !value)}>＋ 自定义</button>
        </div>
        <div className="account-module"><b>账户会话</b>{openProviders.map((provider) => { const account = snapshot.accounts.find((item) => item.providerId === provider.id); return <span key={provider.id}><i className={`account-${(account?.mode ?? "UNKNOWN").toLowerCase()}`} />{provider.name}: {account?.mode ?? "UNKNOWN"}</span>; })}</div>
        {customOpen && <form className="custom-provider-form" onSubmit={addCustomProvider}>
          <input value={customName} maxLength={50} onChange={(event) => setCustomName(event.target.value)} placeholder="AI 名称" autoFocus />
          <input value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://example.com/chat" type="url" />
          <button type="submit" disabled={!customName.trim() || !customUrl.trim()}>添加</button>
          <button type="button" onClick={() => setCustomOpen(false)}>取消</button>
        </form>}
        {pendingRemoteCommands.length > 0 && <section className="remote-inbox"><header><b>远程指令待确认</b><span>{pendingRemoteCommands.length}</span></header>{pendingRemoteCommands.slice(0, 3).map((command) => <article key={command.id}><div><strong>{command.channel === "wechat" ? "微信" : "QQ"}</strong><small>{command.sourceWindow} · {shortTime(command.receivedAt)}</small><p>{command.body}</p></div><button type="button" onClick={() => void loadRemoteCommand(command.id, command.body)} disabled={Boolean(prompt.trim())}>载入</button><button type="button" onClick={() => void dismissRemoteCommand(command.id)}>忽略</button></article>)}</section>}
        <form className="prompt-composer" onSubmit={submit}>
          <AttachmentTray pending={pendingAttachments} busy={sending} onFiles={(files) => uploadFiles(files)} onPick={() => pickAttachments()} onRemove={(id) => removeAttachment(id)} />
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="向多个网页 AI 发起任务…" rows={3} onPaste={(event) => { const files = Array.from(event.clipboardData.files ?? []); if (files.length) { event.preventDefault(); void uploadFiles(files); } }} />
          {composerBlockReason && <p className="composer-block-reason" role="status">{composerBlockReason}</p>}
          <div className="composer-footer"><span>{appMode === "chat" ? "Chat：全部使用可见网页" : "Work：工作书可作为唯一输入，任务输入后锁定各 AI 的网页/API 通道"}；所选 AI 回答通过审查后继续{pendingAttachments.length ? ` · ${pendingAttachments.length} 个附件` : ""}</span><button type="submit" title={composerBlockReason || `提交到全部 ${selectedProviders.length} 个 AI${pendingAttachments.length ? `（含 ${pendingAttachments.length} 个附件）` : ""}`} disabled={Boolean(composerBlockReason) || sending}>{sending ? "…" : "↑"}</button></div>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>
      {managerOpen && <ManagerPanel snapshot={snapshot} onClose={() => setManagerOpen(false)} onChanged={(next) => setSnapshot(next)} onError={(message) => setError(message)} />}
      {settingsOpen && <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-panel"><header><div><strong>Codex Boss 设置</strong><span>API Key 加密保存；微信/QQ 指令仅从本机可见窗口读取</span></div><button onClick={() => setSettingsOpen(false)}>×</button></header><div className="api-settings-list"><ThemePanel theme={theme} onTheme={setTheme} onError={(message) => setError(message)} onPreview={setThemePreview} /><section className="remote-settings"><div className="settings-section-title"><b>PC 远程指令</b><span>先登录桌面客户端；仅识别前缀消息并进入人工确认队列</span></div>{snapshot.remoteChannels.map((setting) => <form key={`${setting.channel}-${setting.updatedAt}`} className="remote-setting-card" onSubmit={(event) => void saveRemoteChannel(event, setting.channel)}><div><b>{setting.channel === "wechat" ? "微信" : "QQ"}</b><i className={`remote-status status-${setting.status}`} /> <span>{setting.status}</span><small>{setting.message}</small></div><label>前缀 <input name="commandPrefix" defaultValue={setting.commandPrefix} pattern="/[^\\s]{1,19}" required /></label><label><input name="enabled" type="checkbox" defaultChecked={setting.enabled} /> 启用</label><button type="submit">保存</button></form>)}</section>{snapshot.providers.map((provider) => { const setting = snapshot.apiSettings.find((item) => item.providerId === provider.id); return <form key={`${provider.id}-${setting?.updatedAt ?? "new"}`} onSubmit={(event) => void saveApiSetting(event, provider.id)} className="api-setting-card"><div className="api-setting-title"><b>{provider.name}</b><span>{setting?.hasApiKey ? (setting.keyTail ? `密钥已保存 · sk-••••••••${setting.keyTail}` : "密钥已保存") : "未保存密钥"}</span><label><input name="enabled" type="checkbox" defaultChecked={setting?.enabled} /> 启用</label></div><div className="api-setting-fields"><select name="protocol" defaultValue={setting?.protocol ?? "openai-compatible"}><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select><input name="baseUrl" type="url" required defaultValue={setting?.baseUrl ?? "https://"} placeholder="API Base URL" /><input name="model" required defaultValue={setting?.model ?? ""} placeholder="模型名称" /><input name="apiKey" type="password" placeholder={setting?.hasApiKey ? "留空保留现有密钥" : "API Key"} /></div><div className="api-setting-actions"><label><input name="clearApiKey" type="checkbox" /> 清除已有密钥</label><button type="submit">保存</button></div></form>; })}</div></section></div>}
    </section>

    {openProviders.length === 3 && <div className="controller-resizer" role="separator" aria-label="调整 Controller 宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={55} aria-valuenow={controllerWidth} tabIndex={0} title="拖动调整 Controller 宽度；双击恢复 30%" onDoubleClick={() => setControllerWidth(30)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeController(event.clientX); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeController(event.clientX); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") setControllerWidth((value) => Math.max(20, value - 1)); else if (event.key === "ArrowRight") setControllerWidth((value) => Math.min(55, value + 1)); else if (event.key === "Home") setControllerWidth(30); }} />}

    <section className="browser-half">
      <header className="browser-header"><div><strong>网页处理器</strong><span>{openProviders.length} / {MAX_ACTIVE_PROVIDERS} 页面运行中</span></div><div className="window-dots"><i /><i /><i /></div></header>
      {openProviders.length === 0 ? <div className="browser-empty">
        <div className="snap-illustration"><span /><span /><span /></div>
        <h2>等待打开网页页面</h2><p>在主控页选中 AI 时会直接打开；取消选中或点击页面标题栏 × 会立即关闭。</p>
      </div> : <div className={`provider-grid count-${openProviders.length}`}>
        {orderedOpenProviders.map((provider, index) => {
          const account = snapshot.accounts.find((item) => item.providerId === provider.id);
          const providerBusy = snapshot.runs.some((run) => run.providerId === provider.id && ["sending", "waiting", "prepared"].includes(run.phase));
          const runtime = snapshot.runtimeStatuses.find((item) => item.runtimeId === `web:${provider.id}`);
          const accountMode = account?.mode ?? "UNKNOWN";
          return <article className="provider-pane" key={provider.id}>
          <div className="pane-title"><div><i className={`pane-account pane-${accountMode.toLowerCase()}`} style={{ background: provider.accent }} /><strong>{provider.name}</strong><span className={providerBusy ? "pane-busy" : ""}>{providerBusy ? "处理中…" : displayZoom(provider.id) ? `缩放 ${displayZoom(provider.id)}×` : runtime?.availability ?? accountMode}</span></div><div className="pane-order-controls">
            <button disabled={Boolean(prompt.trim())} title="缩小" onClick={() => { const current = displayZoom(provider.id) ?? 1; const next = Math.round(Math.max(0.4, current - 0.15) * 100) / 100; setManualZooms((zoom) => ({ ...zoom, [provider.id]: next })); void window.boss.setProviderZoom(provider.id, next); }}>−</button>
            <button disabled={Boolean(prompt.trim())} title="放大" onClick={() => { const current = displayZoom(provider.id) ?? 1; const next = Math.round(Math.min(3, current + 0.15) * 100) / 100; setManualZooms((zoom) => ({ ...zoom, [provider.id]: next })); void window.boss.setProviderZoom(provider.id, next); }}>＋</button>
            <button disabled={Boolean(prompt.trim())} title="重载页面" onClick={() => void window.boss.reloadProvider(provider.id)}>↻</button>
            <button disabled={index === 0 || Boolean(prompt.trim())} title="左移" onClick={() => moveDisplayOrder(provider.id, -1)}>‹</button>
            <button disabled={index === orderedOpenProviders.length - 1 || Boolean(prompt.trim())} title="右移" onClick={() => moveDisplayOrder(provider.id, 1)}>›</button>
            <button disabled={Boolean(prompt.trim())} title={prompt.trim() ? "任务已有输入，窗口选择已锁定" : "关闭"} onClick={() => { setManualZooms((zoom) => { const next = { ...zoom }; delete next[provider.id]; return next; }); void window.boss.closeProvider(provider.id); }}>×</button></div></div>
          <div className="web-surface" ref={(element) => { surfaceRefs.current[provider.id] = element; }}><span>正在载入 {provider.name}…</span></div>
        </article>;
        })}
      </div>}
    </section>
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
