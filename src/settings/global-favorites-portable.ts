/** Pure portable v1 rules are shared with other clients; host effects remain local. */
export function createGlobalFavoritesPortableCodec() {
    return (
        window as any
    ).OttPlayCore.createClassicGlobalFavoritesPortableCodec();
}
