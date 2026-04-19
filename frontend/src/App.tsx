import { useEffect, useReducer, useRef, useState } from "react";

import { ChatPanel } from "./components/ChatPanel";
import { DashboardHeader } from "./components/DashboardHeader";
import { ExternalDataImportPanel } from "./components/ExternalDataImportPanel";
import {
  PatientDataCanvas,
  type DataCanvasTab,
} from "./components/PatientDataCanvas";
import { useAskSession } from "./hooks/useAskSession";
import { useClinicalImports } from "./hooks/useClinicalImports";
import { useDashboardData } from "./hooks/useDashboardData";
import { useDebugRequests } from "./hooks/useDebugRequests";
import { usePatientLoader } from "./hooks/usePatientLoader";
import { usePatientOptions } from "./hooks/usePatientOptions";
import { agentReducer, getInitialAgentState } from "./store/agentReducer";
import type { AnswerEvidenceLink } from "./types";


const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableDialogElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return true;
  });
}

export default function App() {
  const [state, dispatch] = useReducer(
    agentReducer,
    undefined,
    getInitialAgentState,
  );
  const dashboardData = useDashboardData(state.currentHadmId);
  const {
    patientOptions,
    patientOptionsTotal,
    patientOptionsLoading,
    patientOptionsError,
    reloadPatientOptions,
  } = usePatientOptions();
  const { debugRequests } = useDebugRequests();
  const [activeCanvasTab, setActiveCanvasTab] = useState<DataCanvasTab>("vitals");
  const [hoveredAnswerLink, setHoveredAnswerLink] = useState<AnswerEvidenceLink | null>(null);
  const [selectedAnswerLink, setSelectedAnswerLink] = useState<AnswerEvidenceLink | null>(null);
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);
  const importPanelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // 使用封装的 hooks
  const { loadPatientByValue, selectPatientAndSyncInput } = usePatientLoader(dispatch);
  const { handleAskQuestion, handleCancelAsk } = useAskSession(dispatch);

  function closeImportPanel() {
    setIsImportPanelOpen(false);
  }

  function toggleImportPanel() {
    setIsImportPanelOpen((open) => !open);
  }

  useEffect(() => {
    if (!isImportPanelOpen) {
      return undefined;
    }

    lastFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = importPanelRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const focusableElements = getFocusableDialogElements(panel);
      const nextFocusTarget = focusableElements[0] ?? panel;
      nextFocusTarget?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImportPanel();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableDialogElements(panel);
      if (focusableElements.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstElement || activeElement === panel) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      const elementToRestore = lastFocusedElementRef.current;
      if (elementToRestore) {
        window.requestAnimationFrame(() => {
          elementToRestore.focus();
        });
      }
    };
  }, [isImportPanelOpen]);

  useEffect(() => {
    setHoveredAnswerLink(null);
    setSelectedAnswerLink(null);
  }, [state.askResult?.answer, state.askResult?.question_type]);

  const {
    importState,
    refreshImportHistory,
    handleImportClinicalData,
    handleDeleteImport,
  } = useClinicalImports({
    currentHadmId: state.currentHadmId,
    onPatientOptionsChanged: reloadPatientOptions,
    onSelectPatient: selectPatientAndSyncInput,
  });

  async function handleLoadPatient() {
    await loadPatientByValue(state.hadmIdInput, {
      setActiveCanvasTab,
      setHoveredAnswerLink,
      setSelectedAnswerLink,
    });
  }

  function handleSelectPatientOption(hadmIdValue: string) {
    dispatch({
      type: "SET_HADM_ID_INPUT",
      payload: hadmIdValue,
    });
    void loadPatientByValue(hadmIdValue, {
      setActiveCanvasTab,
      setHoveredAnswerLink,
      setSelectedAnswerLink,
    });
  }

  const activeAnswerLink = hoveredAnswerLink ?? selectedAnswerLink;
  const lastSubmittedQuestion =
    state.chatHistory[state.chatHistory.length - 1]?.question ?? "";
  const linkedFocusEvidence =
    activeAnswerLink && state.askResult
      ? state.askResult.evidence[activeAnswerLink.evidence_index] ?? null
      : null;

  return (
    <div className="app-shell">
      <DashboardHeader
        currentHadmId={state.currentHadmId}
        hadmIdInput={state.hadmIdInput}
        patientData={state.patientData}
        stage={state.stage}
        patientLoading={state.patientLoading}
        askLoading={state.askLoading}
        patientOptions={patientOptions}
        patientOptionsTotal={patientOptionsTotal}
        patientOptionsLoading={patientOptionsLoading}
        patientOptionsError={patientOptionsError}
        onHadmIdInputChange={(value) =>
          dispatch({
            type: "SET_HADM_ID_INPUT",
            payload: value,
          })
        }
        onLoadPatient={handleLoadPatient}
        onSelectPatientOption={handleSelectPatientOption}
        onReloadPatientOptions={reloadPatientOptions}
      />

      <main className="dashboard-layout">
        <PatientDataCanvas
          currentHadmId={state.currentHadmId}
          patientData={state.patientData}
          patientLoading={state.patientLoading}
          patientError={state.patientError}
          vitals={dashboardData.vitals}
          labs={dashboardData.labs}
          dataLoading={dashboardData.loading}
          dataError={dashboardData.error}
          activeTab={activeCanvasTab}
          onTabChange={setActiveCanvasTab}
          focusEvidence={linkedFocusEvidence}
          interactionEvidence={state.askResult?.evidence ?? []}
        />

        <div className="sidebar-column">
          <ChatPanel
            currentHadmId={state.currentHadmId}
            patientLoading={state.patientLoading}
            question={state.question}
            submittedQuestion={lastSubmittedQuestion}
            askLoading={state.askLoading}
            askError={state.askError}
            askResult={state.askResult}
            conversationContext={state.context}
            chatHistory={state.chatHistory}
            activeAnswerLinkId={activeAnswerLink?.id ?? null}
            onQuestionChange={(value) =>
              dispatch({
                type: "SET_QUESTION",
                payload: value,
              })
            }
            onAnswerLinkHover={(link) => {
              setHoveredAnswerLink(link);
            }}
            onAnswerLinkSelect={(link) => {
              setSelectedAnswerLink((currentLink) =>
                currentLink?.id === link.id ? null : link,
              );
            }}
            onSubmit={() => handleAskQuestion(state.question, state.context, state)}
            onCancelAsk={handleCancelAsk}
            onToggleImportPanel={toggleImportPanel}
            isImportPanelOpen={isImportPanelOpen}
            debugRequests={debugRequests}
          />
        </div>
      </main>

      {isImportPanelOpen && (
        <>
          <button
            className="floating-import-backdrop"
            type="button"
            aria-label="关闭导入外部数据面板"
            onClick={closeImportPanel}
          />
          <div
            className="floating-import-shell"
            id="floating-import-panel"
            role="dialog"
            aria-modal="true"
            aria-label="导入外部数据"
            ref={importPanelRef}
            tabIndex={-1}
          >
            <ExternalDataImportPanel
              disabled={state.patientLoading || state.askLoading}
              importing={importState.loading}
              error={importState.error}
              lastImport={importState.summary}
              history={importState.history}
              historyLoading={importState.historyLoading}
              deletingImportId={importState.deletingImportId}
              onImport={handleImportClinicalData}
              onDeleteImport={handleDeleteImport}
              onRefreshHistory={refreshImportHistory}
            />
          </div>
        </>
      )}
    </div>
  );
}
