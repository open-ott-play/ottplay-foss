import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface MobileXmltvEpgPlugin {
    getEpg(options: {
        hash: string;
        channel_id: string;
        ch?: string;
        time_shift_hours?: number;
    }): Promise<{ xml?: string; cached?: boolean }>;
    prefetch(): Promise<void>;
}

class MobileXmltvEpgWeb extends WebPlugin implements MobileXmltvEpgPlugin {
    async getEpg(): Promise<{ xml?: string; cached?: boolean }> {
        console.warn("[MobileXmltvEpg] native not available in web");
        return {};
    }

    async prefetch(): Promise<void> {
        console.warn("[MobileXmltvEpg] prefetch skipped (web)");
    }
}

const MobileXmltvEpg = registerPlugin<MobileXmltvEpgPlugin>(
    "MobileXmltvEpg",
    MobileXmltvEpgWeb
);

export { MobileXmltvEpg };
