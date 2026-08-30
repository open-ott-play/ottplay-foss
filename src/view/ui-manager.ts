/**
 * UI manager module for OTT-play FOSS
 * Handles interface setup and rendering helpers
 */

import { initBackgroundIntervals, uiInit as originalUiInit } from "../ui";

export function setupUI(): void {
    originalUiInit();
    initBackgroundIntervals();
}

// Export for backward compatibility
(window as any).uiInit = setupUI;
