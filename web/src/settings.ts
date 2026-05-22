import type { AppSettings } from "./api";

const storageKey = "safepulse-web-settings";

function defaultApiBaseUrl() {
  return "";
}

export const defaultSettings: AppSettings = {
  apiBaseUrl: defaultApiBaseUrl(),
  devUserId: "admin-1",
  devUserName: "Admin User",
  overviewBlockSize: "medium",
};

export function loadSettings(): AppSettings {
  const raw = localStorage.getItem(storageKey);
  if (!raw)
    return defaultSettings;

  try {
    const saved = { ...defaultSettings, ...JSON.parse(raw) };
    if (typeof window !== "undefined" && saved.apiBaseUrl) {
      try {
        const savedApi = new URL(saved.apiBaseUrl);
        const usesLocalApiPort = savedApi.port === "5002" && (
          savedApi.hostname === "localhost" ||
          savedApi.hostname === "127.0.0.1" ||
          savedApi.hostname === window.location.hostname
        );

        if (usesLocalApiPort)
          return { ...saved, apiBaseUrl: defaultApiBaseUrl() };
      } catch {
        return { ...saved, apiBaseUrl: defaultApiBaseUrl() };
      }
    }

    return saved;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
