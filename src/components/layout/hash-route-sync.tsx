"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";
import {
  buildHashRoute,
  loadHashRouteFromStorage,
  parseHashRoute,
  saveHashRouteToStorage,
} from "@/lib/hash-route";

export function HashRouteSync() {
  const section = useAppStore((state) => state.section);
  const setSection = useAppStore((state) => state.setSection);
  const selectedPath = useTreeStore((state) => state.selectedPath);
  const openPath = useTreeStore((state) => state.openPath);

  const suppressHashWriteRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    function applyHash(hash: string) {
      const route = parseHashRoute(hash);
      if (!route) return;

      suppressHashWriteRef.current = true;
      if (route.pagePath) {
        void openPath(route.pagePath, { source: "search" });
      } else {
        setSection(route.section);
      }

      requestAnimationFrame(() => {
        suppressHashWriteRef.current = false;
      });
    }

    const initialHash =
      window.location.hash && window.location.hash !== "#"
        ? window.location.hash
        : loadHashRouteFromStorage();

    if (initialHash) {
      applyHash(initialHash);
      if (!window.location.hash || window.location.hash === "#") {
        window.history.replaceState(null, "", initialHash);
      }
    }

    initializedRef.current = true;

    const handleHashChange = () => {
      if (!window.location.hash) return;
      applyHash(window.location.hash);
      saveHashRouteToStorage(window.location.hash);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [openPath, setSection]);

  useEffect(() => {
    if (!initializedRef.current || suppressHashWriteRef.current) {
      return;
    }

    const nextHash = buildHashRoute(section, selectedPath);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
    saveHashRouteToStorage(nextHash);
  }, [section, selectedPath]);

  return null;
}
