"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useState } from "react";
import type { BitWrapperJson } from "@gmb/bitmark-parser-generator";
import { AlertTriangle, CheckCircle2, Clipboard, Loader2, Wand2 } from "lucide-react";

interface GenerationResult {
  quiz: BitWrapperJson[];
  rawText?: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [turns, setTurns] = useState(7);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [processLog, setProcessLog] = useState<string[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [splashFadeOut, setSplashFadeOut] = useState(false);
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    let active = true;
    const preload = new window.Image();
    preload.src = "/logo.png";
    const markReady = () => {
      if (active) setLogoReady(true);
    };
    if (preload.complete) {
      markReady();
    } else {
      preload.onload = markReady;
      preload.onerror = markReady;
    }
    return () => {
      active = false;
      preload.onload = null;
      preload.onerror = null;
    };
  }, []);

  useEffect(() => {
    if (!logoReady) return;
    const fadeStartTimer = setTimeout(() => setSplashFadeOut(true), 3600);
    const hideTimer = setTimeout(() => setShowSplash(false), 5600);
    return () => {
      clearTimeout(fadeStartTimer);
      clearTimeout(hideTimer);
    };
  }, [logoReady]);

  useEffect(() => {
    let fallbackHideTimer: ReturnType<typeof setTimeout> | undefined;
    const fallbackTimer = setTimeout(() => {
      setSplashFadeOut(true);
      fallbackHideTimer = setTimeout(() => setShowSplash(false), 2000);
    }, 7800);
    return () => {
      clearTimeout(fallbackTimer);
      if (fallbackHideTimer) clearTimeout(fallbackHideTimer);
    };
  }, []);

  const bitCount = result?.quiz.length ?? 0;
  const rawOutput = result?.rawText ?? "";
  const jsonOutput = useMemo(() => {
    if (!result) return "";
    return JSON.stringify(result.quiz, null, 2);
  }, [result]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();

    if (!topic.trim()) {
      setError("Enter a prompt describing what knowledge the quiz should test.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setProcessLog([
      "Request form stamped.",
      "Sending topic to quiz generator...",
      "Waiting for model response...",
    ]);

    try {
      const res = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), turns }),
      });
      setProcessLog((prev) => [...prev, "Model response received. Normalizing with Bitmark..."]);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate quiz.");
      }

      setResult(data);
      setProcessLog((prev) => [
        ...prev,
        `Done. Generated ${data.quiz?.length ?? 0} Bitmark question wrappers.`,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected server error.");
      setProcessLog((prev) => [...prev, "Generation failed. See error report below."]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopyJson() {
    if (!jsonOutput) return;
    await navigator.clipboard.writeText(jsonOutput);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1400);
  }

  return (
    <main className="pp-shell">
      {showSplash && (
        <section className={`pp-splash ${splashFadeOut ? "pp-splash-out" : ""}`} aria-hidden={splashFadeOut}>
          <div className="pp-splash-logo-wrap">
            <Image
              src="/logo.png"
              alt="Quizzes Please logo"
              width={360}
              height={120}
              className={`pp-splash-logo ${logoReady ? "pp-splash-logo-ready" : ""}`}
              priority
            />
          </div>
        </section>
      )}

      <div className="pp-noise" />
      <div className="pp-bg-orb pp-bg-orb-a" />
      <div className="pp-bg-orb pp-bg-orb-b" />

      <section className={`pp-center-wrap pp-anim-rise-delayed ${showSplash ? "pp-preload-hide" : ""}`}>
        <article className="pp-panel pp-form-panel pp-paper pp-hover-tilt">
          <div className="pp-paper-hero">
            <Image src="/logo.png" alt="Quizzes Please logo" width={260} height={88} className="pp-top-logo" />
            <h1 className="pp-title pp-paper-title">Central Quiz Intake Form</h1>
            <p className="pp-subtitle pp-paper-subtitle">
              Describe your topic and instantly generate a polished, Bitmark-ready quiz.
            </p>
          </div>

          <header className="pp-panel-head pp-paper-head">
            <div>
              <p className="pp-panel-kicker">Entry Permit</p>
              <h2 className="pp-panel-title">Question Brief</h2>
            </div>
            <span className="pp-stamp">Cleared</span>
          </header>

          <form onSubmit={handleGenerate} className="pp-form">
            <label className="pp-label" htmlFor="topic">
              Describe the quiz to generate
            </label>
            <textarea
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="pp-textarea"
              placeholder="Example: Create a practical SQL quiz for junior analysts covering joins, filtering, aggregation, and query debugging."
              required
            />

            <div className="pp-inline-row">
              <label className="pp-label" htmlFor="turns">
                Number of turns
              </label>
              <div className="pp-turns-value">{turns}</div>
            </div>

            <input
              id="turns"
              type="range"
              min="3"
              max="20"
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
              className="pp-range"
            />

            <button type="submit" className="pp-submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating JSON
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Generate Bitmark Quiz
                </>
              )}
            </button>
          </form>

        </article>

        <article className="pp-panel pp-output-mini pp-hover-tilt">
          <header className="pp-panel-head pp-panel-head-mini">
            <div>
              <p className="pp-panel-kicker">Bitmark Trace</p>
              <h2 className="pp-panel-title">Generation Process</h2>
            </div>
            {result && (
              <div className="pp-badge">
                <CheckCircle2 className="w-4 h-4" />
                {bitCount} Questions
              </div>
            )}
          </header>

          {!isLoading && !result && !error && (
            <p className="pp-hint-line">Submit the form to see process events and raw Bitmark output.</p>
          )}

          {error && (
            <div className="pp-error">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          )}

          {processLog.length > 0 && (
            <ol className="pp-process-log">
              {processLog.map((step, idx) => (
                <li key={`${step}-${idx}`}>{step}</li>
              ))}
            </ol>
          )}

          {isLoading && (
            <div className="pp-loading-inline">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Building structured JSON wrappers...</span>
            </div>
          )}

          {result && (
            <div className="pp-result">
              <div className="pp-result-head">
                <button type="button" className="pp-copy" onClick={handleCopyJson}>
                  <Clipboard className="w-4 h-4" />
                  {isCopied ? "Copied" : "Copy Normalized JSON"}
                </button>
              </div>

              {rawOutput && (
                <details className="pp-json-block" open>
                  <summary>Raw model JSON text</summary>
                  <pre>{rawOutput}</pre>
                </details>
              )}

              <details className="pp-json-block" open>
                <summary>Bitmark normalized JSON</summary>
                <pre>{jsonOutput}</pre>
              </details>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
