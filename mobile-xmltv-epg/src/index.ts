import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface MobileXmltvEpgPlugin {
    getEpg(options: {
        ch?: string;
        channel_id: string;
        hash: string;
        time_shift_hours?: number;
        xmltv_url?: string;
    }): Promise<{ epg_data: any[] }>;
    prefetch(): Promise<void>;
}

class MobileXmltvEpgWeb extends WebPlugin implements MobileXmltvEpgPlugin {
    async getEpg(): Promise<{ epg_data: any[] }> {
        console.warn("[MobileXmltvEpg] native not available in web");
        return { epg_data: [] };
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
