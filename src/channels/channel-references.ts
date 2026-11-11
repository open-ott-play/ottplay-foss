/** Pure channel reference codec. Numeric IDs are a renderer/storage import boundary. */
interface ChannelReference {
    ambiguous?: boolean;
    itemId?: string;
    legacyId?: number | string;
    origin?: "raw" | "canonical";
}
function createChannelReferences(channels: any, aliases?: any) {
    return (window as any).OttPlayCore.createClassicChannelReferences(
        channels,
        aliases
    );
}
(window as any).__ottChannelReferences = { create: createChannelReferences };
